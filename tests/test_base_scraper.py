"""Tests for immi_case_downloader.sources.base — Phase 2 Issue 2.2."""

import time

import requests
import responses

from immi_case_downloader.sources.base import BaseScraper
from immi_case_downloader.config import USER_AGENT, MAX_RETRIES


class TestSessionConfiguration:
    def test_user_agent_set(self):
        """Session User-Agent matches config."""
        scraper = BaseScraper(delay=0)
        assert scraper.session.headers["User-Agent"] == USER_AGENT

    def test_retry_adapter_installed(self):
        """HTTPS and HTTP adapters with retry are mounted."""
        scraper = BaseScraper(delay=0)
        https_adapter = scraper.session.get_adapter("https://example.com")
        http_adapter = scraper.session.get_adapter("http://example.com")
        assert https_adapter.max_retries.total == MAX_RETRIES
        assert http_adapter.max_retries.total == MAX_RETRIES

    def test_default_delay(self):
        """Default delay is from config.REQUEST_DELAY."""
        from immi_case_downloader.config import REQUEST_DELAY
        scraper = BaseScraper()
        assert scraper.delay == REQUEST_DELAY

    def test_custom_delay(self):
        scraper = BaseScraper(delay=2.5)
        assert scraper.delay == 2.5


class TestRateLimit:
    def test_no_delay_first_request(self):
        """First request should not sleep."""
        scraper = BaseScraper(delay=5.0)
        start = time.time()
        scraper._rate_limit()
        elapsed = time.time() - start
        assert elapsed < 1.0

    def test_enforces_delay(self):
        """Subsequent requests respect the delay."""
        scraper = BaseScraper(delay=0.2)
        scraper._rate_limit()  # first: no delay
        start = time.time()
        scraper._rate_limit()  # second: should wait ~0.2s
        elapsed = time.time() - start
        assert elapsed >= 0.15  # allow small tolerance

    def test_no_delay_if_enough_time_passed(self):
        """If enough time passed since last request, no delay."""
        scraper = BaseScraper(delay=0.1)
        scraper._last_request_time = time.time() - 1.0  # 1 second ago
        start = time.time()
        scraper._rate_limit()
        elapsed = time.time() - start
        assert elapsed < 0.05


class TestFetch:
    @responses.activate
    def test_success_returns_response(self):
        """Successful fetch returns the Response object."""
        responses.add(responses.GET, "https://example.com/page", body="OK", status=200)
        scraper = BaseScraper(delay=0)
        resp = scraper.fetch("https://example.com/page")
        assert resp is not None
        assert resp.text == "OK"
        assert scraper.last_error is None

    @responses.activate
    def test_timeout_error(self):
        """Timeout returns None with http_timeout category."""
        responses.add(
            responses.GET, "https://example.com/slow",
            body=requests.Timeout("timed out"),
        )
        scraper = BaseScraper(delay=0)
        resp = scraper.fetch("https://example.com/slow")
        assert resp is None
        assert scraper.last_error["category"] == "http_timeout"
        assert scraper.last_error["url"] == "https://example.com/slow"

    @responses.activate
    def test_dns_error(self):
        """DNS failure returns None with dns_error category."""
        responses.add(
            responses.GET, "https://bad.example.com/",
            body=requests.ConnectionError("Name or service not known"),
        )
        scraper = BaseScraper(delay=0)
        resp = scraper.fetch("https://bad.example.com/")
        assert resp is None
        assert scraper.last_error["category"] == "dns_error"

    @responses.activate
    def test_connection_error(self):
        """Non-DNS connection error returns connection_error category."""
        responses.add(
            responses.GET, "https://example.com/down",
            body=requests.ConnectionError("Connection refused"),
        )
        scraper = BaseScraper(delay=0)
        resp = scraper.fetch("https://example.com/down")
        assert resp is None
        assert scraper.last_error["category"] == "connection_error"

    @responses.activate
    def test_http_404(self):
        """404 returns http_404 category."""
        responses.add(responses.GET, "https://example.com/missing", status=404)
        scraper = BaseScraper(delay=0)
        resp = scraper.fetch("https://example.com/missing")
        assert resp is None
        assert scraper.last_error["category"] == "http_404"
        assert scraper.last_error["status"] == 404

    @responses.activate
    def test_http_410(self):
        """410 (AustLII block) returns http_410 category."""
        responses.add(responses.GET, "https://example.com/blocked", status=410)
        scraper = BaseScraper(delay=0)
        resp = scraper.fetch("https://example.com/blocked")
        assert resp is None
        assert scraper.last_error["category"] == "http_410"

    @responses.activate
    def test_generic_request_error(self):
        """Generic RequestException returns request_error category."""
        responses.add(
            responses.GET, "https://example.com/err",
            body=requests.RequestException("weird error"),
        )
        scraper = BaseScraper(delay=0)
        resp = scraper.fetch("https://example.com/err")
        assert resp is None
        assert scraper.last_error["category"] == "request_error"

    @responses.activate
    def test_last_error_cleared_on_success(self):
        """Successful fetch clears previous last_error."""
        scraper = BaseScraper(delay=0)
        scraper.last_error = {"category": "old_error"}
        responses.add(responses.GET, "https://example.com/ok", body="OK", status=200)
        resp = scraper.fetch("https://example.com/ok")
        assert resp is not None
        assert scraper.last_error is None

    @responses.activate
    def test_fetch_with_params(self):
        """Params are passed to the session.get call."""
        responses.add(responses.GET, "https://example.com/search", body="results", status=200)
        scraper = BaseScraper(delay=0)
        resp = scraper.fetch("https://example.com/search", params={"q": "test"})
        assert resp is not None
        assert "q=test" in responses.calls[0].request.url
