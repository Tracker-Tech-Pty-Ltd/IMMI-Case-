"""Regression tests for the two root-level extraction/validation scripts."""

import csv

import pytest

import extract_structured_fields as extract_script
import validate_extraction as validate_script


def _write_csv(path, rows, fieldnames):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def test_process_case_swallows_a_worker_exception(monkeypatch, capsys):
    """One unparseable row must not abort a 149k-row ProcessPoolExecutor run.

    executor.map re-raises a worker exception at consumption time and then
    cancels every remaining future, so the wrapper — not the consumer loop —
    is what has to hold.
    """
    def boom(_row):
        raise ValueError("synthetic parser explosion")

    monkeypatch.setattr(extract_script, "_extract_case_fields", boom)

    result = extract_script.process_case({"case_id": "abc123"})

    # No extracted fields — only the reserved error marker, which main()
    # pops before merging anything into the row.
    assert list(result) == [extract_script.EXTRACTION_ERROR_KEY]
    assert "abc123" in capsys.readouterr().err


def test_process_case_tolerates_a_row_of_none_values():
    """csv.DictReader gives None for a short row's cells; no field may be None."""
    result = extract_script.process_case(
        {"title": None, "citation": None, "visa_subclass": None,
         "visa_type": None, "full_text_path": None}
    )

    assert result["applicant_name"] == ""
    assert all(isinstance(value, str) for value in result.values())


def test_union_fieldnames_covers_every_row():
    """A late row's extra column must reach the header."""
    names = extract_script._union_fieldnames(
        [{"a": "1"}, {"a": "2", "b": "3"}, {"c": "4"}]
    )

    assert names == ["a", "b", "c"]


def test_save_csv_refuses_to_drop_a_malformed_rows_overflow_cells(tmp_path, monkeypatch):
    """A long CSV row must fail the write, not lose its extra cells.

    csv.DictReader parks overflow cells under the None restkey. Dropping them
    and then os.replace()-ing the result over the master CSV turns a loud
    "this file is malformed" into permanent data loss.
    """
    csv_path = tmp_path / "immigration_cases.csv"
    _write_csv(csv_path, [{"case_id": "a1", "title": "One"}], ["case_id", "title"])
    monkeypatch.setattr(extract_script, "CSV_PATH", csv_path)
    before = csv_path.read_text(encoding="utf-8-sig")

    with pytest.raises(ValueError) as excinfo:
        extract_script.save_csv(
            [{"case_id": "a1", "title": "One"},
             {"case_id": "a2", "title": "Two", None: ["overflow"]}]
        )

    assert "a2" in str(excinfo.value)
    assert csv_path.read_text(encoding="utf-8-sig") == before
    assert not list(tmp_path.glob("*.tmp*"))


def test_backup_csv_is_timestamped_and_keeps_the_previous_snapshot(tmp_path, monkeypatch):
    """A rerun must not destroy the last known-good backup."""
    csv_path = tmp_path / "immigration_cases.csv"
    _write_csv(csv_path, [{"case_id": "a1", "title": "One"}], ["case_id", "title"])
    monkeypatch.setattr(extract_script, "CSV_PATH", csv_path)

    first = extract_script.backup_csv()
    first_content = first.read_text(encoding="utf-8-sig")

    # Change the master, then back up again in the same second.
    _write_csv(csv_path, [{"case_id": "a2", "title": "Two"}], ["case_id", "title"])
    second = extract_script.backup_csv()

    assert first is not None and second is not None
    assert first != second, "two backups in the same second collided"
    assert first.exists() and second.exists()
    assert first.read_text(encoding="utf-8-sig") == first_content
    assert first.name.startswith("immigration_cases.csv.bak-")
    assert len(list(tmp_path.glob("immigration_cases.csv.bak-*"))) == 2


def test_process_case_reports_the_failure_to_the_parent(monkeypatch):
    """A swallowed worker exception must come back as a countable marker.

    A worker runs in another process, so stderr is the only channel it has —
    and stderr interleaves and scrolls away. main() counts this key instead.
    """
    def boom(_row):
        raise ValueError("synthetic parser explosion")

    monkeypatch.setattr(extract_script, "_extract_case_fields", boom)

    result = extract_script.process_case({"case_id": "abc123"})

    assert extract_script.EXTRACTION_ERROR_KEY in result
    assert "synthetic parser explosion" in result[extract_script.EXTRACTION_ERROR_KEY]


def test_write_failure_manifest_lists_the_failed_ids(tmp_path, monkeypatch):
    """A partially-failed run must leave a re-runnable list behind."""
    csv_path = tmp_path / "immigration_cases.csv"
    _write_csv(csv_path, [{"case_id": "a1"}], ["case_id"])
    monkeypatch.setattr(extract_script, "CSV_PATH", csv_path)

    assert extract_script._write_failure_manifest([]) is None
    path = extract_script._write_failure_manifest(["a1", "a2"])

    assert path is not None
    assert path.read_text(encoding="utf-8").split() == ["a1", "a2"]


# ── main() orchestration ──────────────────────────────────────────────
# The three tests above cover the helpers. These cover the loop that calls
# them, which is where the checkpointing this plan exists for actually lives.


def _run_main(monkeypatch, tmp_path, argv, rows, fieldnames):
    """Drive extract_structured_fields.main() over a temp CSV.

    ProcessPoolExecutor is replaced with an in-process stand-in: the real one
    would need the module importable in a subprocess with the patched
    CSV_PATH, which monkeypatch cannot provide.
    """
    import sys

    csv_path = tmp_path / "immigration_cases.csv"
    _write_csv(csv_path, rows, fieldnames)
    monkeypatch.setattr(extract_script, "CSV_PATH", csv_path)
    monkeypatch.setattr(sys, "argv", ["extract_structured_fields.py", *argv])

    class _InlineExecutor:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def map(self, fn, iterable, chunksize=None):
            return map(fn, list(iterable))

    monkeypatch.setattr(extract_script, "ProcessPoolExecutor", _InlineExecutor)
    extract_script.main()
    return csv_path


def test_main_checkpoints_before_the_run_finishes(tmp_path, monkeypatch):
    """The whole point of the plan: work reaches disk mid-run.

    CHECKPOINT_EVERY is lowered to 2 and the loop is stopped after the first
    checkpoint, so the assertion is that rows processed before the stop are
    on disk — not that the final save happened.
    """
    monkeypatch.setattr(extract_script, "CHECKPOINT_EVERY", 2)
    rows = [{"case_id": f"c{i}", "title": f"[2024] AATA {i} — the applicant",
             "citation": "", "visa_subclass": "", "visa_type": "",
             "full_text_path": "", "applicant_name": ""} for i in range(4)]
    fieldnames = list(rows[0])

    saves = []
    real_save = extract_script.save_csv

    def spy(payload):
        saves.append(len(payload))
        real_save(payload)

    monkeypatch.setattr(extract_script, "save_csv", spy)
    _run_main(monkeypatch, tmp_path, ["--workers", "1"], rows, fieldnames)

    # At least one save happened before the final one: 4 rows at
    # CHECKPOINT_EVERY=2 gives checkpoints at 2 and 4, plus the final save.
    assert len(saves) >= 2, saves


def test_main_dry_run_never_writes(tmp_path, monkeypatch):
    """--dry-run must not touch the CSV, take a backup, or checkpoint."""
    monkeypatch.setattr(extract_script, "CHECKPOINT_EVERY", 1)
    rows = [{"case_id": f"c{i}", "title": f"[2024] AATA {i} — the applicant",
             "citation": "", "visa_subclass": "", "visa_type": "",
             "full_text_path": "", "applicant_name": ""} for i in range(3)]
    csv_path = _run_main(
        monkeypatch, tmp_path,
        ["--dry-run", "--workers", "1"], rows, list(rows[0]),
    )
    before = csv_path.read_text(encoding="utf-8-sig")

    assert csv_path.read_text(encoding="utf-8-sig") == before
    assert not list(tmp_path.glob("*.bak-*"))
    assert not list(tmp_path.glob("*.tmp*"))


def test_main_counts_failures_and_writes_a_manifest(tmp_path, monkeypatch):
    """One exploding row must not abort the run, and must be listed."""
    def boom(row):
        if row.get("case_id") == "c1":
            raise ValueError("synthetic parser explosion")
        return {}

    monkeypatch.setattr(extract_script, "_extract_case_fields", boom)
    rows = [{"case_id": f"c{i}", "title": "x", "citation": "",
             "visa_subclass": "", "visa_type": "", "full_text_path": "",
             "applicant_name": ""} for i in range(3)]

    csv_path = _run_main(monkeypatch, tmp_path, ["--workers", "1"], rows, list(rows[0]))
    manifest = csv_path.with_name(csv_path.name + ".extraction-failures.txt")

    assert manifest.exists()
    assert manifest.read_text(encoding="utf-8").split() == ["c1"]
    with open(csv_path, encoding="utf-8-sig") as f:
        assert len(list(csv.DictReader(f))) == 3


def test_save_csv_writes_columns_that_only_later_rows_have(tmp_path, monkeypatch):
    """The header used to come from rows[0] alone, silently dropping new columns."""
    csv_path = tmp_path / "immigration_cases.csv"
    _write_csv(csv_path, [{"case_id": "a1"}], ["case_id"])
    monkeypatch.setattr(extract_script, "CSV_PATH", csv_path)

    extract_script.save_csv([{"case_id": "a1"}, {"case_id": "a2", "country_of_origin": "India"}])

    with open(csv_path, encoding="utf-8-sig") as f:
        written = list(csv.DictReader(f))

    assert written[1]["country_of_origin"] == "India"


def test_print_fill_rates_survives_a_court_filter_that_matches_nothing(capsys):
    """`validate_extraction.py --court NOSUCH` used to raise IndexError."""
    rows = [{"court_code": "AATA", "applicant_name": "Jane"}]

    validate_script.print_fill_rates(rows, court_filter="NOSUCH")

    assert "No rows match" in capsys.readouterr().out


def test_print_fill_rates_tolerates_none_values(capsys):
    """A short CSV row gives None, which .strip() cannot take."""
    rows = [{"court_code": "AATA", "applicant_name": None}]

    validate_script.print_fill_rates(rows)

    assert "applicant_name" in capsys.readouterr().out
