"""Local-only preview: isolated fake cases and the current Cloudflare UI build."""
import os
import tempfile
from pathlib import Path

os.environ.setdefault("SECRET_KEY", "local-news-preview-fixture-only")
os.environ.setdefault("APP_ENV", "development")
from flask import abort, send_from_directory
from tests.e2e.conftest import _prepare_seed_cases
from immi_case_downloader.storage import ensure_output_dirs, save_cases_csv, save_cases_json
from immi_case_downloader.web import create_app

ROOT = Path(__file__).resolve().parents[4]
STATIC = ROOT / "frontend/dist"
fixture = tempfile.TemporaryDirectory(prefix="immi-news-wide-fixture-")
ensure_output_dirs(fixture.name)
cases = _prepare_seed_cases()
save_cases_csv(cases, fixture.name)
save_cases_json(cases, fixture.name)
app = create_app(output_dir=fixture.name, backend="csv")
app.config["TESTING"] = True

def preview_spa(path):
    if path.startswith("api/"):
        abort(404)
    target = (STATIC / path).resolve()
    if not target.is_relative_to(STATIC.resolve()):
        abort(404)
    return send_from_directory(STATIC, path if target.is_file() else "index.html")

app.view_functions["serve_spa"] = preview_spa
app.run(host="127.0.0.1", port=5194, use_reloader=False)
