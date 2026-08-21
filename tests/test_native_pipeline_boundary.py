from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRAPER_SRC = ROOT / "workers" / "austlii-scraper" / "src"


def test_scraper_source_has_no_postgres_or_hyperdrive_dependency():
    source = "\n".join(path.read_text(encoding="utf-8") for path in SCRAPER_SRC.glob("*.ts"))
    assert 'from "postgres"' not in source
    assert "HYPERDRIVE_SERVICE" not in source
    assert "HYPERDRIVE_SERVICE_URL" not in source


def test_native_scraper_template_uses_d1_and_native_case_queue():
    config = (ROOT / "config" / "wrangler-austlii-native.toml.example").read_text(encoding="utf-8")
    assert 'binding = "IMMI_CATALOG_DB"' in config
    assert 'binding = "IMMI_OPS_DB"' in config
    assert 'binding = "NATIVE_CASE_QUEUE"' in config
    assert "HYPERDRIVE" not in config
    assert 'PIPELINE_ENABLED = "false"' in config
    assert 'NATIVE_PIPELINE_ENABLED = "false"' in config


def test_active_wrangler_configs_are_native_only():
    for path in (ROOT / "wrangler.toml", ROOT / "workers/austlii-scraper/wrangler.toml"):
        source = path.read_text(encoding="utf-8").lower()
        assert "hyperdrive" not in source, path
        assert "postgres" not in source, path
        assert "supabase" not in source, path

    main = (ROOT / "wrangler.toml").read_text(encoding="utf-8")
    pipeline = (ROOT / "workers/austlii-scraper/wrangler.toml").read_text(encoding="utf-8")
    assert 'main = "workers/cloudflare-native.js"' in main
    assert 'IMMI_STORAGE_MODE = "cloudflare"' in main
    assert 'main = "src/index.ts"' in pipeline
    assert 'PIPELINE_ENABLED = "false"' in pipeline
    assert 'NATIVE_PIPELINE_ENABLED = "false"' in pipeline
