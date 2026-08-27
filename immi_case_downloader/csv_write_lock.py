"""Cross-process advisory lock for the master CSV read-modify-write.

Every writer of downloaded_cases/immigration_cases.csv loads the whole file,
mutates rows, and writes it back. Two overlapping writers therefore silently
discard each other's work. This is the one lock they all take.

Advisory, not mandatory: a writer that does not take it is not blocked. Adding
a new writer means adding the lock to it — see the module list in
plans/027-fix-csv-data-integrity.md Step 9b.
"""

from __future__ import annotations

import contextlib
import errno
import fcntl
import os
import time
from collections.abc import Iterator

LOCK_TIMEOUT_SECONDS = 120.0


@contextlib.contextmanager
def csv_write_lock(csv_path: str, timeout: float = LOCK_TIMEOUT_SECONDS) -> Iterator[None]:
    """Hold an exclusive advisory lock on ``<csv_path>.lock`` for the block.

    Raises TimeoutError rather than blocking forever, so a stale holder shows
    up as a loud failure instead of a hung job.
    """
    lock_path = f"{csv_path}.lock"
    os.makedirs(os.path.dirname(os.path.abspath(lock_path)), exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    deadline = time.monotonic() + timeout
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN):
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"another process has held {lock_path} for over "
                        f"{timeout:.0f}s"
                    ) from exc
                time.sleep(0.05)
        yield
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)
