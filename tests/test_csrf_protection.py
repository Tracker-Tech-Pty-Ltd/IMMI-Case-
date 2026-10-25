"""Verify CSRF protection is active on state-changing endpoints."""
import pytest
from immi_case_downloader.web import create_app


@pytest.fixture
def app(tmp_path):
    from immi_case_downloader.web import close_app

    app = create_app(output_dir=str(tmp_path), backend="csv")
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = True
    yield app
    close_app(app, wait=True)
    repo = app.config.get("REPO")
    if repo and hasattr(repo, "close"):
        repo.close()


@pytest.fixture
def client(app):
    return app.test_client()


class TestCSRFProtection:
    def test_pipeline_action_rejects_post_without_csrf_token(self, client):
        """Pipeline action must require CSRF token (no @csrf.exempt)."""
        response = client.post(
            "/api/v1/pipeline-action",
            json={"action": "stop"},
            content_type="application/json",
        )
        # Should be 400 (CSRF token missing), NOT 200
        assert response.status_code in (400, 403), (
            f"Expected CSRF rejection (400/403), got {response.status_code}. "
            "The endpoint may still have @csrf.exempt!"
        )
