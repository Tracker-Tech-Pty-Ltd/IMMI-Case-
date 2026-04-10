"""Tests for SmartPipeline encapsulated state."""
from immi_case_downloader.pipeline import SmartPipeline, PipelineConfig


def test_pipeline_has_instance_status():
    config = PipelineConfig()
    p = SmartPipeline(config, output_dir="/tmp/test_pipeline")
    status = p.get_status()
    assert isinstance(status, dict)
    assert status["running"] == False


def test_pipeline_stop_flag():
    config = PipelineConfig()
    p = SmartPipeline(config, output_dir="/tmp/test_pipeline")
    p.request_stop()
    assert p.get_status()["stop_requested"] == True


def test_pipeline_independent_instances():
    config = PipelineConfig()
    p1 = SmartPipeline(config, output_dir="/tmp/p1")
    p2 = SmartPipeline(config, output_dir="/tmp/p2")
    p1.request_stop()
    assert p2.get_status()["stop_requested"] == False


def test_pipeline_config_from_dict():
    form = {"preset": "quick"}
    config = PipelineConfig.from_form(form)
    assert config.start_year is not None


def test_pipeline_config_preset_full():
    config = PipelineConfig.from_form({"preset": "full"})
    assert config.start_year == 2010


def test_pipeline_config_preset_download_only():
    config = PipelineConfig.from_form({"preset": "download_only"})
    assert config.download_enabled == True


def test_get_status_returns_copy():
    """Mutations to the returned dict must not affect internal state."""
    config = PipelineConfig()
    p = SmartPipeline(config, output_dir="/tmp/test_pipeline")
    s1 = p.get_status()
    s1["running"] = True
    s2 = p.get_status()
    assert s2["running"] == False


def test_module_get_pipeline_status_without_active():
    """get_pipeline_status() returns initial state when no pipeline has run."""
    from immi_case_downloader.pipeline import get_pipeline_status, _INITIAL_STATUS
    status = get_pipeline_status()
    assert status["running"] == False
    assert "stats" in status


def test_module_request_stop_without_active():
    """request_pipeline_stop() is a no-op when no pipeline is active."""
    from immi_case_downloader.pipeline import request_pipeline_stop
    # Should not raise
    request_pipeline_stop()
