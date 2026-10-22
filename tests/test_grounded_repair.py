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
from immi_case_downloader.repair_workflow import (
    _austlii_catchwords_visa_evidence,
    _austlii_catchwords_visa_not_applicable,
    apply_approved,
    recover,
    review_catalogue,
    verify_stores,
)

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

    def test_tribunal_label_does_not_swallow_following_member(self):
        body = (
            HEAD
            + "TRIBUNAL: Migration Review Tribunal\n"
            + "PRESIDING MEMBER:\nRicky Johnston\n"
            + "DECISION: The Tribunal remits the application.\n"
        )
        result = self.assess(body)
        self.assertEqual(result.values["judges"].value, "Ricky Johnston")

    def test_no_guesses_from_title_and_cited_judge(self):
        result = self.assess(HEAD + "REASONS FOR JUDGMENT\nIn Another v Minister [2001] FCA 10, Judge Jones dismissed the application.")
        self.assertEqual(result.values, {})

    def test_conflicting_identity_blocks_every_field(self):
        result = assess_case(BODY, citation="[2024] FCA 13")
        self.assertEqual(result.source_status, "identity_conflict")
        self.assertEqual(result.values, {})

    def test_exact_formal_heading_can_confirm_identity_after_cited_authorities(self):
        body = (
            "CATCHWORDS: see Another v Minister [1999] FCA 1\n"
            "DECISION AND REASONS FOR DECISION [2024] FCA 12\n"
            "PRESIDING MEMBER: Jane Smith\n"
            "DECISION: The Tribunal affirms the decision under review.\n"
            "REASONS FOR DECISION\n"
            "The decision under review refused a protection visa.\n"
        )
        result = self.assess(body)
        self.assertEqual(result.source_status, "checked")
        self.assertEqual(result.values["judges"].value, "Jane Smith")
        self.assertEqual(result.values["outcome"].value,
                         "The Tribunal affirms the decision under review.")
        self.assertEqual(result.values["visa_type"].value, "protection visa")

    def test_dual_federal_court_caption_can_confirm_secondary_citation(self):
        body = (
            "Bakhtyar v Minister for Immigration & Multicultural Affairs "
            "[2002] FCAFC 49; [2002] FCA 218\n"
            "JUDGE: SMITH J\nREASONS FOR JUDGMENT\n"
        )
        result = assess_case(body, citation="[2002] FCA 218")
        self.assertEqual(result.source_status, "checked")
        self.assertEqual(result.values["judges"].value, "SMITH J")

    def test_citation_in_reasons_does_not_confirm_primary_identity(self):
        body = (
            "Actual case [2024] FCA 13\n"
            "REASONS FOR JUDGMENT\n"
            "Another v Minister [2024] FCA 12 was decided differently.\n"
        )
        result = assess_case(body, citation="[2024] FCA 12")
        self.assertEqual(result.source_status, "identity_conflict")
        self.assertEqual(result.values, {})

    def test_citation_in_catchwords_does_not_override_formal_heading(self):
        body = (
            "CATCHWORDS: Another v Minister [2024] FCA 12\n"
            "DECISION AND REASONS FOR DECISION [2024] FCA 13\n"
            "JUDGE: Jane Smith\n"
        )
        result = assess_case(body, citation="[2024] FCA 12")
        self.assertEqual(result.source_status, "identity_conflict")
        self.assertEqual(result.values, {})

    def test_first_formal_heading_controls_identity(self):
        body = (
            "DECISION AND REASONS FOR DECISION [2024] FCA 13\n"
            "REASONS FOR DECISION\n"
            "DECISION AND REASONS FOR DECISION [2024] FCA 12\n"
            "JUDGE: Jane Smith\n"
        )
        result = assess_case(body, citation="[2024] FCA 12")
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

    def test_citizenship_catchword_marks_visa_type_not_applicable(self):
        result = self.assess(HEAD + "CATCHWORDS – CITIZENSHIP – grant of citizenship – decision set aside")
        self.assertEqual(result.not_applicable["visa_type"], "citizenship_review_not_a_visa_application")

    def test_nomination_review_marks_personal_visa_not_applicable(self):
        result = self.assess(
            HEAD + "CATCHWORDS: MIGRATION – application for approval of nomination of position – Direct Entry"
        )
        self.assertEqual(result.not_applicable["visa_type"], "sponsorship_or_nomination_not_a_personal_visa")

    def test_nomination_subject_in_catchwords_marks_personal_visa_not_applicable(self):
        result = self.assess(HEAD + "CATCHWORDS: MIGRATION – nomination – Direct Entry stream")
        self.assertEqual(result.not_applicable["visa_type"], "sponsorship_or_nomination_not_a_personal_visa")

    def test_subclass_visa_refusal_for_sponsor_is_not_misclassified_as_nomination(self):
        result = self.assess(HEAD + "CATCHWORDS: Visa refusal – subclass 457 – business sponsor")
        self.assertNotIn("visa_type", result.not_applicable)

    def test_non_immigration_employment_decisions_mark_visa_type_not_applicable(self):
        for topic in (
            "FAIR WORK – penalties under the Fair Work Act",
            "INDUSTRIAL LAW – application for civil penalty",
            "WORKERS' COMPENSATION – disease contributed to by employment",
            "Comcare – application for review of psychological injury claim",
        ):
            with self.subTest(topic=topic):
                result = self.assess(HEAD + "CATCHWORDS: " + topic)
                self.assertEqual(result.not_applicable["visa_type"], "employment_case_not_a_personal_visa")

    def test_transport_security_card_decisions_are_not_visa_decisions(self):
        for topic in (
            "Maritime Security Identification Card – decision to refuse issue",
            "Aviation Security Identification Card – adverse criminal record",
        ):
            with self.subTest(topic=topic):
                result = self.assess(HEAD + "CATCHWORDS: " + topic)
                self.assertEqual(result.not_applicable["visa_type"], "security_card_case_not_a_personal_visa")

    def test_foi_and_corporate_registry_cases_are_not_personal_visa_reviews(self):
        foi = self.assess(HEAD + "CATCHWORDS: FREEDOM OF INFORMATION – request for department documents")
        company = self.assess(HEAD + "CATCHWORDS: MIGRATION – de-registration of a corporation")
        self.assertEqual(foi.not_applicable["visa_type"], "freedom_of_information_not_a_visa_decision")
        self.assertEqual(company.not_applicable["visa_type"], "corporate_deregistration_not_a_personal_visa")

    def test_non_visa_subject_rule_does_not_override_a_visa_refusal(self):
        result = self.assess(HEAD + "CATCHWORDS: Review of visa refusal – subclass 457 – Fair Work evidence")
        self.assertNotIn("visa_type", result.not_applicable)

    def test_current_visa_subclass_can_be_resolved_through_its_numbered_footnote(self):
        body = (
            HEAD
            + "The delegate declined to revoke the cancellation of the applicant’s visa, [2]\n"
            + "The applicant has a substantial criminal record.\n"
            + "[2]\nA Class XB subclass 200 – Refugee visa.\n"
        )
        result = self.assess(body)
        self.assertEqual(result.values["visa_type"].value, "subclass 200")
        candidate = next(x for x in result.candidates if x["rank"] == 4)
        self.assertIn("applicant’s visa, [2]", candidate["reference_quote"])

    def test_visa_linked_to_adverse_decision_on_that_application(self):
        body = (
            HEAD
            + "The appellant arrived on a visitor visa.\n"
            + "He lodged an application for a protection (Class XA) visa on 12 January 2004. "
            + "The Delegate’s adverse decision on that application was made on 19 January 2004.\n"
        )
        result = self.assess(body)
        self.assertEqual(result.values["visa_type"].value, "protection (Class XA) visa")

    def test_application_visa_does_not_link_to_separate_decision_paragraph(self):
        body = (
            HEAD
            + "The appellant lodged an application for a protection visa on 12 January 2004.\n"
            + "The Delegate’s adverse decision concerned a different application.\n"
        )
        self.assertNotIn("visa_type", self.assess(body).values)

    def test_unlinked_visa_footnote_does_not_fill_current_visa(self):
        body = HEAD + "[2]\nA Class XB subclass 200 – Refugee visa.\n"
        result = self.assess(body)
        self.assertNotIn("visa_type", result.values)

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
                      "full_text_path": "downloaded_cases/case.txt", "text_snippet": ""},
                     {"case_id": "b", "citation": "[2024] FCA 13", "title": "Other",
                      "url": "", "judges": "Correct J", "outcome": "Allowed", "visa_type": "Subclass 866",
                      "user_notes": "", "full_text_path": "", "text_snippet": ""}]
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

    def test_explicit_austlii_catchwords_are_reviewed_and_revalidated_before_apply(self):
        body = (
            HEAD
            + "JUDGE: SMITH J\nORDERS:\n1. The application is dismissed.\n"
            + "REASONS FOR JUDGMENT\nThe case concerns the applicant's relationship.\n"
        )
        self.source.write_text(body, encoding="utf-8")
        catchwords = "Review of visa refusal - Subclass 820 - Partner visa - genuine relationship"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("ALTER TABLE cases ADD COLUMN catchwords TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE cases ADD COLUMN source TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE cases SET catchwords=? WHERE case_id='a'", (catchwords,))
            conn.execute("UPDATE cases SET source='AustLII' WHERE case_id='a'")
            conn.commit()
        self.rows[0]["catchwords"] = catchwords
        self.rows[0]["source"] = "AustLII"
        self.save_exports()

        self.review()
        visa = next(
            row for row in json.loads((self.root / "review/review.json").read_text(encoding="utf-8"))
            if row["case_id"] == "a" and row["field"] == "visa_type"
        )
        self.assertEqual(visa["fact_status"], "candidate_review")
        self.assertEqual(visa["evidence"]["value"], "Partner visa (subclass 820)")
        self.assertIn("Subclass 820 - Partner visa", visa["evidence"]["quote"])
        self.assertTrue(visa["evidence"]["rule"].startswith("austlii_catchwords_"))

        approvals = json.loads((self.root / "review/proposals.json").read_text(encoding="utf-8"))
        for row in approvals:
            row.update(reviewer="independent-test-review", review_note="Exact official case and catchwords checked")
        result = apply_approved(self.root, self.root / "catchwords-apply", approvals)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        self.assertEqual(result["verification"]["verified_cells_each_store"], 3)
        self.assertEqual(self.review("after-catchwords-apply")["missing_cells"], 0)

    def test_generic_or_non_primary_catchwords_cannot_fill_visa_type(self):
        self.assertIsNone(_austlii_catchwords_visa_evidence({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "case_nature": "Visa refusal",
            "catchwords": "Review of visa refusal; protection visas are discussed in another decision.",
        }))
        self.assertIsNone(_austlii_catchwords_visa_evidence({
            "source": "CaseNote",
            "url": "https://casenote.au/cases/example",
            "case_nature": "Visa refusal",
            "catchwords": "Review of visa refusal - Subclass 820 - Partner visa",
        }))

    def test_explicit_austlii_catchword_visa_families(self):
        cases = (
            ("MIGRATION – Protection visa – credibility issue", "Protection visa"),
            ("Judicial review of a protection visa refusal", "Protection visa"),
            ("Cancellation of a tourist visa", "Tourist visa"),
            ("Cancellation of an electronic travel authority (visitor) visa", "Visitor visa"),
            ("MIGRATION – Humanitarian visa – decision affirmed", "Humanitarian visa"),
            ("The application concerns a skilled migration visa", "Skilled migration visa"),
            ("MIGRATION – Skilled visa – review withdrawn", "Skilled visa"),
            (
                "MIGRATION – Skilled-Designated Area sponsored visa – experience assessment",
                "Skilled-Designated Area sponsored visa",
            ),
            ("MIGRATION – Business visa – review withdrawn", "Business visa"),
            (
                "IMMIGRATION – transitional (permanent) BF visa – cancellation review",
                "Transitional (permanent) BF visa",
            ),
        )
        for catchwords, expected in cases:
            with self.subTest(catchwords=catchwords):
                proof = _austlii_catchwords_visa_evidence({
                    "source": "AustLII",
                    "url": self.rows[0]["url"],
                    "case_nature": "Visa refusal",
                    "catchwords": catchwords,
                })
                self.assertIsNotNone(proof)
                self.assertEqual(proof.value, expected)

    def test_austlii_protection_catchword_is_approved_against_source_and_stores(self):
        self.source.write_text(
            HEAD + "JUDGE: SMITH J\nORDERS:\n1. The appeal is dismissed.\n"
            "REASONS FOR JUDGMENT\nThe published reasons identify this case.\n",
            encoding="utf-8",
        )
        catchwords = "MIGRATION – Protection visa – appeal against refusal"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("ALTER TABLE cases ADD COLUMN catchwords TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE cases ADD COLUMN source TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE cases SET catchwords=?,source='AustLII' WHERE case_id='a'", (catchwords,))
            conn.commit()
        self.rows[0]["catchwords"] = catchwords
        self.rows[0]["source"] = "AustLII"
        self.save_exports()

        self.review()
        proposal = next(
            row for row in json.loads((self.root / "review/proposals.json").read_text(encoding="utf-8"))
            if row["case_id"] == "a" and row["field"] == "visa_type"
        )
        self.assertEqual(proposal["evidence"]["value"], "Protection visa")
        proposal.update(reviewer="independent-test-review", review_note="Exact official catchword checked")
        result = apply_approved(self.root, self.root / "protection-apply", [proposal])
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        self.assertEqual(result["verification"]["verified_cells_each_store"], 1)
        self.assertEqual(self.review("after-protection")["missing_cells"], 2)

    def test_austlii_nomination_catchword_marks_visa_type_not_applicable(self):
        self.assertEqual(
            _austlii_catchwords_visa_not_applicable({
                "source": "AustLII",
                "url": self.rows[0]["url"],
                "catchwords": "MIGRATION – Employer Nomination Scheme – Tribunal jurisdiction – application withdrawn",
            }),
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertIsNone(_austlii_catchwords_visa_not_applicable({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "catchwords": "Visa refusal - subclass 457 - business sponsorship not approved",
        }))
        self.assertIsNone(_austlii_catchwords_visa_not_applicable({
            "source": "CaseNote",
            "url": "https://casenote.au/cases/example",
            "catchwords": "MIGRATION – Employer Nomination Scheme – Tribunal jurisdiction",
        }))

        self.source.write_text(
            HEAD + "JUDGE: SMITH J\nORDERS:\n1. The appeal is dismissed.\n"
            "REASONS FOR JUDGMENT\nThe published reasons identify this case.\n",
            encoding="utf-8",
        )
        catchwords = "MIGRATION – Employer Nomination Scheme – Tribunal jurisdiction – application withdrawn"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("ALTER TABLE cases ADD COLUMN catchwords TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE cases ADD COLUMN source TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE cases SET catchwords=?,source='AustLII' WHERE case_id='a'", (catchwords,))
            conn.commit()
        self.rows[0]["catchwords"] = catchwords
        self.rows[0]["source"] = "AustLII"
        self.save_exports()

        self.review()
        visa = next(
            row for row in json.loads((self.root / "review/review.json").read_text(encoding="utf-8"))
            if row["case_id"] == "a" and row["field"] == "visa_type"
        )
        self.assertEqual(visa["fact_status"], "not_applicable")
        self.assertEqual(visa["reason_code"], "sponsorship_or_nomination_not_a_personal_visa")
        self.assertIsNone(visa["evidence"])

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

    def test_expected_current_replaces_wrong_value_and_source_metadata_safely(self):
        source_text = (
            HEAD
            + "JUDGE: LINDGREN J\n"
            + "ORDERS:\n1. The application is dismissed.\n"
            + "REASONS FOR JUDGMENT\n"
            + "The appellant lodged an application for a protection (Class XA) visa on 12 January 2004. "
            + "The Delegate’s adverse decision on that application was made on 19 January 2004.\n"
        )
        official = self.data / "official.txt"
        with official.open("w", encoding="utf-8", newline="") as handle:
            handle.write(source_text)
        source_ref = "downloaded_cases/official.txt"
        old_path = "downloaded_cases/wrong.txt"
        old_snippet = "Baxter wrong source"
        self.rows[0].update(judges="OF THE", full_text_path=old_path, text_snippet=old_snippet)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET judges=?,full_text_path=?,text_snippet=? WHERE case_id='a'",
                         ("OF THE", old_path, old_snippet))
            conn.commit()
        self.save_exports()
        json_path = self.data / "immigration_cases.json"
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        next(row for row in payload["cases"] if row["case_id"] == "a")["text_snippet"] = ""
        json_path.write_text(json.dumps(payload), encoding="utf-8")
        source_hash = hashlib.sha256(official.read_bytes()).hexdigest()
        assessment = assess_case(source_text, citation=self.rows[0]["citation"],
                                 title=self.rows[0]["title"], url=self.rows[0]["url"])
        approvals = []
        for field in ("judges", "visa_type"):
            approvals.append({
                "case_id": "a", "field": field, "source_path": source_ref,
                "source_sha256": source_hash, "evidence": assessment.values[field].to_dict(),
                "reviewer": "manual-source-test", "review_note": "Exact source evidence checked",
                **({"expected_current": "OF THE"} if field == "judges" else {}),
            })
        approvals.extend([
            {"case_id": "a", "field": "full_text_path", "expected_current": old_path,
             "source_path": source_ref, "source_sha256": source_hash,
             "evidence": {"value": source_ref}, "reviewer": "manual-source-test",
             "review_note": "Official text replaces mismatched source path"},
            {"case_id": "a", "field": "text_snippet", "expected_current": old_snippet,
             "expected_current_by_store": {"database": old_snippet, "csv": old_snippet, "json": ""},
             "source_path": source_ref, "source_sha256": source_hash,
             "evidence": {"value": source_text[:220]}, "reviewer": "manual-source-test",
             "review_note": "Snippet is an exact prefix of the verified official text"},
        ])
        result = apply_approved(self.root, self.root / "compare-and-swap", approvals)
        self.assertEqual(result["verification"]["verified_cells_each_store"], 4)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            got = conn.execute("SELECT judges,visa_type,full_text_path,text_snippet FROM cases WHERE case_id='a'").fetchone()
        self.assertEqual(got, ("LINDGREN J", "protection (Class XA) visa", source_ref, source_text[:220]))

    def test_official_order_summary_repairs_only_divergent_exports(self):
        self.rows[0]["outcome"] = "Dismissed"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET outcome='Dismissed' WHERE case_id='a'")
            conn.commit()
        self.save_exports()
        csv_path = self.data / "immigration_cases.csv"
        with csv_path.open(encoding="utf-8-sig", newline="") as handle:
            csv_rows = list(csv.DictReader(handle))
            headers = list(csv_rows[0])
        csv_rows[0]["outcome"] = ""
        with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            writer.writerows(csv_rows)
        json_path = self.data / "immigration_cases.json"
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"] = "ORDER:\n\n12 AUGUST 2005"
        json_path.write_text(json.dumps(payload), encoding="utf-8")
        assessment = assess_case(BODY, citation=self.rows[0]["citation"],
                                 title=self.rows[0]["title"], url=self.rows[0]["url"])
        proof = assessment.values["outcome"]
        approval = {
            "case_id": "a", "field": "outcome",
            "expected_current_by_store": {
                "database": "Dismissed", "csv": "", "json": "ORDER:\n\n12 AUGUST 2005",
            },
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Dismissed", "source_value": proof.value,
                "quote": "The application is dismissed.",
                "method": "manual_operative_order_summary",
            },
            "reviewer": "manual-source-test",
            "review_note": "The operative order says the application is dismissed; existing database summary is correct.",
        }
        result = apply_approved(self.root, self.root / "repair-outcome-export", [approval])
        self.assertEqual(result["verification"]["verified_cells_each_store"], 1)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(conn.execute("SELECT outcome FROM cases WHERE case_id='a'").fetchone()[0], "Dismissed")
        with csv_path.open(encoding="utf-8-sig", newline="") as handle:
            self.assertEqual(next(r for r in csv.DictReader(handle) if r["case_id"] == "a")["outcome"], "Dismissed")
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        self.assertEqual(next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"], "Dismissed")

    def test_expected_current_mismatch_refuses_overwrite(self):
        approvals = self.approvals()
        approvals[0]["expected_current"] = "stale value"
        with self.assertRaisesRegex(ValueError, "Current value changed"):
            apply_approved(self.root, self.root / "stale-compare", approvals)

    def test_no_change_verification_compares_every_store(self):
        import shutil
        backup = self.root / "backup"
        backup.mkdir()
        for name in ("cases.db", "immigration_cases.csv", "immigration_cases.json"):
            shutil.copy2(self.data / name, backup / name)
        self.assertEqual(verify_stores(self.root, backup, [])["verified_cells_each_store"], 0)

    def test_verify_counts_same_field_once_for_each_approved_case(self):
        import shutil
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET visa_type='' WHERE case_id='b'")
            conn.commit()
        self.rows[1]["visa_type"] = ""
        self.save_exports()
        backup = self.root / "same-field-backup"
        backup.mkdir()
        for name in ("cases.db", "immigration_cases.csv", "immigration_cases.json"):
            shutil.copy2(self.data / name, backup / name)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET visa_type='protection visa'")
            conn.commit()
        for row in self.rows:
            row["visa_type"] = "protection visa"
        self.save_exports()
        json_path = self.data / "immigration_cases.json"
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        payload["cases"][-1]["visa_type"] = ""
        json_path.write_text(json.dumps(payload), encoding="utf-8")
        changes = [
            {"case_id": case_id, "field": "visa_type", "evidence": {"value": "protection visa"}}
            for case_id in ("a", "b")
        ]
        result = verify_stores(self.root, backup, changes)
        self.assertEqual(result["verified_cells_each_store"], 2)
        self.assertTrue(result["all_unapproved_data_preserved"])

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
