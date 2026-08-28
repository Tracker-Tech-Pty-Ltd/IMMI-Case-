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
from pathlib import Path

from ..csv_write_lock import CatalogLockedError, catalog_lock

_JOB_NAME_RE = re.compile(r"^[a-z0-9_]+$")

# Re-exported so the repo-root batch jobs keep importing both from here. The
# implementations live in ``immi_case_downloader.csv_write_lock`` because the
# web/CLI writers take the *same* lock on the *same* file: two lock protocols
# over one path is how the catalog gets two concurrent writers.
__all__ = [
    "CatalogLockedError",
    "atomic_write_rows",
    "catalog_lock",
    "load_project_env",
    "temp_path_for",
]


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


def load_project_env() -> None:
    """Load *this checkout's* ``.env``, wherever the script is run from.

    Walks up at most 8 directories from this file's own location — the repo
    root when running from a checkout — skipping any directory whose name
    starts with ``.auto-claude``, and loads the first ``.env`` found.

    Deliberately does not search the caller's working directory, and does not
    override variables already exported. Running one checkout's script by
    absolute path from inside another checkout used to load *that* directory's
    ``.env`` and overwrite the credentials already in the environment — so the
    job would silently bill a different API account, or point at a different
    Cloudflare Gateway, than the operator's shell said it would. An explicitly
    exported variable is an explicit instruction and outranks a file.
    """
    from dotenv import load_dotenv

    p = Path(__file__).parent.parent.parent
    for _ in range(8):
        if p.name.startswith(".auto-claude"):
            p = p.parent
            continue
        candidate = p / ".env"
        if candidate.exists():
            load_dotenv(candidate, override=False)
            return
        p = p.parent
