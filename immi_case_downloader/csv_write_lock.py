"""Cross-process advisory lock for the master CSV read-modify-write.

Every writer of downloaded_cases/immigration_cases.csv loads the whole file,
mutates rows, and writes it back. Two overlapping writers therefore silently
discard each other's work. This is the one lock they all take.

Advisory, not mandatory: a writer that does not take it is not blocked. Adding
a new writer means adding the lock to it — see the module list in
plans/027-fix-csv-data-integrity.md Step 9b.

One protocol, two waiting policies
----------------------------------
There is exactly one lock file (``<csv>.lock``) and exactly one exclusion
primitive (``fcntl.flock`` on POSIX, a kernel byte-range lock on Windows).
Both entry points below open that same path and use the same primitive, so
they exclude each other on the host platform:

* :func:`csv_write_lock` waits up to ``timeout`` then raises ``TimeoutError``.
  Used by the web/CLI writers, whose critical sections are short.
* :func:`catalog_lock` does not wait at all: a held lock raises
  ``CatalogLockedError`` naming the holder. Used by the long-running repo-root
  batch jobs, where blocking for hours is worse than failing immediately.

``flock`` — not an ``O_EXCL`` sentinel file — is the primitive on purpose. The
kernel drops a ``flock`` when the holding process dies, so a crashed job cannot
wedge the catalog; an ``O_EXCL`` sentinel survives its creator and forces the
"delete this file by hand" escape hatch that, if an operator obeys it while a
writer really is live, permits two concurrent writers. For the same reason the
lock file is **never unlinked**: unlinking it while another process holds a
descriptor on it would leave that process holding a lock on an orphaned inode
while the next process locks a brand-new one — two writers, no error.

The file's *contents* are diagnostics only, never ownership: the holder stamps
its job name, pid, and start time there so a blocked waiter can say who is in
the way.
"""

from __future__ import annotations

import contextlib
import errno
import os
import time
from collections.abc import Callable, Iterator

if os.name == "nt":
    import msvcrt
else:
    import fcntl

LOCK_TIMEOUT_SECONDS = 120.0
_POLL_INTERVAL_SECONDS = 0.05
DEFAULT_JOB_NAME = "csv_write"


class CatalogLockedError(RuntimeError):
    """Raised when the catalog lock is already held by another job."""


def lock_path_for(csv_path: str | os.PathLike[str]) -> str:
    """Return the single lock-file path used for ``csv_path`` by every writer."""
    return f"{os.fspath(csv_path)}.lock"


def read_lock_holder(csv_path: str | os.PathLike[str]) -> str:
    """Best-effort description of who holds (or last held) the lock.

    Diagnostics only — never consulted to decide whether the lock is free.
    Returns an empty string when nothing has been recorded.
    """
    try:
        with open(lock_path_for(csv_path), encoding="utf-8") as f:
            if os.name == "nt":
                # Byte zero is the lock, diagnostics start at byte one so a
                # blocked Windows reader can still identify the holder.
                f.seek(1)
            return f.read().strip()
    except OSError:
        return ""


def _stamp_holder(fd: int, job_name: str) -> None:
    """Record who holds the lock, for a blocked waiter to read."""
    stamp = (
        f"{job_name} pid={os.getpid()} "
        f"started={time.strftime('%Y-%m-%dT%H:%M:%S')}\n"
    )
    try:
        os.ftruncate(fd, 0)
        os.lseek(fd, 0, os.SEEK_SET)
        os.write(fd, ((" " if os.name == "nt" else "") + stamp).encode("utf-8"))
    except OSError:
        # A lock we hold but could not annotate is still a valid lock.
        pass


@contextlib.contextmanager
def _hold_flock(
    csv_path: str | os.PathLike[str],
    *,
    timeout: float,
    job_name: str,
    on_busy: Callable[[str, str], BaseException],
) -> Iterator[None]:
    """Hold an exclusive ``flock`` on ``<csv_path>.lock`` for the block.

    Polls until ``timeout`` seconds have elapsed (``timeout <= 0`` means a
    single non-blocking attempt), then raises whatever ``on_busy(lock_path,
    holder)`` returns.
    """
    lock_path = lock_path_for(csv_path)
    parent = os.path.dirname(os.path.abspath(lock_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    deadline = time.monotonic() + max(timeout, 0.0)
    acquired = False
    try:
        while True:
            try:
                if os.name == "nt":
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN):
                    raise
                if time.monotonic() >= deadline:
                    raise on_busy(lock_path, read_lock_holder(csv_path)) from exc
                time.sleep(_POLL_INTERVAL_SECONDS)
        _stamp_holder(fd, job_name)
        yield
    finally:
        # Release the lock but leave the file in place — see module docstring.
        try:
            if acquired:
                if os.name == "nt":
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


@contextlib.contextmanager
def csv_write_lock(
    csv_path: str | os.PathLike[str],
    timeout: float = LOCK_TIMEOUT_SECONDS,
    job_name: str = DEFAULT_JOB_NAME,
) -> Iterator[None]:
    """Hold the master-CSV write lock for the block, waiting up to ``timeout``.

    Raises TimeoutError rather than blocking forever, so a stale holder shows
    up as a loud failure instead of a hung job.
    """

    def on_busy(lock_path: str, holder: str) -> BaseException:
        held_by = f" (held by {holder})" if holder else ""
        return TimeoutError(
            f"another process has held {lock_path} for over "
            f"{timeout:.0f}s{held_by}"
        )

    with _hold_flock(csv_path, timeout=timeout, job_name=job_name, on_busy=on_busy):
        yield


@contextlib.contextmanager
def catalog_lock(csv_path: str | os.PathLike[str], job_name: str) -> Iterator[None]:
    """Fail-fast variant of :func:`csv_write_lock` for long-running batch jobs.

    Never steals a held lock and never waits: a lock held by anyone — another
    batch job or a short web/CLI writer — raises ``CatalogLockedError`` naming
    the holder, because a batch job silently queueing behind an unknown writer
    for hours is worse than a job that refuses to start.

    Unlike the ``O_EXCL`` sentinel this replaces, there is nothing to delete by
    hand: the kernel releases the lock when the holding process exits.
    """

    def on_busy(lock_path: str, holder: str) -> BaseException:
        held_by = f"\n{holder}\n" if holder else "\n"
        return CatalogLockedError(
            f"Catalog lock already held: {lock_path}{held_by}"
            "The holder releases it on exit — including if it crashes. "
            "Wait for it to finish rather than deleting the lock file."
        )

    with _hold_flock(csv_path, timeout=0.0, job_name=job_name, on_busy=on_busy):
        yield
