"""Tests for immi_case_downloader.cli merge and dedup logic."""

from argparse import Namespace
from unittest.mock import patch


from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.cli import cmd_search, cmd_download, cmd_list_databases
from immi_case_downloader.storage import (
    ensure_output_dirs,
    save_cases_csv,
    load_all_cases,
)


def _make_args(tmp_path, **overrides):
    """Build a minimal args namespace for cmd_search."""
    defaults = {
        "output": str(tmp_path),
        "sources": ["austlii"],
        "databases": ["AATA"],
        "start_year": 2024,
        "end_year": 2024,
        "max_results": 10,
        "delay": 0,
        "verbose": False,
    }
    defaults.update(overrides)
    return Namespace(**defaults)


def _make_case(citation, url, **kwargs):
    case = ImmigrationCase(citation=citation, url=url, source="AustLII", **kwargs)
    case.ensure_id()
    return case


class TestCmdSearchMerge:
    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_merges_new_with_existing(self, mock_scraper_cls, tmp_path):
        """New cases are appended; existing CSV is not overwritten."""
        ensure_output_dirs(str(tmp_path))
        existing = _make_case("[2024] AATA 1", "https://austlii/1")
        save_cases_csv([existing], str(tmp_path))

        new_case = _make_case("[2024] AATA 2", "https://austlii/2")
        mock_scraper_cls.return_value.search_cases.return_value = [new_case]

        args = _make_args(tmp_path)
        cmd_search(args)

        all_cases = load_all_cases(str(tmp_path))
        urls = {c.url for c in all_cases}
        assert "https://austlii/1" in urls
        assert "https://austlii/2" in urls
        assert len(all_cases) == 2

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_deduplicates_by_url(self, mock_scraper_cls, tmp_path):
        """Cases with same URL are not duplicated."""
        ensure_output_dirs(str(tmp_path))
        existing = _make_case("[2024] AATA 1", "https://austlii/1")
        save_cases_csv([existing], str(tmp_path))

        duplicate = _make_case("[2024] AATA 1 dup", "https://austlii/1")
        mock_scraper_cls.return_value.search_cases.return_value = [duplicate]

        args = _make_args(tmp_path)
        cmd_search(args)

        all_cases = load_all_cases(str(tmp_path))
        assert len(all_cases) == 1

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_assigns_ids(self, mock_scraper_cls, tmp_path):
        """New cases get IDs assigned."""
        ensure_output_dirs(str(tmp_path))
        new_case = ImmigrationCase(
            citation="[2024] AATA 99",
            url="https://austlii/99",
            source="AustLII",
        )
        mock_scraper_cls.return_value.search_cases.return_value = [new_case]

        args = _make_args(tmp_path)
        cmd_search(args)

        all_cases = load_all_cases(str(tmp_path))
        assert all(c.case_id != "" for c in all_cases)

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_preserves_existing_fields(self, mock_scraper_cls, tmp_path):
        """Existing case_nature / legal_concepts are not lost on merge."""
        ensure_output_dirs(str(tmp_path))
        existing = _make_case(
            "[2024] AATA 1",
            "https://austlii/1",
            case_nature="Visa Refusal",
            legal_concepts="Section 501",
        )
        save_cases_csv([existing], str(tmp_path))

        mock_scraper_cls.return_value.search_cases.return_value = []

        args = _make_args(tmp_path)
        cmd_search(args)

        reloaded = load_all_cases(str(tmp_path))
        assert reloaded[0].case_nature == "Visa Refusal"
        assert reloaded[0].legal_concepts == "Section 501"

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_handles_empty_csv(self, mock_scraper_cls, tmp_path):
        """Works when no CSV exists yet."""
        ensure_output_dirs(str(tmp_path))
        new_case = _make_case("[2024] AATA 1", "https://austlii/1")
        mock_scraper_cls.return_value.search_cases.return_value = [new_case]

        args = _make_args(tmp_path)
        cmd_search(args)

        all_cases = load_all_cases(str(tmp_path))
        assert len(all_cases) == 1


class TestCmdDownload:
    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_skips_already_downloaded(self, mock_scraper_cls, tmp_path):
        """Cases with existing full_text_path on disk are skipped."""
        ensure_output_dirs(str(tmp_path))
        text_dir = tmp_path / "case_texts"
        text_dir.mkdir(exist_ok=True)
        text_file = text_dir / "existing.txt"
        text_file.write_text("existing text")

        case = _make_case("[2024] AATA 1", "https://austlii/1")
        case.full_text_path = str(text_file)
        save_cases_csv([case], str(tmp_path))

        mock_instance = mock_scraper_cls.return_value
        args = Namespace(
            output=str(tmp_path),
            courts=None,
            limit=None,
            delay=0,
            verbose=False,
        )
        cmd_download(args)
        mock_instance.download_case_detail.assert_not_called()

    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_merges_metadata_back(self, mock_scraper_cls, tmp_path):
        """Downloaded metadata is merged back to all_cases."""
        ensure_output_dirs(str(tmp_path))
        case = _make_case("[2024] AATA 1", "https://austlii/1")
        save_cases_csv([case], str(tmp_path))

        mock_instance = mock_scraper_cls.return_value
        mock_instance.download_case_detail.return_value = "Full judgment text"

        args = Namespace(
            output=str(tmp_path),
            courts=None,
            limit=1,
            delay=0,
            verbose=False,
        )

        with patch("immi_case_downloader.cli.save_case_text") as mock_save_text:
            mock_save_text.side_effect = lambda case, text, base: setattr(
                case, "full_text_path", f"{base}/case_texts/test.txt"
            ) or f"{base}/case_texts/test.txt"
            cmd_download(args)

        reloaded = load_all_cases(str(tmp_path))
        assert len(reloaded) == 1


class TestCmdListDatabases:
    def test_prints_databases(self, capsys):
        args = Namespace(verbose=False)
        cmd_list_databases(args)
        output = capsys.readouterr().out
        assert "AATA" in output
        assert "FCA" in output
        assert "Federal Court" in output
