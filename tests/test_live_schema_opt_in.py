"""Ordinary unit-suite execution must never opt itself into remote mutations."""

import pytest

from tests import test_council_schema


def test_legacy_live_schema_requires_explicit_operator_opt_in(monkeypatch):
    monkeypatch.delenv("IMMI_LIVE_SUPABASE_TESTS", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://test.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder")
    monkeypatch.setattr("supabase.create_client", lambda *_args: object())
    with pytest.raises(pytest.skip.Exception, match="IMMI_LIVE_SUPABASE_TESTS"):
        test_council_schema._supabase_client()
