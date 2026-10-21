"""Regression and interruption tests, runnable without the web fixture stack."""
import csv
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from immi_case_downloader.csv_write_lock import CatalogLockedError, catalog_lock, csv_write_lock
from immi_case_downloader.extraction.grounded import assess_case, document_text, verified_metadata
from immi_case_downloader.repair_workflow import apply_approved, recover, review_catalogue, verify_stores

HEAD = "Example v Minister [2024] FCA 12\n"
BODY = HEAD + "JUDGE:\nSMITH J\nORDERS:\n1. The application is dismissed.\nREASONS FOR JUDGMENT\nThe decision under review was the decision to refuse a protection visa.\n"


class GroundedTests(unittest.TestCase):
    def assess(self, body):
        return assess_case(body, citation="[2024] FCA 12")

    def test_current_published_evidence(self):
        result = self.assess(BODY)
        self.assertEqual({k: v.value for k, v in result.values.items()},
                         {"judges": "SMITH J", "outcome": "1. The application is dismissed.", "visa_type": "protection visa"})

    def test_table_cells_and_inline_orders_are_retained(self):
        html = "<html><nav>Other [2000] FCA 1</nav><body>" + HEAD + "<table><tr><th>JUDGE:</th><td>SMITH J</td></tr><tr><th>DECISION:</th><td>The Tribunal affirms the decision.</td></tr></table><p>REASONS FOR DECISION</p></body></html>"
        result = self.assess(html)
        self.assertEqual(result.values["judges"].value, "SMITH J")
        self.assertEqual(result.values["outcome"].value, "The Tribunal affirms the decision.")

    def test_inline_tribunal_decision(self):
        result = self.assess(HEAD + "PRESIDING MEMBER: Jane Smith\nDECISION: The Tribunal affirms the decision under review.\nSTATEMENT OF DECISION AND REASONS")
        self.assertEqual(result.values["judges"].value, "Jane Smith")
        self.assertEqual(result.values["outcome"].value, "The Tribunal affirms the decision under review.")

    def test_no_guesses_from_title_and_cited_judge(self):
        result = self.assess(HEAD + "REASONS FOR JUDGMENT\nIn Another v Minister [2001] FCA 10, Judge Jones dismissed the application.")
        self.assertEqual(result.values, {})

    def test_conflicting_identity_blocks_every_field(self):
        result = assess_case(BODY, citation="[2024] FCA 13")
        self.assertEqual(result.source_status, "identity_conflict")
        self.assertEqual(result.values, {})

    def test_date_is_not_a_judge(self):
        self.assertNotIn("judges", self.assess(HEAD + "JUDGE:\nDATE: 12 February 2024\n").values)

    def test_damaged_tribunal_venue_or_bare_role_is_not_author(self):
        for value in ("Sydney", "Melbourne", "Deputy President", "Senior Member"):
            self.assertNotIn("judges", self.assess(HEAD + f"Tribunal: {value}\nPlace: Sydney\n").values)

    def test_formal_heading_is_not_catchword_or_decision_date(self):
        self.assertNotIn("outcome", self.assess(HEAD + "Decision date: 1 June 2024\nCatchwords: appeal dismissed\n").values)

    def test_proposed_and_incomplete_orders_are_held(self):
        for block in ("I propose to dismiss the appeal.", "The matter is adjourned for further hearing in accordance with the reasons.", "The application is dismissed ...", "The application is dismissed and"):
            with self.subTest(block=block):
                self.assertNotIn("outcome", self.assess(HEAD + "ORDERS:\n" + block + "\nREASONS FOR JUDGMENT").values)

    def test_old_visas_and_bare_program_are_held(self):
        for sentence in ("The applicant applied for a student visa in 1999.", "The applicant arrived on a visitor visa.", "The application concerned Temporary Business Entry.", "Section 338 provides that a decision to refuse a bridging visa may be reviewed.", "The respondent is entitled to refuse a protection visa.", "The applicant claims he was refused a carer visa."):
            with self.subTest(sentence=sentence):
                self.assertNotIn("visa_type", self.assess(HEAD + sentence).values)

    def test_conflicting_visa_candidates_are_held(self):
        body = HEAD + "The decision under review was to refuse a student visa.\nThe decision under review was to refuse a protection visa."
        self.assertNotIn("visa_type", self.assess(body).values)

    def test_trusted_preamble_subclass(self):
        result = self.assess(HEAD + "CATCHWORDS: Review of visa refusal - Subclass 103 (Parent) - sponsorship\nREVIEW APPLICANT: AL\n")
        self.assertEqual(result.values["visa_type"].value, "Subclass 103 (Parent)")

    def test_payment_card_case_is_not_visa_case(self):
        body = "Spotwire v Visa International [2024] FCA 12\nCATCHWORDS: TRADE PRACTICES and CONTRACT"
        self.assertIn("visa_type", self.assess(body).not_applicable)

    def test_visa_applicant_na_does_not_mean_visa_type_na(self):
        result = self.assess(HEAD + "VISA APPLICANT: N/A\nThe decision to refuse the visa was made on 23 December 2002.")
        self.assertNotIn("visa_type", result.not_applicable)
        self.assertNotIn("visa_type", result.values)

    def test_provenance_does_not_override_printed_case(self):
        body = "Title: Catalogued case\nCitation: [2024] FCA 12\n" + "=" * 60 + "\nActual case [2024] FCA 13\nJUDGE: SMITH J"
        self.assertEqual(self.assess(body).source_status, "identity_conflict")

    def test_legitimate_separator_is_preserved(self):
        body = HEAD + "=" * 60 + "\nJUDGE: SMITH J\n"
        self.assertIn(HEAD.strip(), document_text(body))

    def test_legacy_ancillary_preserved_unsafe_core_removed(self):
        result = verified_metadata(HEAD + "A visitor visa was held in 1999.",
                                   {"date": "1 May 2024", "visa_type": "visitor visa", "judges": "DATE:"},
                                   citation="[2024] FCA 12", title="Example", url="")
        self.assertEqual(result, {"date": "1 May 2024"})


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / "downloaded_cases"
        self.data.mkdir()
        self.source = self.data / "case.txt"
        self.source.write_text(BODY, encoding="utf-8")
        self.rows = [{"case_id": "a", "citation": "[2024] FCA 12", "title": "Example v Minister",
                      "url": "https://www.austlii.edu.au/au/cases/cth/FCA/2024/12.html",
                      "judges": "", "outcome": "", "visa_type": "", "user_notes": "Keep my notes",
                      "full_text_path": "downloaded_cases/case.txt"},
                     {"case_id": "b", "citation": "[2024] FCA 13", "title": "Other",
                      "url": "", "judges": "Correct J", "outcome": "Allowed", "visa_type": "Subclass 866",
                      "user_notes": "", "full_text_path": ""}]
        db = sqlite3.connect(self.data / "cases.db")
        db.execute("CREATE TABLE cases (" + ",".join(f'{x} TEXT' for x in self.rows[0]) + ")")
        db.executemany("INSERT INTO cases VALUES (" + ",".join("?" for _ in self.rows[0]) + ")", [tuple(r.values()) for r in self.rows])
        db.execute("CREATE TABLE other_data (note TEXT)")
        db.execute("INSERT INTO other_data VALUES ('untouched')")
        db.commit()
        db.close()
        self.save_exports()
        self.ledger = self.data / "reviews.sqlite3"

    def tearDown(self):
        self.temp.cleanup()

    def save_exports(self):
        with (self.data / "immigration_cases.csv").open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(self.rows[0]))
            writer.writeheader()
            writer.writerows(self.rows)
        (self.data / "immigration_cases.json").write_text(json.dumps({"version": 12, "cases": self.rows + [dict(self.rows[1], case_id="extra-json-only")]}), encoding="utf-8")

    def review(self, name="review", **kwargs):
        return review_catalogue(self.root, self.root / name, ledger=self.ledger, **kwargs)

    def approvals(self):
        self.review()
        result = json.loads((self.root / "review/proposals.json").read_text(encoding="utf-8"))
        for row in result:
            row.update(reviewer="independent-test-review", review_note="Published operative header and current-review relationship checked")
        return result

    def test_repeat_skips_all_unchanged_evidence(self):
        self.review()
        result = self.review("second")
        self.assertEqual(result["counts"]["unchanged_evidence_skipped"], 3)
        self.assertNotIn("reviewed", result["counts"])
        self.assertEqual(result["network_requests"], 0)
        self.assertEqual(result["new_provider_usd"], 0)

    def test_source_change_reopens_review(self):
        self.review()
        self.source.write_text(BODY + "\nNew publication correction.", encoding="utf-8")
        self.assertEqual(self.review("second")["counts"]["reviewed"], 3)

    def test_cached_model_is_source_bound_and_cannot_supply_a_value(self):
        cache = self.root / "jev.sqlite3"
        with closing(sqlite3.connect(cache)) as conn:
            conn.execute("CREATE TABLE judgments (request_hash TEXT,payload TEXT,response TEXT,model TEXT)")
            payload = {"state": {"citation": self.rows[0]["citation"], "public_url": self.rows[0]["url"],
                       "public_source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest()}}
            conn.execute("INSERT INTO judgments VALUES (?,?,?,?)", ("cached", json.dumps(payload),
                         json.dumps({"answers": {"select": {"choice": "Invented Judge", "confidence": 1}}}), "jev-test"))
            conn.commit()
        self.review(jev_cache=cache)
        proposals = json.loads((self.root / "review/proposals.json").read_text())
        self.assertEqual(next(x for x in proposals if x["field"] == "judges")["evidence"]["value"], "SMITH J")
        result = self.review("second")
        self.assertEqual(result["counts"]["source_bound_cache_fields"], 3)
        self.assertEqual(result["counts"]["unchanged_evidence_skipped"], 3)
        self.source.write_text(BODY + "source changed", encoding="utf-8")
        self.assertNotIn("source_bound_cache_fields", self.review("third")["counts"])

    def test_cache_with_missing_catalogue_citation_requires_exact_canonical_url_and_source(self):
        cache = self.root / "jev.sqlite3"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET citation='' WHERE case_id='a'")
            conn.commit()
        with closing(sqlite3.connect(cache)) as conn:
            conn.execute("CREATE TABLE judgments (request_hash TEXT,payload TEXT,response TEXT,model TEXT)")
            state = {"citation": "", "public_url": self.rows[0]["url"],
                     "public_source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest()}
            conn.execute("INSERT INTO judgments VALUES ('saved',?,?, 'jev-test')", (json.dumps({"state": state}), '{}'))
            conn.commit()
        self.assertEqual(self.review(jev_cache=cache)["counts"]["source_bound_cache_fields"], 3)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET url=? WHERE case_id='a'", (self.rows[0]["url"].replace('/12.html', '/13.html'),))
            conn.commit()
        self.assertNotIn("source_bound_cache_fields", self.review("changed_url")["counts"])

    def test_prior_not_applicable_is_preserved_on_matching_evidence(self):
        prior = self.root / "prior.csv"
        with prior.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["case_id", "field", "status", "reason", "source_sha256"])
            writer.writeheader()
            writer.writerow(dict(case_id="a", field="visa_type", status="不適用（前輪已確認）", reason="Confirmed citizenship review", source_sha256=hashlib.sha256(self.source.read_bytes()).hexdigest()))
        self.assertEqual(self.review(prior_status=prior)["counts"]["not_applicable"], 1)
        self.assertEqual(self.review("second")["counts"]["not_applicable"], 1)

    def test_apply_preserves_notes_rows_and_json_envelope(self):
        result = apply_approved(self.root, self.root / "apply", self.approvals())
        self.assertEqual(result["applied"], 3)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        self.assertEqual(self.review("after")["missing_cells"], 0)
        self.assertEqual(apply_approved(self.root, self.root / "noop", [])["applied"], 0)

    def test_no_change_verification_compares_every_store(self):
        import shutil
        backup = self.root / "backup"
        backup.mkdir()
        for name in ("cases.db", "immigration_cases.csv", "immigration_cases.json"):
            shutil.copy2(self.data / name, backup / name)
        self.assertEqual(verify_stores(self.root, backup, [])["verified_cells_each_store"], 0)

    def test_export_conflict_is_not_overwritten(self):
        approvals = self.approvals()
        self.rows[0]["judges"] = "Existing Correct Judge"
        self.save_exports()
        with self.assertRaisesRegex(ValueError, "Export conflict"):
            apply_approved(self.root, self.root / "apply", approvals)
        self.assertEqual(json.loads((self.data / "immigration_cases.json").read_text())["cases"][0]["judges"], "Existing Correct Judge")

    def test_changed_source_or_missing_review_blocks_write(self):
        approvals = self.approvals()
        approvals[0].pop("reviewer")
        with self.assertRaisesRegex(ValueError, "review"):
            apply_approved(self.root, self.root / "apply", approvals)
        self.source.write_text(BODY + "changed", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Source changed"):
            apply_approved(self.root, self.root / "apply2", self.approvals_cached(approvals))

    @staticmethod
    def approvals_cached(approvals):
        approvals[0]["reviewer"] = "reviewer"
        return approvals

    def test_interruption_recovery_and_no_overwrite_after_crash(self):
        approvals = self.approvals()
        before = (self.data / "immigration_cases.csv").read_bytes()
        with self.assertRaisesRegex(RuntimeError, "Simulated"):
            apply_approved(self.root, self.root / "apply", approvals, fault="after_csv")
        with self.assertRaisesRegex(RuntimeError, "recover"):
            apply_approved(self.root, self.root / "blocked", approvals)
        self.assertTrue(recover(self.root)["recovered"])
        self.assertEqual((self.data / "immigration_cases.csv").read_bytes(), before)
        self.assertEqual(apply_approved(self.root, self.root / "retry", approvals)["applied"], 3)

    def test_recovery_refuses_concurrent_unrelated_database_changes(self):
        with self.assertRaises(RuntimeError):
            apply_approved(self.root, self.root / "apply", self.approvals(), fault="after_csv")
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET user_notes='New user note' WHERE case_id='b'")
            conn.commit()
        with self.assertRaises(ValueError):
            recover(self.root)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(conn.execute("SELECT user_notes FROM cases WHERE case_id='b'").fetchone()[0], "New user note")


class LockTests(unittest.TestCase):
    def test_process_lock_excludes_both_entry_points_and_releases_after_death(self):
        with tempfile.TemporaryDirectory() as folder:
            csv_path = str(Path(folder) / "cases.csv")
            code = "from immi_case_downloader.csv_write_lock import catalog_lock; import sys,time;\nwith catalog_lock(sys.argv[1], 'child'):\n print('LOCKED',flush=True)\n time.sleep(60)"
            env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
            child = subprocess.Popen([sys.executable, "-u", "-c", code, csv_path], stdout=subprocess.PIPE, text=True, env=env)
            try:
                self.assertEqual(child.stdout.readline().strip(), "LOCKED")
                with self.assertRaisesRegex(CatalogLockedError, "child"):
                    with catalog_lock(csv_path, "blocked"):
                        self.fail("Concurrent batch writer entered")
                with self.assertRaises(TimeoutError):
                    with csv_write_lock(csv_path, timeout=0.1):
                        self.fail("Concurrent CSV writer entered")
            finally:
                child.kill()
                child.wait(timeout=10)
                child.stdout.close()
            with csv_write_lock(csv_path, timeout=0.1):
                self.assertTrue(Path(csv_path + ".lock").exists())


class ScraperMetadataTests(unittest.TestCase):
    def test_main_judgment_excludes_navigation_citations(self):
        from bs4 import BeautifulSoup
        from immi_case_downloader.models import ImmigrationCase
        from immi_case_downloader.sources.austlii import AustLIIScraper
        source = BeautifulSoup("<nav>Other [2000] FCA 1</nav><div id='cases_doc'>" + HEAD +
                               "<p>JUDGE: SMITH J</p></div>", "lxml")
        case = ImmigrationCase.from_dict({"citation": "[2024] FCA 12"})
        AustLIIScraper(delay=0)._extract_metadata(source, case)
        self.assertEqual(case.judges, "SMITH J")

    def test_payment_card_litigation_does_not_enter_as_immigration(self):
        from immi_case_downloader.sources.austlii import AustLIIScraper
        self.assertFalse(AustLIIScraper._is_immigration_case(
            "Spotwire Pty Limited v Visa International Service Association - TRADE PRACTICES - CONTRACT - COSTS", ["visa"]))

    def test_payment_company_reference_does_not_exclude_real_immigration_case(self):
        from immi_case_downloader.sources.austlii import AustLIIScraper
        self.assertTrue(AustLIIScraper._is_immigration_case(
            "Visa International employee v Minister for Immigration - protection visa refusal", []))

    def test_both_downloaders_preserve_existing_core_and_ancillary_values(self):
        from bs4 import BeautifulSoup
        from immi_case_downloader.models import ImmigrationCase
        from immi_case_downloader.sources.austlii import AustLIIScraper
        from immi_case_downloader.sources.federal_court import FederalCourtScraper
        for scraper in (AustLIIScraper(delay=0), FederalCourtScraper(delay=0)):
            case = ImmigrationCase.from_dict({"citation": "[2024] FCA 12", "judges": "Existing Correct J",
                    "outcome": "Allowed", "visa_type": "Subclass 866", "date": "Existing date"})
            source = BeautifulSoup("<article>" + BODY.replace("\n", "<br>") + "</article>", "lxml") if isinstance(scraper, AustLIIScraper) else BODY
            scraper._extract_metadata(source, case)
            self.assertEqual((case.judges, case.outcome, case.visa_type, case.date),
                             ("Existing Correct J", "Allowed", "Subclass 866", "Existing date"))

    def test_new_download_accepts_own_printed_citation_and_retains_table_author(self):
        from bs4 import BeautifulSoup
        from immi_case_downloader.models import ImmigrationCase
        from immi_case_downloader.sources.austlii import AustLIIScraper
        source = BeautifulSoup("<div id='cases_doc'>" + HEAD + "<table><tr><td>JUDGE:</td><td>SMITH J</td></tr></table></div>", "lxml")
        case = ImmigrationCase.from_dict({})
        AustLIIScraper(delay=0)._extract_metadata(source, case)
        self.assertEqual(case.judges, "SMITH J")
        self.assertEqual(case.citation, "[2024] FCA 12")


if __name__ == "__main__":
    unittest.main(verbosity=2)
