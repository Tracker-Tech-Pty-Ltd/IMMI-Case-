from __future__ import annotations

import hashlib
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from immi_case_downloader.repair_workflow import (
    _austlii_catchword_visa_proof,
    _austlii_catchwords_visa_evidence,
    _austlii_catchwords_visa_not_applicable,
    validate_approvals,
)


class AustliiProtectionCatchwordTests(unittest.TestCase):
    @staticmethod
    def case(catchwords: str, *, source: str = "AustLII") -> dict[str, str]:
        return {
            "source": source,
            "url": "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCCA/2015/1077.html",
            "catchwords": catchwords,
            "case_nature": "Protection visa",
        }

    def test_explicit_class_xa_refugee_review_catchword_is_a_visa_candidate(self):
        catchwords = (
            "MIGRATION \ufffdC Refugee Review Tribunal \ufffdC "
            "Protection (class XA) visa \ufffdC no jurisdictional error."
        )
        evidence = _austlii_catchwords_visa_evidence(self.case(catchwords))

        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.value, "Protection (Class XA) visa")
        self.assertEqual(
            evidence.rule,
            "austlii_catchwords_protection_visa_class_xa_no_jurisdictional_error",
        )

    def test_explicit_new_zealand_family_visa_catchword_is_source_bound(self):
        catchwords = (
            "MIGRATION \ufffdC New Zealand Citizen\n"
            "(Family Relationship) visa \ufffdC decision of the Administrative Appeals Tribunal"
        )
        case = {
            "source": "AustLII",
            "url": "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FedCFamC2G/2024/80.html",
            "catchwords": catchwords,
            "case_nature": "Judicial review",
        }
        evidence = _austlii_catchwords_visa_evidence(case)

        self.assertIsNotNone(evidence)
        self.assertEqual(
            evidence.value,
            "New Zealand Citizen (Family Relationship) visa",
        )
        self.assertEqual(
            evidence.rule,
            "austlii_catchwords_new_zealand_citizen_family_relationship_visa_decision",
        )

        source_text = (
            "Title: Phan v Minister for Immigration [2024] FedCFamC2G 80\n"
            "Citation: [2024] FedCFamC2G 80\n"
            f"URL: {case['url']}\n"
            + "=" * 80
            + "\n"
            + catchwords
            + "\nORDERS\nThe substantive application is dismissed.\n"
        )
        checked = SimpleNamespace(
            source_status="checked",
            not_applicable={},
            reasons={"visa_type": "current_visa_not_stated"},
        )
        proof = _austlii_catchword_visa_proof(case, source_text, checked, {}, set())
        self.assertIsNotNone(proof)
        self.assertIn("New Zealand Citizen", proof.quote)

        without_aat_decision = catchwords.replace(
            " \ufffdC decision of the Administrative Appeals Tribunal", ""
        )
        self.assertIsNone(
            _austlii_catchwords_visa_evidence(
                {**case, "catchwords": without_aat_decision}
            )
        )

    def test_candidate_must_be_austlii_metadata_and_name_the_decision_context(self):
        catchwords = (
            "MIGRATION – Refugee Review Tribunal – Protection (class XA) visa "
            "– no jurisdictional error."
        )
        no_error_finding = catchwords.replace(" – no jurisdictional error", "")
        self.assertIsNone(
            _austlii_catchwords_visa_evidence(self.case(catchwords, source="Jade"))
        )
        self.assertIsNone(
            _austlii_catchwords_visa_evidence(self.case(no_error_finding))
        )
        self.assertIsNone(
            _austlii_catchwords_visa_evidence(
                self.case(catchwords + " Visitor (Class FA) visa")
            )
        )

    def test_proof_is_source_anchored_and_requires_checked_identity(self):
        catchwords = (
            "MIGRATION \ufffdC Refugee Review Tribunal \ufffdC "
            "Protection (class XA) visa \ufffdC no jurisdictional error."
        )
        case = self.case(catchwords)
        source_text = (
            "Title: AHG15 v Minister for Immigration & Anor [2015] FCCA 1077\n"
            "Citation: [2015] FCCA 1077\n"
            f"URL: {case['url']}\n"
            + "=" * 80
            + "\n"
            + catchwords
            + "\nThe Tribunal considered the Protection (Class XA) visa application.\n"
        )
        checked = SimpleNamespace(
            source_status="checked",
            not_applicable={},
            reasons={"visa_type": "current_visa_not_stated"},
        )

        proof = _austlii_catchword_visa_proof(case, source_text, checked, {}, set())
        self.assertIsNotNone(proof)
        self.assertEqual(proof.value, "Protection (Class XA) visa")
        self.assertIn("Protection (class XA) visa", proof.quote)

        identity_conflict = SimpleNamespace(
            source_status="identity_conflict",
            not_applicable={},
            reasons={"visa_type": "current_visa_not_stated"},
        )
        self.assertIsNone(
            _austlii_catchword_visa_proof(
                case, source_text, identity_conflict, {}, set()
            )
        )

    def test_corporate_nomination_review_is_not_the_related_employee_visa_case(self):
        citation = "[2020] FCCA 794"
        url = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCCA/2020/794.html"
        title = (
            "Fix N Shop Pty Ltd v Minister for Immigration & Anor and Ong v Minister "
            "for Immigration & Anor [2020] FCCA 794 (9 April 2020)"
        )
        catchwords = (
            "MIGRATION – Whether Tribunal was in error because it considered the wrong "
            "contract of employment – no error in the consideration of regulations by "
            "the Tribunal – application dismissed."
        )
        case = {
            "source": "AustLII",
            "url": url,
            "citation": citation,
            "title": title,
            "case_nature": "Judicial review",
            "catchwords": catchwords,
        }
        source_text = (
            f"Title: {title}\nCitation: {citation}\nCourt: Federal Circuit Court of Australia\n"
            f"Date: 27 March 2020\nURL: {url}\n"
            + "=" * 80
            + "\nFEDERAL CIRCUIT COURT OF AUSTRALIA\n\nFIX N SHOP PTY LTD v MINISTER\n"
            + "Catchwords:\n"
            + catchwords
            + "\nLegislation:\nMigration Regulations 1994 (Cth), reg. 5.19\n"
            + "REASONS FOR JUDGMENT\n"
            + "By an application filed 25 September 2019, the applicant seeks judicial review "
            + "of a decision of the Administrative Appeals Tribunal made on 5 September 2019. "
            + "The Tribunal's decision affirmed the decision of a delegate refusing to grant "
            + "a nomination for a position in Australia under reg. 5.19.\n"
            + "This matter was heard together with proceeding PEG378/2019. In that case, "
            + "the applicant, Mr Ong, was the applicant for the visa, which was the subject "
            + "of sponsorship by the applicant in this proceeding.\n"
        )

        self.assertEqual(
            _austlii_catchwords_visa_not_applicable(case, source_text),
            "sponsorship_or_nomination_not_a_personal_visa",
        )

        visa_refusal_case = {
            **case,
            "catchwords": "MIGRATION – employer nomination – visa refusal.",
        }
        self.assertIsNone(
            _austlii_catchwords_visa_not_applicable(
                visa_refusal_case,
                source_text.replace(catchwords, visa_refusal_case["catchwords"]),
            )
        )

    def test_metadata_approval_can_use_the_same_verified_class_xa_catchword(self):
        citation = "[2015] FCCA 1077"
        url = self.case("")["url"]
        catchwords = (
            "MIGRATION \ufffdC Refugee Review Tribunal \ufffdC "
            "Protection (class XA) visa \ufffdC no jurisdictional error."
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "downloaded_cases"
            source = data / "case_texts" / "fixture.txt"
            source.parent.mkdir(parents=True)
            source_text = (
                f"Title: Example v Minister {citation}\n"
                f"Citation: {citation}\n"
                f"URL: {url}\n"
                + "=" * 80
                + f"\nFEDERAL CIRCUIT COURT OF AUSTRALIA\nExample v Minister {citation}\n"
                + "CATCHWORDS:\n"
                + catchwords
                + "\nJUDGE:\nSMITH J\nORDERS:\n1. The proceedings are dismissed.\n"
                + "REASONS FOR JUDGMENT\nThe Tribunal considered a Protection (Class XA) visa.\n"
            )
            source.write_text(source_text, encoding="utf-8")
            db = sqlite3.connect(data / "cases.db")
            db.execute(
                """CREATE TABLE cases (
                    case_id TEXT PRIMARY KEY, citation TEXT, title TEXT, url TEXT,
                    source TEXT, catchwords TEXT, full_text_path TEXT,
                    case_nature TEXT, visa_type TEXT, visa_subclass TEXT,
                    visa_class_code TEXT, visa_subclass_number TEXT
                )"""
            )
            db.execute(
                """INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "xa-case",
                    citation,
                    f"Example v Minister {citation}",
                    url,
                    "AustLII",
                    catchwords,
                    "downloaded_cases/case_texts/fixture.txt",
                    "Protection visa",
                    "",
                    "",
                    "",
                    "",
                ),
            )
            db.commit()
            db.close()

            approval = {
                "case_id": "xa-case",
                "citation": citation,
                "field": "visa_class_code",
                "expected_current_by_store": {
                    "database": "",
                    "csv": "",
                    "json": "",
                },
                "source_path": "downloaded_cases/case_texts/fixture.txt",
                "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "evidence": {
                    "value": "XA",
                    "quote": catchwords,
                    "method": "manual_source_bound_visa_metadata_review",
                    "current_visa_value": "Protection (Class XA) visa",
                },
                "reviewer": "test",
                "review_note": "Class XA is printed in the source catchwords.",
            }
            validate_approvals(root, [approval])

            invalid = {**approval, "evidence": {**approval["evidence"], "value": "FA"}}
            with self.assertRaisesRegex(ValueError, "does not match"):
                validate_approvals(root, [invalid])


if __name__ == "__main__":
    unittest.main()
