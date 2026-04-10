"""Tests for immi_case_downloader.pipeline — Phase 6."""

import threading
from unittest.mock import patch, MagicMock

import pytest

from immi_case_downloader.pipeline import (
    PipelineConfig,
    PipelineLog,
    PipelineEvent,
    SmartPipeline,
    get_pipeline_status,
    request_pipeline_stop,
    start_pipeline,
    RETRYABLE_ERRORS,
)
from immi_case_downloader.config import END_YEAR
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.storage import ensure_output_dirs, save_cases_csv


# ── PipelineConfig ─────────────────────────────────────────────────────────


class TestPipelineConfig:
    def test_default_values(self):
        config = PipelineConfig()
        assert config.delay == 0.5
        assert config.deduplicate is True
        assert config.fix_year_zero is True

    def test_to_dict(self):
        config = PipelineConfig()
        d = config.to_dict()
        assert "databases" in d
        assert "delay" in d
        assert "download_enabled" in d

    def test_from_form_quick_preset(self):
        form = {"preset": "quick"}
        config = PipelineConfig.from_form(form)
        assert "AATA" in config.databases
        assert config.start_year == END_YEAR - 1

    def test_from_form_full_preset(self):
        form = {"preset": "full"}
        config = PipelineConfig.from_form(form)
        assert config.start_year == 2010
        assert "FCCA" in config.databases

    def test_from_form_download_only_preset(self):
        form = {"preset": "download_only", "download_batch_size": "500"}
        config = PipelineConfig.from_form(form)
        assert config.databases == []
        assert config.download_enabled is True
        assert config.download_batch_size == 500

    def test_from_form_year_swap(self):
        """start_year > end_year should be swapped."""
        form = {"start_year": "2025", "end_year": "2020", "databases": ["AATA"]}
        config = PipelineConfig.from_form(form)
        assert config.start_year <= config.end_year

    def test_from_form_invalid_values_use_defaults(self):
        form = {"start_year": "abc", "end_year": "xyz", "delay": "bad"}
        config = PipelineConfig.from_form(form)
        assert isinstance(config.start_year, int)
        assert isinstance(config.delay, float)

    def test_from_form_custom_config(self):
        form = MagicMock()
        form.get.side_effect = lambda key, default="": {
            "preset": "",
            "start_year": "2023",
            "end_year": "2024",
            "delay": "1.5",
            "auto_rotate": "on",
            "fix_year_zero": "on",
            "deduplicate": "on",
            "download_enabled": "",
            "download_batch_size": "100",
            "download_court_filter": "FCA",
        }.get(key, default)
        form.getlist.return_value = ["AATA", "FCA"]

        config = PipelineConfig.from_form(form)
        assert config.databases == ["AATA", "FCA"]
        assert config.start_year == 2023
        assert config.end_year == 2024
        assert config.delay == 1.5


# ── PipelineLog ──────────────────────────────────────────────────────────


class TestPipelineLog:
    def test_add_and_retrieve(self):
        log = PipelineLog()
        log.add("crawl", "info", "test", "Test message")
        events = log.get_events()
        assert len(events) == 1
        assert events[0]["phase"] == "crawl"
        assert events[0]["message"] == "Test message"

    def test_filter_by_phase(self):
        log = PipelineLog()
        log.add("crawl", "info", "a", "msg1")
        log.add("clean", "info", "b", "msg2")
        log.add("crawl", "warn", "c", "msg3")

        crawl_events = log.get_events(phase="crawl")
        assert len(crawl_events) == 2

    def test_filter_by_level(self):
        log = PipelineLog()
        log.add("crawl", "info", "a", "msg1")
        log.add("crawl", "error", "b", "msg2")

        errors = log.get_events(level="error")
        assert len(errors) == 1

    def test_limit(self):
        log = PipelineLog()
        for i in range(10):
            log.add("crawl", "info", "x", f"msg{i}")

        events = log.get_events(limit=3)
        assert len(events) == 3

    def test_error_summary(self):
        log = PipelineLog()
        log.add("crawl", "error", "http_500", "Server error 1")
        log.add("crawl", "error", "http_500", "Server error 2")
        log.add("crawl", "error", "dns_error", "DNS fail")

        summary = log.get_error_summary()
        assert summary["http_500"]["count"] == 2
        assert summary["dns_error"]["count"] == 1

    def test_to_json(self):
        log = PipelineLog()
        log.add("crawl", "info", "test", "msg")
        result = log.to_json()
        assert isinstance(result, list)
        assert result[0]["category"] == "test"

    def test_thread_safety(self):
        """Multiple threads adding events concurrently."""
        log = PipelineLog()
        errors = []

        def add_events(start):
            try:
                for i in range(50):
                    log.add("crawl", "info", "test", f"thread-{start}-{i}")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=add_events, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
        events = log.get_events(limit=500)
        assert len(events) == 200  # 4 threads x 50 events


# ── SmartPipeline ────────────────────────────────────────────────────────


class TestSmartPipeline:
    def _make_config(self, **overrides):
        defaults = {
            "databases": ["AATA"],
            "start_year": 2024,
            "end_year": 2024,
            "delay": 0,
            "download_enabled": False,
        }
        defaults.update(overrides)
        return PipelineConfig(**defaults)

    @patch("immi_case_downloader.sources.austlii.AustLIIScraper")
    def test_crawl_phase_basic(self, mock_scraper_cls, tmp_path):
        """Crawl phase finds and saves cases."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        mock_scraper = mock_scraper_cls.return_value
        case = ImmigrationCase(
            citation="[2024] AATA 1",
            url="https://austlii.edu.au/au/cases/cth/AATA/2024/1.html",
            court_code="AATA",
            year=2024,
            source="AustLII",
        )
        mock_scraper._browse_year.return_value = [case]

        config = self._make_config()
        pipeline = SmartPipeline(config, str(tmp_path))
        pipeline._run_crawl_phase()

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert len(cases) >= 1

    @patch("immi_case_downloader.sources.austlii.AustLIIScraper")
    def test_clean_phase_fix_year(self, mock_cls, tmp_path):
        """Clean phase fixes year=0 from citation."""
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(
            citation="[2023] FCA 100",
            url="https://example.com/1",
            year=0,
            court_code="FCA",
        )
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))

        config = self._make_config(databases=[], fix_year_zero=True)
        pipeline = SmartPipeline(config, str(tmp_path))
        pipeline._run_clean_phase()

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert cases[0].year == 2023

    @patch("immi_case_downloader.sources.austlii.AustLIIScraper")
    def test_clean_phase_dedup(self, mock_cls, tmp_path):
        """Clean phase removes duplicate URLs."""
        ensure_output_dirs(str(tmp_path))
        case1 = ImmigrationCase(citation="A", url="https://example.com/1", court_code="AATA")
        case2 = ImmigrationCase(citation="B", url="https://example.com/1", court_code="AATA")
        case1.ensure_id()
        case2.case_id = "different_id"
        save_cases_csv([case1, case2], str(tmp_path))

        config = self._make_config(databases=[], deduplicate=True)
        pipeline = SmartPipeline(config, str(tmp_path))
        pipeline._run_clean_phase()

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert len(cases) == 1

    def test_stop_requested(self, tmp_path):
        """Pipeline stops when stop is requested."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        config = self._make_config(databases=[])
        pipeline = SmartPipeline(config, str(tmp_path))

        pipeline.request_stop()
        with pipeline._lock:
            pipeline._status["running"] = True

        assert pipeline._is_stopped() is True


# ── Public Helpers ──────────────────────────────────────────────────────


class TestPublicHelpers:
    def test_get_pipeline_status_returns_copy(self):
        """get_pipeline_status returns a deep copy, not a reference."""
        status = get_pipeline_status()
        status["running"] = True
        # Original should not be affected
        original = get_pipeline_status()
        assert original["running"] != status["running"] or original is not status

    def test_request_pipeline_stop(self):
        """request_pipeline_stop sets the stop flag on the active pipeline."""
        import immi_case_downloader.pipeline as pl
        config = PipelineConfig()
        p = SmartPipeline(config, output_dir="/tmp/test_req_stop")
        old = pl._active_pipeline
        pl._active_pipeline = p
        try:
            request_pipeline_stop()
            assert p.get_status()["stop_requested"] is True
        finally:
            pl._active_pipeline = old

    @patch("immi_case_downloader.pipeline.threading.Thread")
    def test_start_pipeline_returns_true(self, mock_thread_cls):
        """start_pipeline returns True when no pipeline is running."""
        import immi_case_downloader.pipeline as pl
        old = pl._active_pipeline
        pl._active_pipeline = None
        try:
            config = PipelineConfig()
            result = start_pipeline(config)
            assert result is True
        finally:
            pl._active_pipeline = old

    def test_start_pipeline_rejects_when_active_is_running(self):
        """start_pipeline returns False when the active pipeline is running."""
        import immi_case_downloader.pipeline as pl
        config = PipelineConfig()
        p = SmartPipeline(config, output_dir="/tmp/test_active_running")
        with p._lock:
            p._status["running"] = True
        old = pl._active_pipeline
        pl._active_pipeline = p
        try:
            second = start_pipeline(config)
            assert second is False
        finally:
            pl._active_pipeline = old

    def test_start_pipeline_rejects_when_running(self):
        """start_pipeline returns False when pipeline is already running."""
        import immi_case_downloader.pipeline as pl
        config = PipelineConfig()
        p = SmartPipeline(config, output_dir="/tmp/test_reject")
        with p._lock:
            p._status["running"] = True
        old = pl._active_pipeline
        pl._active_pipeline = p
        try:
            result = start_pipeline(config)
            assert result is False
        finally:
            pl._active_pipeline = old

    def test_retryable_errors_defined(self):
        assert "http_500" in RETRYABLE_ERRORS
        assert "http_timeout" in RETRYABLE_ERRORS
        assert "connection_error" in RETRYABLE_ERRORS
