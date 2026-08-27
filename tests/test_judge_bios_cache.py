"""Tests for the per-output-dir scoping of the judge-bio caches (PYCORR-20).

Both `_load_judge_bios` and `_load_judge_name_overrides` are `@lru_cache`d
inner functions keyed on `output_dir` (Step 6). Before that fix, the first
app created in a process pinned the map for every later app in the same
process — a real bug in tests and in any multi-tenant dev workflow.
"""

import json
import os

import pytest

from immi_case_downloader.storage import ensure_output_dirs


def _app_over(output_dir: str):
    from immi_case_downloader.webapp import create_app

    ensure_output_dirs(output_dir)
    application = create_app(output_dir)
    application.config["TESTING"] = True
    application.config["WTF_CSRF_ENABLED"] = False
    return application


@pytest.fixture
def dir_a(tmp_path):
    return str(tmp_path / "dir_a")


@pytest.fixture
def dir_b(tmp_path):
    return str(tmp_path / "dir_b")


class TestJudgeBiosCacheScoping:
    def test_bios_are_scoped_per_output_dir(self, dir_a, dir_b):
        from immi_case_downloader.web.routes.api import _load_judge_bios

        os.makedirs(dir_a, exist_ok=True)
        with open(os.path.join(dir_a, "judge_bios.json"), "w", encoding="utf-8") as f:
            json.dump({"alpha": {"full_name": "Member Alpha From A"}}, f)

        app_a = _app_over(dir_a)
        app_b = _app_over(dir_b)

        with app_a.app_context():
            bios_a = _load_judge_bios()
        with app_b.app_context():
            bios_b = _load_judge_bios()

        assert bios_a.get("alpha", {}).get("full_name") == "Member Alpha From A"
        assert bios_b == {}

    def test_name_overrides_are_scoped_per_output_dir(self, dir_a, dir_b):
        from immi_case_downloader.web.routes.api import _load_judge_name_overrides

        os.makedirs(dir_a, exist_ok=True)
        with open(os.path.join(dir_a, "judge_name_overrides.json"), "w", encoding="utf-8") as f:
            json.dump({"alpha": "Member Alpha Full"}, f)

        app_a = _app_over(dir_a)
        app_b = _app_over(dir_b)

        with app_a.app_context():
            overrides_a = _load_judge_name_overrides()
        with app_b.app_context():
            overrides_b = _load_judge_name_overrides()

        assert overrides_a.get("alpha") == "Member Alpha Full"
        # B still gets the packaged defaults, so assert on the absence of the
        # A-specific alias rather than asserting the whole map is empty.
        assert overrides_b.get("alpha") != "Member Alpha Full"
