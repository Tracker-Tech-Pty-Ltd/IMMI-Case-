"""Contract test: .env.example must name every env var the PYTHON code reads.

CLAUDE.md:51 designates .env.example the source of truth for environment
variables. Nothing enforced that, so it drifted ~30 variables behind the code.
This test fails when a Python file under the scanned roots reads a variable
that .env.example never mentions.

SCOPE — read this before citing the test as evidence of anything wider.
It covers ONLY Python reads (`os.environ` / `os.getenv` / the project's
`_*_env()` helpers) under `immi_case_downloader/`, `scripts/` and the repo
root. It does NOT cover, and cannot fail on:

  * Cloudflare Worker `env.*` reads under `workers/`
  * Wrangler `[vars]` and `wrangler secret put` names
  * `import.meta.env.*` in the Vite client bundle
  * shell scripts, the Makefile, or CI workflow `env:` blocks

Those surfaces are documented in .env.example by hand. Extending this test to
them is a real follow-up (see plans/045 "Maintenance notes"); until someone
does it, this file is the *Python* env contract, not a repo-wide inventory.

If this test fails, the fix is to DOCUMENT the printed variable in the right
section of .env.example (or, if it is genuinely internal, add it to
UNDOCUMENTED_BY_DESIGN with a one-line reason). Do not relax the patterns.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_EXAMPLE = REPO_ROOT / ".env.example"

# Directories and files scanned for env reads. Deliberately excludes tests/ and
# frontend/ — tests set variables, they do not consume configuration, and the
# frontend reads frontend/.env.
SCAN_DIRS = ("immi_case_downloader", "scripts")

# os.environ.get("X") / os.environ["X"] / os.getenv("X")
DIRECT_READ_RE = re.compile(
    r"""os\.(?:environ(?:\.get)?[(\[]|getenv\()\s*['"]([A-Z][A-Z0-9_]{2,})['"]"""
)
# Project env helpers: _float_env("X"), _env_int("X"), _env_flag("X"), ...
HELPER_READ_RE = re.compile(
    r"""_(?:float|int|bool|str)_env\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]"""
    r"""|_env_(?:int|float|flag|str)\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]"""
)

# A variable counts as documented when .env.example either assigns it
# (`NAME=...`) or names it on a comment line (`#   A / B / C — ...`). Comment
# scanning requires at least one underscore so ordinary prose words in ALL CAPS
# ("NOT", "DANGER") are not mistaken for documented variable names; every real
# variable in this project contains one. Assignments are matched without that
# restriction, so a single-word variable can still be documented by assigning it.
ASSIGNED_RE = re.compile(r"^([A-Z][A-Z0-9_]{2,})=", re.MULTILINE)
COMMENT_LINE_RE = re.compile(r"^#.*$", re.MULTILINE)
COMMENT_NAME_RE = re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")

# Variables intentionally absent from .env.example. Keep this list empty unless
# there is a real reason, and always give the reason.
UNDOCUMENTED_BY_DESIGN: dict[str, str] = {}


def _python_files() -> list[Path]:
    files = sorted(REPO_ROOT.glob("*.py"))
    for name in SCAN_DIRS:
        files.extend(sorted((REPO_ROOT / name).rglob("*.py")))
    return files


def _read_variables() -> dict[str, str]:
    """Map variable name -> "relative/path.py:line" of its first read site."""
    found: dict[str, str] = {}
    for path in _python_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            names = [m.group(1) for m in DIRECT_READ_RE.finditer(line)]
            for match in HELPER_READ_RE.finditer(line):
                names.append(match.group(1) or match.group(2))
            for name in names:
                found.setdefault(
                    name, f"{path.relative_to(REPO_ROOT)}:{lineno}"
                )
    return found


def _documented_names() -> set[str]:
    text = ENV_EXAMPLE.read_text(encoding="utf-8")
    names = set(ASSIGNED_RE.findall(text))
    for comment in COMMENT_LINE_RE.findall(text):
        names.update(COMMENT_NAME_RE.findall(comment))
    return names


def test_env_example_exists():
    assert ENV_EXAMPLE.is_file(), f"{ENV_EXAMPLE} is missing"


def test_env_example_documents_every_variable_python_reads():
    read_sites = _read_variables()
    documented = _documented_names()

    missing = {
        name: site
        for name, site in read_sites.items()
        if name not in documented and name not in UNDOCUMENTED_BY_DESIGN
    }

    assert not missing, (
        "These environment variables are read by Python but not documented in "
        ".env.example:\n"
        + "\n".join(f"  {name}  (first read at {site})" for name, site in sorted(missing.items()))
        + "\n\nDocument each one in the matching section of .env.example, or add "
        "it to UNDOCUMENTED_BY_DESIGN in this file with a reason."
    )


def test_env_example_carries_no_cloudflare_account_id():
    """The template must not hand a new operator the project's AI Gateway."""
    text = ENV_EXAMPLE.read_text(encoding="utf-8")
    hits = re.findall(r"gateway\.ai\.cloudflare\.com/v1/[0-9a-f]{8,}", text)
    assert not hits, (
        "A Cloudflare account identifier is embedded in .env.example. Replace "
        "the value with an empty string; the code default in "
        "immi_case_downloader/llm_council.py:40 already supplies it."
    )
