"""Shared plumbing for the repo-root catalog batch jobs.

These jobs mutate ``downloaded_cases/immigration_cases.csv``, a ~149k-row file
that is gitignored and cannot be regenerated from this repository. Historically
each script built its own ``<catalog>.csv.tmp`` — the *same* path in every
script — and ``os.replace``d it onto the live catalog with no lock, so two
concurrent jobs silently destroyed each other's work.

This module gives every job a distinct temp path and a mutual-exclusion lock.

It is deliberately NOT re-exported from ``immi_case_downloader.extraction``:
the extraction container imports that package and installs ``flask`` only, so
``load_project_env`` imports ``python-dotenv`` lazily, inside the function.
"""

from __future__ import annotations

import csv
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

_JOB_NAME_RE = re.compile(r"^[a-z0-9_]+$")


class CatalogLockedError(RuntimeError):
    """Raised when a catalog lock is already held by another job."""


def temp_path_for(csv_path: Path, job_name: str) -> Path:
    """Return a temp path for ``job_name`` that is a sibling of ``csv_path``.

    Every job gets its own temp file so two concurrent jobs never race on the
    same path, and the temp file stays on the same filesystem as the catalog
    so the final ``os.replace`` is atomic.
    """
    if not _JOB_NAME_RE.match(job_name):
        raise ValueError(f"job_name must match {_JOB_NAME_RE.pattern!r}: {job_name!r}")
    return csv_path.with_name(f"{csv_path.name}.{job_name}.tmp")


def atomic_write_rows(
    csv_path: Path,
    rows: list[dict],
    *,
    job_name: str,
    backup_suffix: str | None = None,
    backup_once: bool = False,
) -> None:
    """Write ``rows`` to ``csv_path`` atomically via a job-specific temp file.

    No-ops when ``rows`` is empty. When ``backup_suffix`` is given, ``csv_path``
    is copied to ``csv_path.with_suffix(backup_suffix)`` first — unless
    ``backup_once`` is true and that backup already exists, in which case the
    existing backup is left untouched. On any exception the temp file is
    removed before re-raising.
    """
    if not rows:
        return

    tmp_path = temp_path_for(csv_path, job_name)
    try:
        if backup_suffix:
            backup_path = csv_path.with_suffix(backup_suffix)
            if not (backup_once and backup_path.exists()):
                import shutil

                shutil.copy2(csv_path, backup_path)

        fieldnames = list(rows[0].keys())
        with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

        os.replace(str(tmp_path), str(csv_path))
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


@contextmanager
def catalog_lock(csv_path: Path, job_name: str) -> Iterator[None]:
    """Mutual-exclusion lock over ``csv_path``, held for the duration of the block.

    Never steals a stale lock automatically: a wrong steal risks concurrent
    writers destroying the catalog, which is unrecoverable, so a held lock
    always raises ``CatalogLockedError`` naming the job that holds it. An
    operator who is certain no other job is running deletes the lock file by
    hand.
    """
    lock_path = csv_path.with_name(f"{csv_path.name}.lock")
    try:
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError as exc:
        existing = lock_path.read_text(encoding="utf-8") if lock_path.exists() else ""
        raise CatalogLockedError(
            f"Catalog lock already held: {lock_path}\n{existing}"
            "Delete the lock file if you are certain no other job is running."
        ) from exc

    try:
        with os.fdopen(fd, "w") as f:
            f.write(f"{job_name} pid={os.getpid()} started={datetime.now().isoformat()}\n")
        yield
    finally:
        try:
            os.unlink(str(lock_path))
        except FileNotFoundError:
            pass


def load_project_env() -> None:
    """Load the project ``.env`` from the repo root, wherever we are run from.

    Walks up at most 8 directories from this file's own location (the repo
    root when running from a checkout) *and* from the current working
    directory, skipping any directory whose name starts with ``.auto-claude``,
    and loads the first ``.env`` found.
    """
    from dotenv import load_dotenv

    for start in (Path.cwd(), Path(__file__).parent.parent.parent):
        p = start
        for _ in range(8):
            if p.name.startswith(".auto-claude"):
                p = p.parent
                continue
            candidate = p / ".env"
            if candidate.exists():
                load_dotenv(candidate, override=True)
                return
            p = p.parent
