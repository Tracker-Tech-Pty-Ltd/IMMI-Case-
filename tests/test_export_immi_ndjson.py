"""Read-only source snapshot exporter guard tests."""

from __future__ import annotations

import importlib.util
from types import SimpleNamespace
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("export_immi_ndjson", ROOT / "scripts/export_immi_ndjson.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_source_dsn_is_host_allowlisted_without_printing_secret() -> None:
    MODULE.validate_source_dsn("postgresql://postgres:secret@db.urntbuqczarkuoaosjxd.supabase.co:5432/postgres?sslmode=require")


@pytest.mark.parametrize(
    "dsn",
    [
        "",
        "postgresql://postgres:secret@db.other.supabase.co:5432/postgres",
        "https://db.urntbuqczarkuoaosjxd.supabase.co",
    ],
)
def test_source_dsn_rejects_missing_or_wrong_host(dsn: str) -> None:
    with pytest.raises(ValueError):
        MODULE.validate_source_dsn(dsn)


def test_text_path_cannot_escape_root(tmp_path: Path) -> None:
    candidate = MODULE.safe_text_path(tmp_path, "../secret.txt")
    assert candidate.parent == tmp_path.resolve()


def test_primary_key_manifest_supports_composite_memberships() -> None:
    assert MODULE._primary_key(
        {"tenant_id": "Tenant-A", "user_id": "User-B"},
        "immi_tenant_members",
        1,
    ) == {"tenant_id": "Tenant-A", "user_id": "User-B"}


def test_primary_key_manifest_rejects_missing_key() -> None:
    with pytest.raises(ValueError, match="user_id is required"):
        MODULE._primary_key(
            {"tenant_id": "Tenant-A"},
            "immi_tenant_members",
            1,
        )


def test_write_table_emits_chunk_and_row_manifests(tmp_path: Path) -> None:
    class Cursor:
        description = [SimpleNamespace(name="id"), SimpleNamespace(name="name")]

        def execute(self, _query: str) -> None:
            return None

        def __iter__(self):
            return iter([("user-1", "Ada"), ("user-2", "Lin")])

    result = MODULE.write_table(Cursor(), tmp_path, "immi_users", None)

    assert result["rows"] == 2
    assert result["chunks"][0]["rows"] == 2
    assert (tmp_path / "tables/immi_users/part-000001.ndjson").is_file()
    assert (tmp_path / "row-manifests/immi_users.ndjson").read_text().count("sha256") == 2
    assert (tmp_path / "primary-keys/immi_users.ndjson").read_text().count("user-") == 2
