"""Extended CLI tests — covers cmd_search, cmd_download argument parsing."""

import os
from unittest.mock import patch
from argparse import Namespace

import pytest

from immi_case_downloader.cli import cmd_search, cmd_download, cmd_list_databases, main
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.storage import ensure_output_dirs, save_cases_csv


class TestCmdSearchExtended:
    def _make_args(self, tmp_path, **overrides):
        defaults = {
            "output": str(tmp_path),
            "delay": 0,
            "sources": ["austlii"],
            "databases": ["AATA"],
            "start_year": 2024,
            "end_year": 2024,
            "max_results": 10,
        }
        defaults.update(overrides)
        return Namespace(**defaults)

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_search_no_results(self, mock_cls, tmp_path):
        """cmd_search with no results prints message and returns."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        mock_scraper = mock_cls.return_value
        mock_scraper.search_cases.return_value = []

        args = self._make_args(tmp_path)
        cmd_search(args)  # should not raise

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_search_finds_cases(self, mock_cls, tmp_path):
        """cmd_search saves found cases to CSV."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        case = ImmigrationCase(
            citation="[2024] AATA 1",
            url="https://example.com/case1",
            court_code="AATA",
            year=2024,
            source="AustLII",
        )
        mock_scraper = mock_cls.return_value
        mock_scraper.search_cases.return_value = [case]

        args = self._make_args(tmp_path)
        cmd_search(args)

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert len(cases) == 1

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_search_merges_with_existing(self, mock_cls, tmp_path):
        """cmd_search merges new cases with existing ones."""
        ensure_output_dirs(str(tmp_path))
        existing = ImmigrationCase(
            citation="[2023] AATA 99",
            url="https://example.com/existing",
            court_code="AATA",
            year=2023,
        )
        existing.ensure_id()
        save_cases_csv([existing], str(tmp_path))

        new_case = ImmigrationCase(
            citation="[2024] AATA 1",
            url="https://example.com/new",
            court_code="AATA",
            year=2024,
            source="AustLII",
        )
        mock_scraper = mock_cls.return_value
        mock_scraper.search_cases.return_value = [new_case]

        args = self._make_args(tmp_path)
        cmd_search(args)

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert len(cases) == 2

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_search_deduplicates_by_url(self, mock_cls, tmp_path):
        """cmd_search skips cases with existing URLs."""
        ensure_output_dirs(str(tmp_path))
        existing = ImmigrationCase(
            citation="[2023] AATA 99",
            url="https://example.com/same",
            court_code="AATA",
        )
        existing.ensure_id()
        save_cases_csv([existing], str(tmp_path))

        dupe = ImmigrationCase(
            citation="[2024] AATA 1",
            url="https://example.com/same",  # same URL
            court_code="AATA",
            source="AustLII",
        )
        mock_scraper = mock_cls.return_value
        mock_scraper.search_cases.return_value = [dupe]

        args = self._make_args(tmp_path)
        cmd_search(args)

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert len(cases) == 1  # no duplicate added

    @patch("immi_case_downloader.cli.FederalCourtScraper")
    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_search_all_sources(self, mock_austlii_cls, mock_fc_cls, tmp_path):
        """cmd_search with sources=['all'] searches both AustLII and Federal Court."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        mock_austlii_cls.return_value.search_cases.return_value = [
            ImmigrationCase(citation="A", url="https://a.com/1", court_code="AATA", source="AustLII")
        ]
        mock_fc_cls.return_value.search_cases.return_value = [
            ImmigrationCase(citation="B", url="https://b.com/1", court_code="FCA", source="Federal Court")
        ]

        args = self._make_args(tmp_path, sources=["all"], databases=["AATA"])
        cmd_search(args)

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert len(cases) == 2


class TestCmdDownloadExtended:
    def _make_args(self, tmp_path, **overrides):
        defaults = {
            "output": str(tmp_path),
            "delay": 0,
            "courts": None,
            "limit": None,
        }
        defaults.update(overrides)
        return Namespace(**defaults)

    def test_download_no_cases(self, tmp_path):
        """cmd_download with no cases prints message and returns."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))
        args = self._make_args(tmp_path)
        cmd_download(args)  # should not raise

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_download_with_cases(self, mock_austlii_cls, tmp_path):
        """cmd_download downloads text for cases without full_text_path."""
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(
            citation="[2024] AATA 1",
            url="https://example.com/1",
            court_code="AATA",
            source="AustLII",
        )
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))

        mock_scraper = mock_austlii_cls.return_value
        mock_scraper.download_case_detail.return_value = "Full text content here."

        args = self._make_args(tmp_path, limit=1)
        cmd_download(args)

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_download_skips_existing(self, mock_cls, tmp_path):
        """cmd_download skips cases that already have text files."""
        ensure_output_dirs(str(tmp_path))
        text_dir = os.path.join(str(tmp_path), "case_texts")
        os.makedirs(text_dir, exist_ok=True)

        text_file = os.path.join(text_dir, "test.txt")
        with open(text_file, "w") as f:
            f.write("existing text")

        case = ImmigrationCase(
            citation="[2024] AATA 1",
            url="https://example.com/1",
            court_code="AATA",
            full_text_path=text_file,
        )
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))

        args = self._make_args(tmp_path)
        cmd_download(args)

        # Should not call download since the file already exists
        mock_cls.return_value.download_case_detail.assert_not_called()

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_download_court_filter(self, mock_cls, tmp_path):
        """cmd_download with --courts filters cases."""
        ensure_output_dirs(str(tmp_path))
        aata = ImmigrationCase(citation="A", url="https://a.com/1", court_code="AATA")
        fca = ImmigrationCase(citation="B", url="https://b.com/1", court_code="FCA")
        aata.ensure_id()
        fca.ensure_id()
        save_cases_csv([aata, fca], str(tmp_path))

        mock_scraper = mock_cls.return_value
        mock_scraper.download_case_detail.return_value = "Text"

        args = self._make_args(tmp_path, courts=["FCA"])
        cmd_download(args)

        # Only FCA case should be downloaded
        assert mock_scraper.download_case_detail.call_count == 1

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_download_handles_failure(self, mock_cls, tmp_path):
        """cmd_download handles download failures gracefully."""
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(
            citation="[2024] AATA 1",
            url="https://example.com/1",
            court_code="AATA",
        )
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))

        mock_scraper = mock_cls.return_value
        mock_scraper.download_case_detail.return_value = None  # failed

        args = self._make_args(tmp_path)
        cmd_download(args)  # should not raise


class TestCmdListDatabases:
    def test_lists_databases(self, capsys):
        args = Namespace(output=".", verbose=False)
        cmd_list_databases(args)
        captured = capsys.readouterr()
        assert "AATA" in captured.out
        assert "FCA" in captured.out
        assert "ARTA" in captured.out


class TestMainFunction:
    def test_no_command_exits(self):
        """main() with no command should exit with code 1."""
        with pytest.raises(SystemExit) as exc_info:
            import sys
            with patch.object(sys, "argv", ["immi", ]):
                main()
        assert exc_info.value.code == 1
