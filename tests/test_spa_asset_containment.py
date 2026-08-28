"""SPA static-asset containment: a path resolving outside the React build
directory must 404 instead of being served.

serve_spa() has two branches. The normal one delegates to
send_from_directory(), which carries Werkzeug's own traversal check. The
`app.testing` branch open()s the joined path directly and had no check at all —
that is the branch these tests cover, and the branch the Step 5 guard protects.

The React build directory is a fixed path inside the installed package
(<pkg>/static/react), so the fixture materialises files there under
plan045-prefixed names and removes exactly what it created.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest

import immi_case_downloader as pkg

REACT_DIR = Path(os.path.dirname(pkg.__file__)) / "static" / "react"
OUTSIDE_MARKER = "PLAN045-OUTSIDE-THE-BUILD-DIRECTORY"


def _make_app():
    from immi_case_downloader.web import create_app

    with patch.dict(os.environ, {"SECRET_KEY": "test-key"}):
        app = create_app(backend="csv")
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    return app


@pytest.fixture()
def react_build(tmp_path):
    """A minimal build dir containing one real asset and one escaping symlink."""
    missing_root = None
    probe = REACT_DIR
    while not probe.exists():
        missing_root = probe
        probe = probe.parent
    REACT_DIR.mkdir(parents=True, exist_ok=True)

    outside = tmp_path / "outside.txt"
    outside.write_text(OUTSIDE_MARKER, encoding="utf-8")

    created: list[Path] = []

    def _write(name: str, body: str) -> Path:
        path = REACT_DIR / name
        if path.exists() or path.is_symlink():
            pytest.skip(f"{path} already exists; refusing to touch a real build artifact")
        path.write_text(body, encoding="utf-8")
        created.append(path)
        return path

    _write("plan045-index.html", "<!doctype html><title>t</title>")
    _write("plan045-asset.js", "console.log('INSIDE-THE-BUILD');")

    link = REACT_DIR / "plan045-escape.js"
    if link.exists() or link.is_symlink():
        pytest.skip("symlink fixture name already taken")
    link.symlink_to(outside)
    created.append(link)

    try:
        yield outside
    finally:
        for path in created:
            if path.is_symlink() or path.exists():
                path.unlink()
        if missing_root is not None:
            shutil.rmtree(missing_root, ignore_errors=True)


def test_serves_a_file_inside_the_build_directory(react_build):
    """The guard must not break the legitimate case it wraps."""
    response = _make_app().test_client().get("/plan045-asset.js")
    assert response.status_code == 200
    assert b"INSIDE-THE-BUILD" in response.data


def test_rejects_a_symlink_that_escapes_the_build_directory(react_build):
    """Before the Step 5 guard this returned 200 with the outside file's bytes."""
    response = _make_app().test_client().get("/plan045-escape.js")
    assert response.status_code == 404
    assert OUTSIDE_MARKER.encode() not in response.data


def test_encoded_traversal_never_serves_a_file_outside_the_build(react_build):
    """Defence in depth: Werkzeug normalises most of these, the guard covers the rest."""
    client = _make_app().test_client()
    for path in ("/../plan045-escape.js", "/%2e%2e%2fplan045-escape.js", "/a/../../setup.py"):
        response = client.get(path)
        assert response.status_code != 500
        assert OUTSIDE_MARKER.encode() not in response.data
