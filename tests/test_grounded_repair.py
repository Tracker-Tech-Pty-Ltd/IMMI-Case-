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
from immi_case_downloader.extraction.grounded import (
    _direct_personal_nomination_visa,
    assess_case,
    canonical_citation,
    document_text,
    verified_metadata,
)
from immi_case_downloader.repair_workflow import (
    REASONS,
    _LEGACY_REASON_CODE_ALIASES,
    _canonical_operative_outcome,
    _normalize_reason_code,
    _source_limitation_reason,
    _austlii_catchwords_visa_evidence,
    _austlii_catchwords_visa_not_applicable,
    apply_approved,
    recover,
    review_catalogue,
    validate_approvals,
    verify_stores,
)

HEAD = "Example v Minister [2024] FCA 12\n"
BODY = HEAD + "JUDGE:\nSMITH J\nORDERS:\n1. The application is dismissed.\nREASONS FOR JUDGMENT\nThe decision under review was the decision to refuse a protection visa.\n"


class GroundedTests(unittest.TestCase):
    def test_canonical_operative_outcome_requires_one_direct_unnegated_result(self):
        cases = (
            ("Affirmed", "The Tribunal affirms the decision under review.", "Affirmed"),
            ("Affirmed", "The decision under review be affirmed.", "Affirmed"),
            ("Remitted", "The Tribunal remits the application for reconsideration.", "Remitted"),
            ("Remitted", "1. The application be allowed. 2. The matter be remitted to the Tribunal.", "Remitted"),
            ("Set aside", "The Court sets aside the decision under review.", "Set aside"),
            ("Dismissed", "The application is dismissed.", "Dismissed"),
            ("Withdrawn", "The proceeding be discontinued.", "Withdrawn"),
            ("Refused", "The application to set aside the orders is refused.", "Refused"),
            ("Allowed", "The appeal be allowed.", "Allowed"),
            ("Granted", "Leave to appeal is granted.", "Granted"),
            ("Quashed", "The decision is quashed.", "Quashed"),
            ("No jurisdiction", "The Tribunal does not have jurisdiction in this matter.", "No jurisdiction"),
            ("Dismissed", "The application is not dismissed.", None),
            ("Set aside", "The Court sets aside the decision and remits the matter.", "Set aside"),
            ("Set aside", "The Tribunal sets aside the decision and substitutes a decision that the application was withdrawn.", "Set aside"),
            ("Affirmed", "The Tribunal affirms the decision under review and sets aside a separate security decision.", "Affirmed"),
            ("Affirmed", "1. The appeal be allowed. 2. The orders made by the primary judge be set aside. 3. The decision of the Refugee Review Tribunal be affirmed.", "Affirmed"),
            ("Dismissed", "The application as amended by leave granted on 10 August 2021 is dismissed.", "Dismissed"),
            ("Dismissed", "1. Leave to amend the notice of appeal be refused. 2. The proceedings be dismissed.", "Dismissed"),
            ("Dismissed", "1. Application for an extension of time is refused. 2. The application is dismissed.", "Dismissed"),
            ("Set aside", "1. The appeal be allowed. 2. The decision be set aside. 3. The matter be remitted for reconsideration.", "Set aside"),
            ("Remitted", "1. The appeal be allowed. 2. The decision be set aside. 3. The matter be remitted for reconsideration.", None),
            ("Set aside", "1. The appeal be allowed. 2. The decision of the Refugee Review Tribunal be set aside. 3. The matter be remitted for reconsideration.", "Set aside"),
            ("Remitted", "1. The appeal be allowed. 2. The decision of the Refugee Review Tribunal be set aside. 3. The matter be remitted for reconsideration.", None),
            ("Set aside", "The Tribunal sets aside the decision and substitutes a decision that the application be granted.", "Set aside"),
            ("Remitted", "The Court sets aside the decision and remits the matter.", None),
            ("Affirmed", "The Tribunal remits the application.", None),
        )
        for value, quote, expected in cases:
            with self.subTest(value=value, quote=quote):
                self.assertEqual(_canonical_operative_outcome(value, quote), expected)

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

    def test_compact_aata_tribunal_header_extracts_member_before_date(self):
        body = (
            HEAD
            + "DECISION\n"
            + "Tribunal Ms A Poljak, Senior Member Date\n"
            + "9 November 2016 Place Sydney\n"
        )
        result = self.assess(body)
        self.assertEqual(result.values["judges"].value, "Ms A Poljak, Senior Member")
        self.assertEqual(result.values["judges"].rule, "compact_tribunal_member_header")

    def test_compact_aata_header_supports_role_before_member_name(self):
        body = (
            HEAD
            + "DECISION\n"
            + "Tribunal Deputy President DP Breen, Presidential Member Date\n"
            + "9 February 2000 Place Brisbane\n"
        )
        result = self.assess(body)
        self.assertEqual(
            result.values["judges"].value,
            "Deputy President DP Breen, Presidential Member",
        )

    def test_aata_table_header_keeps_member_separate_from_tribunal_label(self):
        body = (
            HEAD
            + "DECISION\n"
            + "Tribunal\nMr RG Kenny, Member\nDate 25 May 2004\nPlace Brisbane\n"
        )
        result = self.assess(body)
        self.assertEqual(result.values["judges"].value, "Mr RG Kenny, Member")
        self.assertEqual(result.values["judges"].rule, "compact_tribunal_member_header")

    def test_aata_table_header_supports_role_and_name_on_separate_rows(self):
        body = (
            HEAD
            + "DECISION\n"
            + "Tribunal\nDeputy President\nJ Block\nDate 6 August 2004\n"
        )
        result = self.assess(body)
        self.assertEqual(result.values["judges"].value, "Deputy President J Block")

    def test_judgment_certificate_identifies_surname_without_j_suffix(self):
        body = (
            "Example v Minister [2001] FCA 665\n"
            + "REASONS FOR JUDGMENT\nThe application is dismissed.\n"
            + "I certify that the preceding two (2) numbered paragraphs are a true copy "
            + "of the Reasons for Judgment herein of the Honourable Justice Wilcox.\n"
        )
        result = assess_case(body, citation="[2001] FCA 665")
        self.assertEqual(result.values["judges"].value, "Justice Wilcox")
        self.assertEqual(result.values["judges"].rule, "own_judgment_certification")
        self.assertIn("true copy of the Reasons for Judgment", result.values["judges"].quote)

    def test_federal_certificate_handles_split_words_and_long_appended_schedule(self):
        body = (
            "Example v Minister [2005] FMCA 965\nREASONS FOR JUDGMENT\n"
            + ("Schedule entry retained after publication.\n" * 150)
            + "I\ncertify that the preceding thirty paragraphs are a true copy of the "
            + "reasons for judgment of Smith\nFM\n"
            + ("Additional schedule entry retained after publication.\n" * 150)
        )
        result = assess_case(body, citation="[2005] FMCA 965")
        self.assertEqual(result.values["judges"].value, "Smith FM")
        self.assertEqual(result.values["judges"].rule, "own_judgment_certification")
        self.assertIn("Smith\nFM", result.values["judges"].quote)

    def test_federal_certificate_accepts_certifier_name_before_certify(self):
        body = (
            "Example v Minister [2005] FMCA 918\nREASONS FOR JUDGMENT\n"
            "I, Paul O'Halloran, certify\nthat the preceding paragraphs are a true copy "
            "of the reasons\nfor judgment of Walters\nFM\n"
        )
        result = assess_case(body, citation="[2005] FMCA 918")
        self.assertEqual(result.values["judges"].value, "Walters FM")
        self.assertEqual(result.values["judges"].rule, "own_judgment_certification")

    def test_federal_certificate_keeps_all_justices_named_across_lines(self):
        body = (
            "Example v Minister [2002] FCA 208\nREASONS FOR JUDGMENT\n"
            "I\ncertify that the preceding paragraphs are a true copy of the Reasons "
            "for Judgment herein of the Honourable Justices\n"
            "Heerey, Marshall and\nDowsett.\nAssociate:\n"
        )
        result = assess_case(body, citation="[2002] FCA 208")
        self.assertEqual(
            result.values["judges"].value,
            "Justices Heerey, Marshall and Dowsett",
        )
        self.assertEqual(result.values["judges"].rule, "own_judgment_certification")

    def test_federal_certificate_accepts_honourable_justice_split_across_lines(self):
        body = (
            "Example v Minister [2001] FCA 1297\nREASONS FOR JUDGMENT\n"
            "I certify that the preceding paragraphs are a true copy of the Reasons "
            "for Judgment herein\nof the Honourable\nJustice North.\nAssociate:\n"
        )
        result = assess_case(body, citation="[2001] FCA 1297")
        self.assertEqual(result.values["judges"].value, "Justice North")
        self.assertEqual(result.values["judges"].rule, "own_judgment_certification")

    def test_aata_certificate_identifies_member_when_header_name_is_missing(self):
        body = (
            "Example v Minister [2003] AATA 1023\n"
            + "DECISION\nTribunal\nDate 10 October 2003\n"
            + "I certify that the preceding paragraphs are a true copy of the reasons "
            + "for the decision herein of Ms N Bell, Member.\n"
        )
        result = assess_case(body, citation="[2003] AATA 1023")
        self.assertEqual(result.values["judges"].value, "Ms N Bell, Member")
        self.assertEqual(result.values["judges"].rule, "own_judgment_certification")

    def test_aata_certificate_does_not_drop_other_members_from_panel(self):
        body = (
            "Example v Minister [2012] AATA 423\n"
            + "DECISION\n"
            + "Tribunal Honourable Dr B H McPherson, Deputy President and Mr P Wulf, Member\n"
            + "Date 6 July 2012\n"
            + "I certify that the preceding paragraphs are a true copy of the reasons "
            + "for the decision herein of Honourable Dr B H McPherson, Deputy President.\n"
        )
        result = assess_case(body, citation="[2012] AATA 423")
        self.assertEqual(
            result.values["judges"].value,
            "Honourable Dr B H McPherson, Deputy President and Mr P Wulf, Member",
        )

    def test_aata_panel_on_separate_header_rows_keeps_both_members(self):
        body = (
            "Example v Minister [2012] AATA 141\n"
            "DECISION\n"
            "Tribunal The Hon Brian Tamberlin QC, Deputy President\n"
            "Ms J L Redfern, Senior Member Date 6 March 2012\n"
            "Place Sydney\n"
        )
        result = assess_case(body, citation="[2012] AATA 141")
        self.assertEqual(
            result.values["judges"].value,
            "The Hon Brian Tamberlin QC, Deputy President Ms J L Redfern, Senior Member",
        )

    def test_federal_court_judge_heading_accepts_surname_and_suffix_split_across_cells(self):
        body = (
            "WAHU v Minister for Immigration [2003] FCA 639\n"
            + "JUDGE:\nRD\nNICHOLSON J\nDATE OF ORDER:\n10 June 2003\n"
        )
        result = assess_case(body, citation="[2003] FCA 639")
        self.assertEqual(result.values["judges"].value, "RD NICHOLSON J")
        self.assertEqual(result.values["judges"].rule, "published_judge_surname_heading")

    def test_federal_court_judge_heading_accepts_literal_surname(self):
        body = (
            "Example v Minister [2000] FCA 77\n"
            + "JUDGE:\nMANSFIELD\nJ\nDATE OF ORDER:\n10 February 2000\n"
        )
        result = assess_case(body, citation="[2000] FCA 77")
        self.assertEqual(result.values["judges"].value, "MANSFIELD J")

    def test_split_federal_court_panel_is_read_under_the_judge_label(self):
        body = (
            "Abidin v Minister [2002] FCA 236\n"
            "JUDGE:\nBRANSON,\nNORTH and GYLES JJ\n"
            "DATE: 14 MARCH 2002\n"
            "PLACE: SYDNEY (HEARD IN PERTH)\n"
            "REASONS FOR JUDGMENT\n"
            "THE COURT: Introduction\n"
        )
        result = assess_case(body, citation="[2002] FCA 236", title="Abidin v Minister")
        proof = result.values["judges"]
        self.assertEqual(proof.value, "BRANSON, NORTH and GYLES JJ")
        self.assertEqual(proof.rule, "published_judicial_panel_heading")

    def test_unlabelled_judicial_names_stay_blank(self):
        body = (
            "Example v Minister [2002] FCA 236\n"
            "BRANSON, NORTH and GYLES JJ\n"
            "REASONS FOR JUDGMENT\n"
        )
        result = assess_case(body, citation="[2002] FCA 236", title="Example v Minister")
        self.assertNotIn("judges", result.values)

    def test_federal_court_judge_heading_rejects_date_and_place_labels(self):
        for value in ("DATE", "MELBOURNE"):
            with self.subTest(value=value):
                body = (
                    "Example v Minister [2000] FCA 77\n"
                    + f"JUDGE:\n{value}\nDATE OF ORDER:\n10 February 2000\n"
                )
                result = assess_case(body, citation="[2000] FCA 77")
                self.assertNotIn("judges", result.values)

    def test_lowercase_reasons_phrase_in_catchwords_does_not_hide_judge_heading(self):
        body = (
            "WAAB v Minister for Immigration [2002] FCA 782\n"
            "MIGRATION - Tribunal reasons for decision - no reviewable error\n"
            "JUDGE:\nFRENCH\nJ\nDATE OF ORDER:\n19 June 2002\n"
            "REASONS FOR JUDGMENT\nThe application is dismissed.\n"
        )
        result = assess_case(body, citation="[2002] FCA 782")
        self.assertEqual(result.values["judges"].value, "FRENCH J")

    def test_federal_court_judge_heading_preserves_all_members_in_a_panel(self):
        body = (
            "Iyer v Minister for Immigration [2001] FCA 929\n"
            "JUDGE:\nHEEREY,\nMANSFIELD AND GYLES JJ\nDATE:\n20 July 2001\n"
        )
        result = assess_case(body, citation="[2001] FCA 929")
        self.assertEqual(
            result.values["judges"].value,
            "HEEREY, MANSFIELD AND GYLES JJ",
        )

    def test_tribunal_member_label_joins_names_split_across_lines(self):
        body = (
            "Example v Minister [2004] RRTA 270\n"
            "Tribunal Member: Janet\nWood\nDate: 1 April 2004\n"
        )
        result = assess_case(body, citation="[2004] RRTA 270")
        self.assertEqual(result.values["judges"].value, "Janet Wood")

    def test_presiding_member_label_joins_title_and_name_split_across_lines(self):
        body = (
            "Example v Minister [2000] MRTA 1398\n"
            "PRESIDING MEMBER:\nMs\nWendy Bodisson\nMRT FILE NUMBER:\nV99/00214\n"
        )
        result = assess_case(body, citation="[2000] MRTA 1398")
        self.assertEqual(result.values["judges"].value, "Ms Wendy Bodisson")

    def test_bare_tribunal_header_with_date_identifies_single_member(self):
        body = (
            "Example v Minister [2004] AATA 1268\n"
            "DECISION\nTribunal\nMs Linda Savage Davis\n"
            "Date 30 November 2004\nPlace Perth\n"
        )
        result = assess_case(body, citation="[2004] AATA 1268")
        self.assertEqual(result.values["judges"].value, "Ms Linda Savage Davis")

    def test_aata_compact_header_accepts_honorific_initials_and_credentials(self):
        body = (
            "Example v Minister [2004] AATA 648\n"
            "DECISION\nTribunal\nThe Hon R N J Purvis Q.C., Deputy President\n"
            "Date 24 June 2004\nPlace Sydney\n"
        )
        result = assess_case(body, citation="[2004] AATA 648")
        self.assertEqual(
            result.values["judges"].value,
            "The Hon R N J Purvis Q.C., Deputy President",
        )

    def test_art_title_reasons_for_decision_does_not_hide_tribunal_member(self):
        body = (
            "Doan (Migration) [2025] ARTA 147\n"
            "Decision and\nReasons for Decision\n"
            "Tribunal Number:\n2313239\nTribunal:\nRosa Gagliardi\n"
            "Place: Australian Capital Territory\nDate: 6 February 2025\n"
        )
        result = assess_case(body, citation="[2025] ARTA 147")
        self.assertEqual(result.values["judges"].value, "Rosa Gagliardi")

    def test_early_rrt_reasons_title_does_not_hide_later_member_label(self):
        body = (
            "N99/29807 [2000] RRTA 591 (29 May 2000)\n"
            "REFUGEE REVIEW TRIBUNAL\nDECISION AND\nREASONS FOR DECISION\n"
            "RRT Reference: N99/29807\nCountry of Reference: Indonesia\n"
            "Tribunal Member: Roger GIBSON\nDate decision made: 29 May 2000\n"
        )
        result = assess_case(body, citation="[2000] RRTA 591")
        self.assertEqual(result.values["judges"].value, "Roger GIBSON")

    def test_member_label_joins_more_than_two_split_name_rows(self):
        body = (
            "Example v Minister [2000] RRTA 567\n"
            "REFUGEE REVIEW TRIBUNAL\nDECISION AND\nREASONS FOR DECISION\n"
            "Tribunal Member:\n\nMs\nPhilippa\nMcIntosh\nDate decision made:\n"
            "23 May 2000\n"
        )
        result = assess_case(body, citation="[2000] RRTA 567")
        self.assertEqual(result.values["judges"].value, "Ms Philippa McIntosh")

    def test_compact_aata_header_keeps_both_members_without_and(self):
        body = (
            "Example v Minister [2012] AATA 534\n"
            "DECISION AND REASONS FOR DECISION\n"
            "Tribunal Deputy President S D Hotop Ms K Hogan, Member\n"
            "Date 19 July 2012 Place Perth\n"
        )
        result = assess_case(body, citation="[2012] AATA 534")
        self.assertEqual(
            result.values["judges"].value,
            "Deputy President S D Hotop Ms K Hogan, Member",
        )

    def test_compact_aata_header_accepts_semicolon_panel_separator(self):
        body = (
            "Example v Minister [2022] AATA 4306\n"
            "DECISION\nTribunal:\n"
            "Chris Puplick AM, Senior Member; Mr S Evans, Member\n"
            "Date: 14 December 2022\n"
        )
        result = assess_case(body, citation="[2022] AATA 4306")
        self.assertEqual(
            result.values["judges"].value,
            "Chris Puplick AM, Senior Member; Mr S Evans, Member",
        )

    def test_compact_aata_header_joins_hyphenated_member_role(self):
        body = (
            "Example v Minister [2003] AATA 10\n"
            "DECISION\nTribunal Ms G Ettinger - Senior Member\n"
            "Date 8 January 2003\n"
        )
        result = assess_case(body, citation="[2003] AATA 10")
        self.assertEqual(result.values["judges"].value, "Ms G Ettinger - Senior Member")

    def test_certification_without_herein_names_issuing_member(self):
        body = (
            "Example v Minister [2003] AATA 1093\n"
            "DECISION\nTribunal\nDate 2 October 2003\n"
            "I certify that the preceding paragraphs are a true copy of the reasons "
            "for the decision of Michael Sassella\n"
        )
        result = assess_case(body, citation="[2003] AATA 1093")
        self.assertEqual(result.values["judges"].value, "Michael Sassella")
        self.assertEqual(result.values["judges"].rule, "own_judgment_certification")

    def test_certification_accepts_role_before_name_and_full_judicial_suffix(self):
        body = (
            "Example v Minister [2005] FMCA 932\nREASONS FOR JUDGMENT\n"
            "I certify that the preceding fourteen paragraphs are a true copy of the "
            "reasons for judgment of Pascoe\nCFM\n"
        )
        result = assess_case(body, citation="[2005] FMCA 932")
        self.assertEqual(result.values["judges"].value, "Pascoe CFM")
        self.assertIn("true copy of the reasons for judgment of Pascoe\nCFM", result.values["judges"].quote)

    def test_certification_without_true_copy_phrase_can_name_member(self):
        body = (
            "Example v Minister [2004] AATA 43\n"
            "I certify that the 70 preceding paragraphs are\n"
            "of Deputy President D.G. Jarvis\n"
        )
        result = assess_case(body, citation="[2004] AATA 43")
        self.assertEqual(result.values["judges"].value, "Deputy President D.G. Jarvis")

    def test_signed_member_can_be_inside_sgd_parentheses(self):
        body = (
            "Example v Minister [2004] AATA 285\nDECISION\n"
            "Tribunal\nDate 1 July 2004\n"
            ".........(sgd L Savage Davis)............\nMember\nCATCHWORDS\n"
        )
        result = assess_case(body, citation="[2004] AATA 285")
        self.assertEqual(result.values["judges"].value, "L Savage Davis Member")

    def test_signed_member_skips_dotted_signature_separator(self):
        body = (
            "Example v Minister [2022] AATA 1780\nDECISION\n"
            "Tribunal\nDate 20 May 2022\n[SGD]\n"
            "..............................................\n"
            "The Hon. Matthew Groom, Senior Member\nCATCHWORDS\n"
        )
        result = assess_case(body, citation="[2022] AATA 1780")
        self.assertEqual(
            result.values["judges"].value,
            "The Hon. Matthew Groom, Senior Member",
        )

    def test_corrupted_certified_name_is_not_written_as_judge(self):
        body = (
            "Example v Minister [2023] FCA 641\n"
            "I certify that the preceding paragraphs are a true copy of the Reasons "
            "for Judgment of the Honourable Justice O\ufffd\ufffdCallaghan .\n"
        )
        result = assess_case(body, citation="[2023] FCA 641")
        self.assertNotIn("judges", result.values)

    def test_single_signed_aata_member_is_recovered_from_explicit_signature(self):
        body = (
            "Example v Minister [2006] AATA 888\n"
            "DECISION\nTribunal\nDate 19 October 2006\n"
            "[sgd]......................\nMs. N. Isenberg, Senior Member\n"
            "CATCHWORDS\nCitizenship application\n"
        )
        result = assess_case(body, citation="[2006] AATA 888")
        self.assertEqual(
            result.values["judges"].value,
            "Ms. N. Isenberg, Senior Member",
        )
        self.assertEqual(result.values["judges"].rule, "signed_tribunal_member")

    def test_compact_aata_header_does_not_guess_panel_or_registrar(self):
        panel = self.assess(
            HEAD
            + "DECISION\n"
            + "Tribunal Deputy President C Kendall Brigadier AG Warner, Member Date\n"
            + "[Sgd] Deputy President Dr C Kendall\n"
        )
        registrar = self.assess(
            HEAD
            + "TRIBUNAL: Barry Johnson, Conference Registrar\n"
            + "DATE: 4 May 2016\n"
        )
        self.assertNotIn("judges", panel.values)
        self.assertNotIn("judges", registrar.values)

    def test_no_guesses_from_title_and_cited_judge(self):
        result = self.assess(HEAD + "REASONS FOR JUDGMENT\nIn Another v Minister [2001] FCA 10, Judge Jones dismissed the application.")
        self.assertEqual(result.values, {})

    def test_conflicting_identity_blocks_every_field(self):
        result = assess_case(BODY, citation="[2024] FCA 13")
        self.assertEqual(result.source_status, "identity_conflict")
        self.assertEqual(result.values, {})

    def test_citation_identity_accepts_space_after_opening_year_bracket(self):
        body = (
            "Example v Minister [  2005] FCA 1347\n"
            "JUDGE:\nHELY J\n"
            "THE COURT ORDERS THAT:\n1. The appeal be dismissed with costs.\n"
            "REASONS FOR JUDGMENT\n"
        )
        result = assess_case(body, citation="[2005] FCA 1347")
        self.assertEqual(result.source_status, "checked")
        self.assertEqual(result.values["judges"].value, "HELY J")
        self.assertEqual(result.values["outcome"].rule, "published_operative_table")

    def test_citation_identity_accepts_federal_court_reversed_year_order(self):
        body = (
            "FEDERAL COURT OF AUSTRALIA\n"
            "WEI FAN v MINISTER FOR IMMIGRATION AND MULTICULTURAL AND INDIGENOUS AFFAIRS\n"
            "FCA [2003] 1553\n"
            "WEI FAN v MINISTER FOR IMMIGRATION AND MULTICULTURAL AND INDIGENOUS AFFAIRS\n"
            "JUDGE: FRENCH J\n"
            "THE COURT ORDERS THAT:\n1. The application be dismissed.\n"
            "REASONS FOR JUDGMENT\n"
        )
        self.assertEqual(canonical_citation("FCA [2003] 1553"), "[2003] FCA 1553")
        result = assess_case(body, citation="[2003] FCA 1553")
        self.assertEqual(result.source_status, "checked")
        self.assertEqual(result.values["judges"].value, "FRENCH J")

    def test_written_direction_withholding_reasons_is_restricted_publication(self):
        body = (
            HEAD
            + "PRESIDING MEMBER: James Ferguson\n"
            + "A written direction has been made under section 378 of the Migration Act "
            "to withhold the publication of the Tribunal's Statement of Reasons and Decision."
        )
        result = self.assess(body)
        self.assertEqual(result.source_status, "restricted_publication")
        self.assertEqual(
            result.reasons,
            {
                "judges": "restricted_publication",
                "outcome": "restricted_publication",
                "visa_type": "restricted_publication",
            },
        )

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

    def structured_tribunal_visa_refusal(self, extra_clause=""):
        return (
            "[2000] MRTA 789\n"
            "VISA APPLICANT: SAMPLE APPLICANT\n"
            "DECISION: The Tribunal remits the application with a direction that the Visa Applicant has received a qualifying score in the points test.\n"
            "CATCHWORDS: Usual occupation - sufficient points\n"
            "APPLICATION FOR REVIEW:\n"
            "Visa Applicant Details: SAMPLE APPLICANT\n"
            "Decision Type: Visa refusal\n"
            "Date of Primary Decision: 26 February 1999\n"
            "JURISDICTION AND STANDING\n"
            "LEGISLATION, VISA CRITERIA AND POLICY\n"
            "Class AJ had Subclass 105 (Skilled - Australian Linked).\n"
            "Clause 105.222 of Part 105 of Schedule 2 to the Migration Regulations requires that the applicant must have the qualifying score under the points test.\n"
            + extra_clause
            + "As the visa applicant lodged her application on 22 April 1998, the criteria apply.\n"
        )

    def test_structured_visa_refusal_links_the_unique_current_subclass_clause(self):
        result = assess_case(self.structured_tribunal_visa_refusal(), citation="[2000] MRTA 789")
        self.assertEqual(result.source_status, "checked")
        self.assertEqual(result.values["visa_type"].value, "Subclass 105 visa")
        self.assertEqual(result.values["visa_type"].rule, "structured_visa_refusal_subclass_clause")
        self.assertTrue(any("Decision Type: Visa refusal" in quote
                            for quote in result.candidates[-1]["supporting_quotes"]))

    def test_structured_visa_refusal_requires_unambiguous_current_evidence(self):
        missing_date = self.structured_tribunal_visa_refusal().replace(
            "As the visa applicant lodged her application on 22 April 1998, the criteria apply.\n", ""
        )
        self.assertNotIn(
            "visa_type",
            assess_case(missing_date, citation="[2000] MRTA 789").values,
        )
        two_subclasses = self.structured_tribunal_visa_refusal(
            "Subclass 106 (Regional Linked). Clause 106.222 of Part 106 of Schedule 2 to the Migration Regulations requires that the applicant must have the qualifying score under the points test.\n"
        )
        self.assertNotIn(
            "visa_type",
            assess_case(two_subclasses, citation="[2000] MRTA 789").values,
        )

    def test_structured_visa_refusal_still_requires_matching_case_identity(self):
        result = assess_case(self.structured_tribunal_visa_refusal(), citation="[2000] MRTA 790")
        self.assertEqual(result.source_status, "identity_conflict")
        self.assertNotIn("visa_type", result.values)

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

    def test_unicode_minus_in_legacy_citizenship_heading_is_recognized(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: IMMIGRATION AND CITIZENSHIP \u2212 citizenship \u2212 "
            + "applicant applied for Australian citizenship \u2212 decision under review affirmed"
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )

    def test_citizenship_status_and_statutory_appeal_headings_are_recognized(self):
        headings = (
            "MIGRATION \u2013 whether applicant acquired Australian citizenship by virtue of abandonment",
            "MIGRATION \u2013 appeal from a decision to revoke the appellant's Australian citizenship",
            "MIGRATION \u2013 close and continuing association with Australia \u2013 decision-maker's "
            "discretion under s 22(9) of the Australian Citizenship Act 2007 (Cth)",
            "PRACTICE AND PROCEDURE \u2013 stay application \u2013 stay of Tribunal direction pending "
            "determination of appeal \u2013 s 23A of the Australian Citizenship Act 2007 (Cth)",
        )
        for heading in headings:
            with self.subTest(heading=heading):
                result = self.assess(HEAD + "CATCHWORDS: " + heading)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "citizenship_review_not_a_visa_application",
                )

    def test_formal_citizenship_file_heading_marks_visa_type_not_applicable(self):
        result = self.assess(
            HEAD
            + "CITIZENSHIP File number: NSD 721 of 2013\n"
            + "Australian Citizenship Act 2007 (Cth), s 33(7)\n"
            + "The application concerns renunciation of Australian citizenship."
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )

    def test_direct_citizenship_decisions_are_not_visa_type_candidates(self):
        sources = (
            "The decision refusing the applicant's application to become an Australian citizen by conferral is under review.",
            "The Tribunal is reviewing a decision to cancel approval granted to Mr Wang to become an Australian citizen.",
            "The applicant sought mandamus requiring the Minister to determine the applicant's citizenship application.",
            "The proceeding seeks review of the decision of the Minister to confer Australian citizenship on Joseph.",
            "The Minister must not allow citizenship to be conferred while court proceedings are pending.",
            "The applicant applied to the Minister for Australian citizenship and the Minister refused her application.",
        )
        for statement in sources:
            with self.subTest(statement=statement):
                result = self.assess(HEAD + "REASONS FOR JUDGMENT\n" + statement)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "citizenship_review_not_a_visa_application",
                )

    def test_citizenship_registration_under_the_act_is_not_a_visa_review(self):
        result = self.assess(
            HEAD
            + "REASONS FOR DECISION\nAustralian Citizenship Act 1948.\n"
            + "The application for registration was supported by a birth certificate."
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )

    def test_stay_of_removal_pending_citizenship_with_no_valid_visa_is_not_a_visa_review(self):
        result = self.assess(
            HEAD
            + "REASONS FOR JUDGMENT\nThe applicant does not currently hold a valid visa. "
            + "She seeks a stay of removal until her citizenship application is resolved."
        )
        self.assertEqual(result.not_applicable["visa_type"], "no_current_visa_decision")

    def test_explicit_freedom_of_information_subject_is_not_a_visa_review(self):
        for heading in (
            "ADMINISTRATIVE LAW \u2013 Freedom of Information \u2013 appeal from an access decision",
            "IMMIGRATION \u2013 Freedom of Information \u2013 amendment of personal information",
            "FREEDOM OF INFORMATION \u2013 requests for access refused",
        ):
            with self.subTest(heading=heading):
                result = self.assess(HEAD + heading)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "freedom_of_information_not_a_visa_decision",
                )

    def test_foi_mentions_in_a_visa_cancellation_case_do_not_hide_the_visa_issue(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: MIGRATION \u2013 judicial review of a decision to cancel the applicant's visa\n"
            + "LEGISLATION: Freedom of Information Act 1982 (Cth)\n"
            + "The Minister relied on evidence from a DVD."
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_citizenship_background_does_not_hide_a_visa_cancellation_case(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: MIGRATION \u2013 review of a decision not to revoke the mandatory "
            + "cancellation of the applicant's visa\n"
            + "The applicant is a New Zealand citizen and is not an Australian citizen."
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_child_citizenship_as_a_character_factor_is_not_a_citizenship_case(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: MIGRATION \u2013 judicial review of a character decision under s 501\n"
            + "Direction 65 required consideration of the wellbeing of a child who is an Australian citizen."
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_citizenship_cases_with_migration_prefix_are_not_visa_reviews(self):
        for catchwords in (
            "MIGRATION – CITIZENSHIP – citizenship by descent – decision affirmed",
            "MIGRATION – Australian citizenship – appeal from the Administrative Appeals Tribunal",
            "CITIZENSHIP – application for Australian citizenship – good character",
        ):
            with self.subTest(catchwords=catchwords):
                result = self.assess(HEAD + "CATCHWORDS: " + catchwords)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "citizenship_review_not_a_visa_application",
                )

    def test_citizenship_refusal_in_appeal_catchwords_ignores_current_visa_background(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: MIGRATION – application for extension of time and leave to appeal "
            + "from judicial review of an AAT decision – where the Tribunal upheld the decision "
            + "to refuse the applicant’s citizenship application\n"
            + "The applicant currently holds a Resident Return (Subclass 155) visa."
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )
        self.assertNotIn("visa_type", result.values)

    def test_citizenship_refusal_does_not_hide_a_separate_current_visa_cancellation(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: MIGRATION – appeal from refusal of citizenship application – "
            + "review of visa cancellation"
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_judicial_review_under_australian_citizenship_act_marks_visa_not_applicable(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: MIGRATION – application for judicial review of a delegate – "
            + "misapplied s 5(3)(b) of the Australian Citizenship Act 1948 (Cth) – "
            + "application dismissed"
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )
        self.assertNotIn("visa_type", result.values)

    def test_corporate_nomination_case_no3_is_not_the_nominee_visa_review(self):
        title = "Bharaj Construction Pty Ltd v Minister for Immigration (No.3) [2019] FCCA 31"
        body = (
            "Bharaj Construction Pty Ltd v Minister for Immigration (No.3) [2019] FCCA 31\n"
            + "CATCHWORDS: MIGRATION – application for review of Administrative Appeals Tribunal decision – "
            + "whether the Tribunal failed to consider the applicant’s certification – application dismissed\n"
            + "REASONS FOR JUDGMENT\n"
            + "Bharaj Construction Pty Ltd filed an application in this Court seeking review of the decision "
            + "of the Tribunal to refuse Bharaj’s application for approval of a nomination for a carpenter.\n"
            + "A separate proceeding sought review of the refusal of an Employer Nomination visa to Mr Sagoo.\n"
        )
        result = assess_case(body, citation="[2019] FCCA 31", title=title)
        self.assertEqual(
            result.not_applicable["visa_type"],
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertNotIn("visa_type", result.values)

    def test_nominee_visa_review_remains_relevant_when_company_is_related_party(self):
        title = "Sagoo v Minister for Immigration (No.4) [2019] FCCA 32"
        body = (
            "Sagoo v Minister for Immigration (No.4) [2019] FCCA 32\n"
            + "CATCHWORDS: MIGRATION – visa refusal – review of an Employer Nomination (Migrant) visa\n"
            + "REASONS FOR JUDGMENT\n"
            + "The applicant seeks review of the refusal of his Employer Nomination (Migrant) visa.\n"
        )
        result = assess_case(body, citation="[2019] FCCA 32", title=title)
        self.assertNotIn("visa_type", result.not_applicable)

    def test_corporate_aata_nomination_review_is_not_a_personal_visa_case(self):
        title = "Empire Bay Service Station Pty Ltd (Migration) [2017] AATA 1447"
        body = (
            title + "\n"
            + "REASONS FOR DECISION\n"
            + "This is an application for review of a decision made by a delegate to reject the applicant's "
            + "application for approval of the nomination of a position in Australia under r.5.19 of the "
            + "Migration Regulations 1994.\n"
        )
        result = assess_case(body, citation="[2017] AATA 1447", title=title)
        self.assertEqual(
            result.not_applicable["visa_type"],
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertNotIn("visa_type", result.values)

    def test_aata_position_nomination_decision_record_marks_visa_type_not_applicable(self):
        body = (
            "1517656 (Migration) [2016] AATA 3841\n"
            "DECISION RECORD\n"
            "DIVISION: Migration & Refugee Division\n"
            "APPLICANT: Sri Lanka Buddhist Monastery (Brisbane) Incorporated\n"
            "DECISION: The Tribunal sets aside the decision under review and substitutes "
            "a decision approving the nomination.\n"
            "STATEMENT OF DECISION AND REASONS\n"
            "APPLICATION FOR REVIEW\n"
            "This is an application for review of a decision made by a delegate to reject "
            "the applicant's application for approval of the nomination of a position in "
            "Australia under r.5.19 of the Migration Regulations 1994.\n"
            "The nominee held a religious worker visa, subclass The delegate refused the nomination.\n"
        )
        result = assess_case(
            body,
            citation="[2016] AATA 3841",
            title="1517656 (Migration) [2016] AATA 3841",
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertNotIn("visa_type", result.values)

    def test_personal_visa_heading_blocks_position_nomination_na_rule(self):
        body = (
            "Example v Minister [2016] AATA 3841\n"
            "CATCHWORDS: MIGRATION - visa refusal - Subclass 186 visa\n"
            "DECISION RECORD\n"
            "DECISION: The Tribunal affirms the refusal of the applicant's visa.\n"
            "This is an application for review of a decision made by a delegate to reject "
            "the applicant's application for approval of the nomination of a position in "
            "Australia under r.5.19 of the Migration Regulations 1994.\n"
        )
        result = assess_case(
            body,
            citation="[2016] AATA 3841",
            title="Example v Minister [2016] AATA 3841",
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_statutory_nomination_reviews_are_not_personal_visa_decisions(self):
        cases = (
            (
                "[2016] AATA 3057",
                "Example [2016] AATA 3057\n"
                "STATEMENT OF DECISION AND REASONS\nAPPLICATION FOR REVIEW\n"
                "An application has been lodged for review of a decision of a delegate "
                "to refuse a nomination under s.140GB of the Migration Act 1958.\n",
            ),
            (
                "[2023] FedCFamC2G 597",
                "Trustee for Example Unit Trust [2023] FedCFamC2G 597\n"
                "CATCHWORDS: MIGRATION LAW - review of a nomination decision under r.5.19\n"
                "REASONS FOR JUDGMENT\n"
                "The applicant company sought approval of a nomination under r.5.19.\n"
                "The delegate refused the nomination and the Tribunal affirmed that decision.\n"
                "The applicant filed an Originating Application for Review of the Tribunal's decision.\n",
            ),
            (
                "[2010] MRTA 2712",
                "[2010] MRTA 2712\nDECISION RECORD\n"
                "This is an application for review of a decision to reject an application "
                "for approval of a nominated position under r.5.19(1B).\n",
            ),
            (
                "[2016] AATA 3397",
                "[2016] AATA 3397\nDECISION RECORD\n"
                "DECISION: The Tribunal sets aside the decision under review and substitutes "
                "a decision approving the nomination.\n"
                "Approval of the nominated position is governed by r.5.19.\n",
            ),
            (
                "[2016] FCCA 2825",
                "Jayshree Enterprises Pty Ltd v Minister [2016] FCCA 2825\n"
                "CATCHWORDS: MIGRATION - review of an administrative decision\n"
                "REASONS FOR JUDGMENT\n"
                "The applicant sought judicial review of the Tribunal decision affirming "
                "the refusal of its nomination under s.140GB.\n",
            ),
        )
        for citation, body in cases:
            with self.subTest(citation=citation):
                result = assess_case(body, citation=citation)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "sponsorship_or_nomination_not_a_personal_visa",
                )
                self.assertNotIn("visa_type", result.values)

    def test_legacy_split_citizenship_heading_marks_visa_not_applicable(self):
        result = self.assess(
            HEAD
            + "DECISION Tribunal Mr John Handley, Senior Member "
            + "CITIZENSHIP Australia – application for citizenship by conferral"
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )

    def test_legacy_mojibake_citizenship_catchwords_mark_visa_not_applicable(self):
        for heading in (
            "Senior Member CITIZENSHIP \ufffdC application by spouse of an Australian citizen",
            "Senior Member CATCHWORDS \ufffdC CITIZENSHIP \ufffdC cancellation of citizenship approval",
            "CATCHWORDS\n\ufffdC CITIZENSHIP\n\n\ufffdC whether applicant of good character",
        ):
            with self.subTest(heading=heading):
                result = self.assess(HEAD + heading)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "citizenship_review_not_a_visa_application",
                )

    def test_current_visa_cancellation_in_citizenship_heading_stays_relevant(self):
        result = self.assess(
            HEAD + "CATCHWORDS – CITIZENSHIP – review of visa cancellation – subclass 866"
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_historical_visa_cancellation_does_not_block_citizenship_not_applicable(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: CITIZENSHIP – application for citizenship by conferral – residence test\n"
            + "LEGISLATION: Australian Citizenship Act 2007\n"
            + "The applicant's previous subclass 457 visa was cancelled before the citizenship application."
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )

    def test_citizenship_application_without_catchwords_label_is_not_a_visa_review(self):
        result = self.assess(
            HEAD + "DECISION AND REASONS FOR DECISION\n"
            "CITIZENSHIP - application for Australian citizenship - good character"
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )

    def test_citizenship_registration_order_is_not_a_visa_review(self):
        result = self.assess(
            HEAD
            + "THE COURT ORDERS THAT: The Minister be directed to register the applicant "
            "as an Australian citizen pursuant to s 10C of the Australian Citizenship Act."
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )

    def test_citizenship_does_not_override_an_explicit_visa_review(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: IMMIGRATION AND CITIZENSHIP – cancellation of applicant's visa – "
            "whether citizenship status affects cancellation"
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_citizenship_case_does_not_inherit_historical_visa_from_catchwords(self):
        body = (
            "Peter v Minister (Citizenship) [2024] AATA 3224\n"
            "DECISION\nThe delegate's decision to refuse citizenship is affirmed.\n"
            "CATCHWORDS\nCITIZENSHIP – application for citizenship by conferral – refusal of "
            "citizenship – false information on a resident return visa application\n"
            "REASONS FOR DECISION\n"
            "The Applicant first arrived as the holder of a Refugee (subclass 200) visa. "
            "He is currently the holder of a Resident Return (subclass 155) visa. "
            "The application before the Tribunal is the citizenship application.\n"
        )
        result = assess_case(
            body,
            citation="[2024] AATA 3224",
            title="Peter and Minister (Citizenship) [2024] AATA 3224",
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "citizenship_review_not_a_visa_application",
        )
        self.assertNotIn("visa_type", result.values)

    def test_unspecified_cancellation_with_no_primary_decision_has_no_visa_type(self):
        body = (
            HEAD
            + "DECISION RECORD\nAPPLICATION FOR REVIEW\n"
            + "An application was made to the Tribunal on 30 May 2014 for review of an unspecified visa cancellation. "
            + "At the time the review application was lodged, no relevant decision had been made. "
            + "There was no evidence before the Tribunal that the Department had made a decision to cancel a visa issued to him. "
            + "Information available to the Tribunal shows the applicant was issued with a Subclass 050 Bridging (General) visa after arrival. "
            + "That visa ceased on 13 June 2013. There has been no primary decision made to cancel any visa.\n"
            + "DECISION: The Tribunal does not have jurisdiction in this matter.\n"
        )
        result = self.assess(body)
        self.assertEqual(result.not_applicable["visa_type"], "no_current_visa_decision")
        self.assertNotIn("visa_type", result.values)

    def test_withdrawn_review_of_an_actual_visa_decision_is_not_not_applicable(self):
        body = (
            HEAD
            + "APPLICATION FOR REVIEW: review of the decision to cancel the applicant's Subclass 050 visa.\n"
            + "The applicant withdrew the review application. There is no longer a valid application for review, "
            + "and the Tribunal has no jurisdiction to conduct the review.\n"
        )
        result = self.assess(body)
        self.assertNotIn("visa_type", result.not_applicable)

    def test_migration_agent_registration_is_not_a_personal_visa_review(self):
        cases = (
            (
                "Migration Agents' Registration Authority",
                "MIGRATION AGENTS – Stay of decision refusing renewal of registration",
            ),
            (
                "Migrations Agents Registration Authority",
                "Regulated occupation – Migration agents – Automatic continuation of registration",
            ),
        )
        for authority, catchwords in cases:
            with self.subTest(authority=authority):
                body = HEAD + authority + "\nCATCHWORDS: " + catchwords
                result = assess_case(body, citation="[2024] FCA 12", title=authority)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "migration_agent_registration_not_a_personal_visa",
                )

    def test_migration_agent_registration_order_without_catchwords_is_not_a_visa_review(self):
        body = (
            HEAD
            + "And: MIGRATION AGENTS’ REGISTRATION AUTHORITY Respondent\n"
            + "Order: the decision refusing renewal of the applicant's registration as a "
            "migration agent is stayed."
        )
        result = self.assess(body)
        self.assertEqual(
            result.not_applicable["visa_type"],
            "migration_agent_registration_not_a_personal_visa",
        )

    def test_migration_agent_mentioned_as_representative_is_not_enough_for_na(self):
        result = self.assess(
            HEAD
            + "CATCHWORDS: MIGRATION – visa refusal – applicant represented by a migration agent"
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_cited_migration_agents_authority_does_not_make_case_about_agent_registration(self):
        body = (
            HEAD
            + "CATCHWORDS: INTERLOCUTORY APPLICATION – jurisdiction – whether the application "
            "was lodged in time. Shi v Migration Agents Registration Authority [2008] HCA 31."
        )
        result = assess_case(
            body,
            citation="[2024] FCA 12",
            title="Du and Minister for Immigration and Citizenship (Practice and procedure)",
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_non_immigration_commercial_domain_name_disputes_are_not_visa_cases(self):
        for catchwords in (
            "COMMERCIAL LAW – Acquisition and sale of generic internet domain name – breach of fiduciary duties",
            "COMMERCIAL LAW – Misappropriation of generic internet domain name – costs ordered",
        ):
            with self.subTest(catchwords=catchwords):
                result = self.assess(HEAD + "CATCHWORDS: " + catchwords)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "non_immigration_commercial_dispute",
                )

    def test_nomination_review_marks_personal_visa_not_applicable(self):
        result = self.assess(
            HEAD + "CATCHWORDS: MIGRATION – application for approval of nomination of position – Direct Entry"
        )
        self.assertEqual(result.not_applicable["visa_type"], "sponsorship_or_nomination_not_a_personal_visa")

    def test_personal_visa_refusal_resolves_sponsorship_na_when_subclass_is_unique(self):
        body = (
            "Nawsabreen v Minister [2021] FCCA 83\n"
            "CATCHWORDS: MIGRATION – Regional Employer Nomination visa – no approved nomination\n"
            "REASONS FOR JUDGMENT\n"
            "The first applicant applied for a Regional Employer Nomination (subclass 187) visa.\n"
            + ("The Court records a procedural filing. " * 18)
            + "\nThe applicant's delegate later refused the visa application because the required "
            "nomination was not approved.\n"
        )
        result = assess_case(body, citation="[2021] FCCA 83", title="Nawsabreen v Minister")
        self.assertEqual(result.values["visa_type"].value, "Subclass 187 visa")
        proof = _direct_personal_nomination_visa(document_text(body), "Nawsabreen v Minister")
        self.assertIsNotNone(proof)
        self.assertEqual(
            proof.rule,
            "direct_current_personal_visa_refusal",
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_named_visa_is_bound_to_appellants_application_refusal_and_tribunal_review(self):
        body = (
            "SZIGQ & Anor v Minister [2007] FCA 328\n"
            "REASONS FOR JUDGMENT\n"
            "The appellants are a husband and wife from Indonesia. They applied for protection "
            "visas, claiming a well-founded fear of persecution. Their applications were refused "
            "by the Minister's delegate. The appellants sought review by the Refugee Review Tribunal.\n"
        )
        result = assess_case(body, citation="[2007] FCA 328", title="SZIGQ & Anor v Minister")
        proof = result.values["visa_type"]
        self.assertEqual(proof.value, "protection visa")
        self.assertEqual(
            proof.rule,
            "direct_applicant_application_refusal_and_tribunal_review",
        )
        self.assertIn("Their applications were refused", proof.quote)
        self.assertIn("sought review by the Refugee Review Tribunal", proof.quote)

    def test_explicit_plural_visa_name_is_stored_as_one_visa_type(self):
        body = (
            "Example v Minister [2002] FCA 367\n"
            "CATCHWORDS: MIGRATION – application for review of a Refugee Review Tribunal decision\n"
            "REASONS FOR JUDGMENT\n"
            "The Tribunal affirmed a decision of a delegate to refuse protection visas to the applicants.\n"
        )
        result = assess_case(body, citation="[2002] FCA 367", title="Example v Minister")
        self.assertEqual(result.values["visa_type"].value, "protection visa")

    def test_named_visa_application_without_linked_refusal_and_tribunal_review_stays_blank(self):
        body = (
            "Example v Minister [2007] FCA 329\n"
            "REASONS FOR JUDGMENT\n"
            "The appellants applied for protection visas in 2005. The present appeal concerns "
            "a later procedural decision and does not identify a review of that refusal.\n"
        )
        result = assess_case(body, citation="[2007] FCA 329", title="Example v Minister")
        self.assertNotIn("visa_type", result.values)

    def test_named_visa_is_not_selected_when_current_applicants_have_conflicting_applications(self):
        body = (
            "Example v Minister [2007] FCA 330\n"
            "REASONS FOR JUDGMENT\n"
            "The applicants applied for protection visas and student visas. Their applications "
            "were refused by the delegate. The applicants sought review by the Refugee Review Tribunal.\n"
        )
        result = assess_case(body, citation="[2007] FCA 330", title="Example v Minister")
        self.assertNotIn("visa_type", result.values)

    def test_historical_visitor_subclass_is_not_used_for_current_protection_refusal(self):
        body = (
            "SZUIJ v Minister [2017] FCCA 1590\n"
            "CATCHWORDS: MIGRATION – protection visa application\n"
            "REASONS FOR JUDGMENT\n"
            "The delegate refused to grant the applicant a Protection (Class XA) visa. "
            "The applicant applied for a Protection visa, having arrived as the holder "
            "of a Visitor (Class FA) (Subclass 600) visa.\n"
        )
        proof = _direct_personal_nomination_visa(
            document_text(body), "SZUIJ v Minister"
        )
        self.assertIsNone(proof)
        result = assess_case(body, citation="[2017] FCCA 1590", title="SZUIJ v Minister")
        self.assertNotEqual(
            result.values.get("visa_type").value if result.values.get("visa_type") else None,
            "Subclass 600 visa",
        )

    def test_historical_subclass_601_is_not_used_for_current_protection_refusal(self):
        body = (
            "Example v Minister [2017] FCCA 1894\n"
            "CATCHWORDS: MIGRATION – protection visa application\n"
            "REASONS FOR JUDGMENT\n"
            "The Tribunal affirmed a decision not to grant the applicants a protection visa. "
            "The first applicant arrived in Australia on 7 August 2013, having been granted "
            "a subclass 601 visa which ceased on 7 November 2013. It was not until 2015 "
            "that the applicant applied for protection.\n"
        )
        proof = _direct_personal_nomination_visa(
            document_text(body), "Example v Minister"
        )
        self.assertIsNone(proof)

    def test_student_visa_subclass_beats_spouse_visa_in_reinstatement_evidence(self):
        body = (
            "Singh v Minister [2015] FCCA 2232\n"
            "CATCHWORDS: MIGRATION – application to reinstate judicial review\n"
            "REASONS FOR JUDGMENT\n"
            "The Applicant lodged an application for a Student (Subclass 570) visa "
            "(the visa) on 23 November 2012. The delegate refused to grant the "
            "Applicant the visa. The applicant later stated: \"I have faxed my "
            "medical certificate because my wife was sick, and she lodged the 309 "
            "visa application offshore.\"\n"
        )
        result = assess_case(body, citation="[2015] FCCA 2232", title="Singh v Minister")
        self.assertEqual(result.values["visa_type"].value, "Subclass 570 visa")
        self.assertEqual(
            result.values["visa_type"].rule,
            "current_student_application_refusal",
        )

    def test_spouse_subclass_application_is_not_the_applicants_current_visa(self):
        body = (
            "Example v Minister [2015] FCCA 2232\n"
            "CATCHWORDS: MIGRATION – reinstatement application dismissed\n"
            "REASONS FOR JUDGMENT\n"
            "The applicant stated: \"My wife was sick, and she lodged the 309 visa "
            "application offshore.\" The present application concerns reinstatement.\n"
        )
        result = assess_case(body, citation="[2015] FCCA 2232", title="Example v Minister")
        self.assertNotIn("visa_type", result.values)

    def test_expired_historical_subclass_is_not_bound_to_later_student_application(self):
        body = (
            "Example v Minister [2017] FCA 1333\n"
            "CATCHWORDS: MIGRATION – refusal of student visa\n"
            "REASONS FOR JUDGMENT\n"
            "The appellant previously held a Graduate Temporary Class VC subclass 485 visa "
            "that expired in 2014. In October 2014 she applied for the student visa in question. "
            "The delegate refused the student visa application.\n"
        )
        proof = _direct_personal_nomination_visa(
            document_text(body), "Example v Minister"
        )
        self.assertIsNone(proof)

    def test_current_numbered_visa_is_bound_when_named_in_the_refusal_sentence(self):
        body = (
            "Example v Minister [2024] FCA 123\n"
            "CATCHWORDS: MIGRATION – visa refusal\n"
            "REASONS FOR JUDGMENT\n"
            "The delegate refused to grant the applicant a Safe Haven Enterprise "
            "(Class XE) (Subclass 790) visa.\n"
        )
        proof = _direct_personal_nomination_visa(
            document_text(body), "Example v Minister"
        )
        self.assertEqual(proof.value if proof else None, "Subclass 790 visa")

    def test_named_personal_visa_refusal_resolves_sponsorship_na(self):
        categories = (
            "Regional Employer Nomination (Permanent) (Class RN) visa",
            "Regional Employer Nomination (Permanent) visa",
            "Employer Nomination (Residence) (Class BW) visa",
            "Child (Migrant) (Class AH) visas",
            "Temporary Business Entry (Class UC) (Temporary Work) (Skilled) (Subclass 457) visa",
        )
        for category in categories:
            with self.subTest(category=category):
                body = (
                    "Example v Minister [2024] FCA 1234\n"
                    "CATCHWORDS: MIGRATION – employer nomination review\n"
                    "REASONS FOR JUDGMENT\n"
                    f"The delegate refused to grant the applicant a {category}.\n"
                )
                result = assess_case(
                    body,
                    citation="[2024] FCA 1234",
                    title="Example v Minister",
                )
                expected = (
                    "Subclass 457 visa"
                    if "Subclass 457" in category
                    else category.replace(" visas", " visa")
                )
                self.assertEqual(result.values["visa_type"].value, expected)
                self.assertIn("refused to grant the applicant", result.values["visa_type"].quote)
                self.assertNotIn("visa_type", result.not_applicable)

        current_review = (
            "Example v Minister [2017] AATA 86\n"
            "CATCHWORDS: MIGRATION – Regional Employer Nomination (Permanent) "
            "(Class RN) visa – visa was refused\n"
            "REASONS FOR DECISION\n"
            "The Tribunal reviews the decision to refuse the applicant's "
            "Regional Employer Nomination (Permanent) (Class RN) visa.\n"
        )
        result = assess_case(
            current_review,
            citation="[2017] AATA 86",
            title="Bhardwaj and Minister (Migration)",
        )
        self.assertEqual(
            result.values["visa_type"].value,
            "Regional Employer Nomination (Permanent) (Class RN) visa",
        )
        self.assertNotIn("visa_type", result.not_applicable)

    def test_nomination_visa_refusal_supports_wrapped_class_and_visa_s_forms(self):
        body = (
            "Patel v Minister [2024] FedCFamC2G 1017\n"
            "CATCHWORDS: MIGRATION – Registrar's decision – sponsor employer deregistered\n"
            "REASONS FOR JUDGMENT\n"
            "The Tribunal affirmed the decision of a delegate to refuse to grant the applicants' "
            "Employer Nomination Scheme (Temporary Residence Transition) (subclass 186) visa(s) "
            "under s 65 of the Migration Act.\n"
        )
        result = assess_case(
            body,
            citation="[2024] FedCFamC2G 1017",
            title="Patel v Minister",
        )
        self.assertEqual(result.values["visa_type"].value, "Subclass 186 visa")
        self.assertIn("visa(s)", result.values["visa_type"].quote)

    def test_sponsorship_refusal_with_conflicting_subclasses_stays_unresolved(self):
        body = (
            "Example v Minister [2024] FCA 12\n"
            "CATCHWORDS: MIGRATION – employer nomination review\n"
            "REASONS FOR JUDGMENT\n"
            "The applicant applied for a Subclass 187 visa. A cited matter concerned a "
            "Subclass 482 visa. The delegate refused the applicant's visa application.\n"
        )
        result = assess_case(body, citation="[2024] FCA 12", title="Example v Minister")
        self.assertEqual(
            result.not_applicable["visa_type"],
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertNotIn("visa_type", result.values)

    def test_personal_visa_fallback_keeps_corporate_sponsor_case_not_applicable(self):
        body = (
            "Pirallo P/L (Migration) [2019] AATA 1967\n"
            "CATCHWORDS: MIGRATION – review of employer nomination approval\n"
            "REASONS FOR DECISION\n"
            "The applicant company seeks review of a nomination decision. Its employee's "
            "457 visa was refused in an earlier matter.\n"
        )
        result = assess_case(
            body,
            citation="[2019] AATA 1967",
            title="Pirallo P/L (Migration)",
        )
        self.assertEqual(
            result.not_applicable["visa_type"],
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertNotIn("visa_type", result.values)

    def test_business_sponsorship_review_does_not_inherit_employee_visa(self):
        body = (
            "Title: Tang, Betty [2001] MRTA 5132 (2 November 2001)\n"
            "Citation: [2001] MRTA 5132\n"
            "Court: MRTA\n"
            "Date: 2 November 2001\n"
            "URL: https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/MRTA/2001/5132.html\n"
            + "=" * 80 + "\n\n"
            "[2001] MRTA 5132\n\n"
            "CATCHWORDS:\tBusiness sponsorship - training - new technology - ability\n"
            "to meet financial undertakings\n\n"
            "BUSINESS SPONSOR:\tHarbour Inn Chinese Restaurant\n\n"
            "REVIEW APPLICANT: \tBetty TANG\n\n"
            "TRIBUNAL:\tMigration Review Tribunal\n\n"
            "DECISION:\tThe Tribunal affirms the decision to refuse to approve the\n"
            "Business Sponsor as a standard business sponsor or as a pre-qualified\n"
            "business sponsor.\n\n"
            "STATEMENT OF DECISION AND REASONS\n"
            "The criteria immediately relevant to this review are in Schedule 2, Part 457.\n"
            "The employment of the holder of a Subclass 457 (Business (Long Stay)) visa would\n"
            "contribute to the creation or maintenance of employment for Australian residents.\n"
        )
        self.assertIsNone(_direct_personal_nomination_visa(document_text(body), "Tang, Betty"))
        result = assess_case(body, citation="[2001] MRTA 5132", title="Tang, Betty [2001] MRTA 5132")
        self.assertEqual(
            result.not_applicable["visa_type"],
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertNotIn("visa_type", result.values)

    def test_business_sponsorship_and_nomination_reviews_do_not_borrow_457_evidence(self):
        cases = (
            (
                "[2003] MRTA 5359",
                "Le Rene Hair Design [2003] MRTA 5359\n"
                "CATCHWORDS: Review of business sponsorship rejection – temporary business entry scheme\n"
                "DECISION: The Tribunal affirms the decision, finding that the review applicant does not meet "
                "the criteria for approval as a standard business sponsor.\n"
                "STATEMENT OF DECISION AND REASONS\n"
                "The employment of the holder of a Subclass 457 (Business (Long Stay)) visa would contribute "
                "to the sponsor's business. A separate application about a related visa refusal was withdrawn.\n",
            ),
            (
                "[2003] MRTA 6603",
                "The Cafe Curry [2003] MRTA 6603\n"
                "CATCHWORDS: Review of business sponsorship rejection – temporary business entry scheme\n"
                "DECISION: The Tribunal affirms the decision, finding that the review applicant does not meet "
                "the criteria for approval as a standard business sponsor.\n"
                "STATEMENT OF DECISION AND REASONS\n"
                "A separate application for review relates to visa refusals for the business's cooks. "
                "They held UC 457 visas which expired before this sponsorship review.\n",
            ),
            (
                "[2003] MRTA 2133",
                "Gt Plastering [2003] MRTA 2133\n"
                "CATCHWORDS: Review of business sponsorship rejection – temporary business entry scheme\n"
                "DECISION: The Tribunal sets aside the refusal of approval as a standard business sponsor.\n"
                "STATEMENT OF DECISION AND REASONS\n"
                "A separate application for review concerns the refusal of a visa for the proposed employee, "
                "Mr Lukin, the 457 visa applicant.\n",
            ),
        )
        for citation, body in cases:
            with self.subTest(citation=citation):
                self.assertIsNone(
                    _direct_personal_nomination_visa(document_text(body), citation)
                )
                result = assess_case(body, citation=citation, title=citation)
                self.assertNotIn("visa_type", result.values)

    def test_costs_only_registrar_review_does_not_inherit_historical_visa(self):
        body = (
            "Qiao v Minister [2025] FedCFamC2G 84\n"
            "CATCHWORDS: Application for review of a Judicial Registrar's decision to set aside "
            "an order as to costs refused\n"
            "The substantive application challenged a decision to refuse the applicant a "
            "Regional Employer Nomination (Subclass 187) visa.\n"
        )
        self.assertIsNone(
            _direct_personal_nomination_visa(document_text(body), "Qiao v Minister")
        )

    def test_costs_only_judgment_does_not_inherit_underlying_visa(self):
        body = (
            "Qiao v Minister (No 3) [2025] FedCFamC2G 132\n"
            "CATCHWORDS: MIGRATION – Costs judgment.\n"
            "INTRODUCTION\n"
            "This judgment is in response to a request for written reasons in respect of the costs orders.\n"
            "In the substantive matter, the delegate refused the applicant a Regional Employer Nomination "
            "(Permanent) (Class RN) visa.\n"
        )
        self.assertIsNone(
            _direct_personal_nomination_visa(document_text(body), "Qiao v Minister (No 3)")
        )
        result = assess_case(body, citation="[2025] FedCFamC2G 132")
        self.assertNotIn("visa_type", result.values)
        self.assertEqual(
            result.not_applicable["visa_type"],
            "ancillary_costs_dispute_no_current_visa_review",
        )

    def test_class_bf_is_filled_only_for_the_current_cancellation_review(self):
        body = (
            "Kostopoulos v Minister [2018] AATA 3859\n"
            "CATCHWORDS: MIGRATION – mandatory visa cancellation – character test\n"
            "REASONS FOR DECISION\n"
            "On 27 September 2007 the Minister cancelled Mr Kostopoulos’ visa "
            "(Class BF transitional (permanent)) under s 501(2).\n"
            "DECISION\n"
            "The decision under review is set aside and in substitution thereof the "
            "cancellation of Mr Kostopoulos’ visa is revoked.\n"
        )
        result = assess_case(body, citation="[2018] AATA 3859")
        self.assertEqual(
            result.values["visa_type"].value,
            "Class BF Transitional (Permanent) visa",
        )
        self.assertEqual(
            result.values["visa_type"].rule,
            "current_class_bf_cancellation_review",
        )

    def test_class_bt_requires_the_named_application_refusal_and_review_link(self):
        body = (
            "Nakad v Minister [2013] FCA 810\n"
            "REASONS FOR JUDGMENT\n"
            "The appellants applied to the Department for Child (Residence) (Class BT) "
            "visas on 7 March 2012. The delegate refused to grant the visa on 16 March "
            "2012 and the appellants applied shortly thereafter to the Tribunal for a "
            "review of that decision. The appeal is dismissed.\n"
        )
        result = assess_case(body, citation="[2013] FCA 810")
        self.assertEqual(
            result.values["visa_type"].value,
            "Child (Residence) (Class BT) visa",
        )
        self.assertEqual(
            result.values["visa_type"].rule,
            "current_class_bt_application_refusal_review",
        )

    def test_historical_class_bf_without_current_review_outcome_stays_blank(self):
        body = (
            "Example v Minister [2018] FCA 12\n"
            "CATCHWORDS: MIGRATION – judicial review – application dismissed\n"
            "REASONS FOR JUDGMENT\n"
            "The Minister cancelled Mr Kostopoulos’ visa (Class BF transitional "
            "(permanent)) in 2007. The current application concerns a separate "
            "procedural decision.\n"
        )
        result = assess_case(body, citation="[2018] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_class_bt_in_legislation_without_a_linked_current_refusal_stays_blank(self):
        body = (
            "Example v Minister [2014] FCA 12\n"
            "REASONS FOR JUDGMENT\n"
            "The Migration Regulations refer to a Child (Residence) (Class BT) visa. "
            "This proceeding concerns a filing timetable only.\n"
        )
        result = assess_case(body, citation="[2014] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_section_499_direction_is_not_a_subclass_499_visa(self):
        body = (
            "Yalniz v Minister [2007] FCA 426\n"
            "CATCHWORDS: MIGRATION – Visa cancellation on character grounds\n"
            "REASONS FOR JUDGMENT\n"
            "The Minister cancelled the applicant's visa under s 501. The applicant challenges that decision.\n"
            "The Minister's Direction under section 499 – Visa Refusal and Cancellation under the Migration Act applies.\n"
        )
        result = assess_case(body, citation="[2007] FCA 426", title="Yalniz v Minister")
        self.assertNotIn("visa_type", result.values)
        self.assertIsNone(
            _direct_personal_nomination_visa(document_text(body), "Yalniz v Minister")
        )

    def test_sponsorship_appeal_does_not_inherit_historical_subclass_visa(self):
        body = (
            "Sood v Minister [2008] FCA 1797\n"
            "REASONS FOR JUDGMENT\n"
            "1 This is an appeal against a decision to refuse the appellant's application for "
            "Standard Business Sponsorship.\n"
            "PROCEDURAL HISTORY\n"
            "2 The appellant arrived in Australia on a business (short stay) 456 visa.\n"
        )
        self.assertIsNone(
            _direct_personal_nomination_visa(document_text(body), "Sood v Minister")
        )
        result = assess_case(body, citation="[2008] FCA 1797", title="Sood v Minister")
        self.assertNotIn("visa_type", result.values)

    def test_citizenship_refusal_does_not_inherit_old_temporary_visa(self):
        body = (
            "Zou and Minister [2016] AATA 160\n"
            "CATCHWORDS: PRACTICE AND PROCEDURE – review of a decision to refuse Australian citizenship\n"
            "FACTUAL BACKGROUND\n"
            "The applicant seeks an extension of time to review the decision to refuse to grant him "
            "Australian citizenship. He first arrived in Australia on a temporary TU-573 visa.\n"
        )
        result = assess_case(body, citation="[2016] AATA 160", title="Zou and Minister")
        self.assertNotIn("visa_type", result.values)
        self.assertIsNone(
            _direct_personal_nomination_visa(document_text(body), "Zou and Minister")
        )

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

    def test_intervention_injunction_case_does_not_use_historical_protection_visa(self):
        body = (
            "MZAPC v Minister for Immigration and Citizenship [2026] FedCFamC2G 1639\n"
            "Catchwords: MIGRATION – Judicial Review – Request for Ministerial Intervention "
            "under s 48B pending determination – Whether serious question to be tried – "
            "Whether interlocutory injunction should be granted to restrain removal – "
            "Application dismissed with costs\n"
            "Reasons for Judgment\n"
            "On 5 November 2014, the Refugee Review Tribunal affirmed the delegate’s "
            "decision to refuse the Protection (Subclass 866) visa application.\n"
        )
        result = assess_case(body, citation="[2026] FedCFamC2G 1639")
        self.assertEqual(
            result.not_applicable["visa_type"],
            "ministerial_intervention_not_a_visa_review",
        )
        self.assertNotIn("visa_type", result.values)

    def test_ministerial_intervention_decisions_are_not_visa_reviews(self):
        catchwords_examples = (
            "MIGRATION – Request for Ministerial Intervention – no decision engaging the Court's jurisdiction",
            "MIGRATION – Application for review of a decision not to refer request for Ministerial Intervention",
            "MIGRATION – where applicant made ministerial intervention request under ss 46A and 46B",
            "MIGRATION – practice and procedure – application for interlocutory injunction about removal and the applicant's application for Ministerial\nintervention",
        )
        for index, catchwords in enumerate(catchwords_examples):
            with self.subTest(catchwords=catchwords):
                body = (
                    HEAD
                    + "CATCHWORDS: " + catchwords + "\n"
                    + "REASONS FOR JUDGMENT\n"
                    + "The applicant previously applied for a Safe Haven Enterprise (Subclass 790) visa.\n"
                )
                result = self.assess(body)
                self.assertEqual(
                    result.not_applicable["visa_type"],
                    "ministerial_intervention_not_a_visa_review",
                )
                self.assertNotIn("visa_type", result.values)

    def test_intervention_case_with_explicit_visa_refusal_subject_is_not_na(self):
        body = (
            HEAD
            + "CATCHWORDS: MIGRATION – Judicial Review of visa refusal – Subclass 866 – "
            "Request for Ministerial Intervention – injunction application\n"
        )
        result = self.assess(body)
        self.assertNotIn("visa_type", result.not_applicable)
        self.assertIn("visa_type", result.values)

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

    def test_subclass_provision_linked_to_current_visa_application(self):
        body = (
            HEAD
            + "It was not open to the Minister to grant the applicant's visa application "
            + "because a condition precedent was that a nomination of the occupational training "
            + "was not lodged. The relevant provision is subclass 442.22 of Schedule 2.\n"
        )
        result = self.assess(body)
        proof = result.values["visa_type"]
        self.assertEqual(proof.value, "Subclass 442 visa")
        self.assertEqual(proof.rule, "current_visa_application_subclass_provision")
        self.assertIn("applicant's visa application", proof.quote)
        self.assertIn("subclass 442.22", proof.quote)

    def test_subclass_provision_without_current_application_link_is_held(self):
        result = self.assess(HEAD + "The relevant provision is subclass 442.22 of Schedule 2.\n")
        self.assertNotIn("visa_type", result.values)

    def test_verified_rrt_decision_headnote_identifies_protection_visa(self):
        body = (
            "Example v Minister [2004] FCA 12\n"
            "MIGRATION – Review of decision by Refugee Review Tribunal – application dismissed.\n"
            "Migration Act 1958 (Cth), s 477(1)\n"
            "REASONS FOR JUDGMENT\nThe applicant sought review of an RRT decision made on 12 March 2001.\n"
        )
        result = assess_case(body, citation="[2004] FCA 12")
        proof = result.values["visa_type"]
        self.assertEqual(proof.value, "Protection visa")
        self.assertEqual(proof.rule, "rrt_protection_visa_review_under_migration_act_s411")
        self.assertIn("Review of decision by Refugee Review Tribunal", proof.quote)
        self.assertIn("decision made on 12 March 2001", result.candidates[-1]["qualification_quote"])

    def test_rrt_jurisdictional_error_headnote_with_dated_review_identifies_protection_visa(self):
        body = (
            "MZYGC & Ors v Minister [2010] FMCA 230\n"
            "MIGRATION – Alleged jurisdictional error by RRT in dealing with evidence of applicant's wife – "
            "jurisdictional error not disclosed.\n"
            "Migration Act 1958 (Cth)\n"
            "REASONS FOR JUDGMENT\n"
            "The applicants seek review of a decision of the Refugee Review Tribunal\n"
            "(\"Tribunal\") made on 30 July 2009.\n"
        )
        result = assess_case(body, citation="[2010] FMCA 230")
        proof = result.values["visa_type"]
        self.assertEqual(proof.value, "Protection visa")
        self.assertEqual(proof.rule, "rrt_protection_visa_review_under_migration_act_s411")
        self.assertIn("jurisdictional error by RRT", proof.quote)
        self.assertIn("made on 30 July 2009", result.candidates[-1]["qualification_quote"])

    def test_dated_rrt_subject_in_opening_reasons_identifies_protection_visa(self):
        body = (
            "Applicant S233 of 2003 v Minister [2006] FCA 415\n"
            "MIGRATION – Application dismissed.\n"
            "Migration Act 1958 (Cth)\n"
            "REASONS FOR JUDGMENT\n"
            "On 13 December 2005, the applicant filed a notice of motion seeking an order that "
            "the decision of the Refugee Review Tribunal made on 1 December 2003 be set aside.\n"
        )
        result = assess_case(body, citation="[2006] FCA 415")
        proof = result.values["visa_type"]
        self.assertEqual(proof.value, "Protection visa")
        self.assertEqual(proof.rule, "rrt_protection_visa_review_under_migration_act_s411")
        self.assertIn("decision of the Refugee Review Tribunal", proof.quote)
        self.assertIn("made on 1 December 2003", result.candidates[-1]["qualification_quote"])

    def test_dated_rrt_subject_without_migration_catchwords_identifies_protection_visa(self):
        body = (
            "Applicant S233 of 2003 v Minister [2006] FCA 415\n"
            "REASONS FOR JUDGMENT\n"
            "On 13 December 2005, the applicant filed a notice of motion seeking an order that "
            "the decision of the Refugee Review Tribunal made on 1 December 2003 be set aside.\n"
        )
        result = assess_case(body, citation="[2006] FCA 415")
        proof = result.values["visa_type"]
        self.assertEqual(proof.value, "Protection visa")
        self.assertEqual(proof.rule, "rrt_protection_visa_review_under_migration_act_s411")

    def test_no_catchwords_rrt_link_does_not_bypass_section_48b_context(self):
        body = (
            "Example v Minister [2006] FCA 12\n"
            "REASONS FOR JUDGMENT\n"
            "The application is for review of a decision of the Refugee Review Tribunal made on 1 May 2003. "
            "The applicant also challenges the Minister's decision under s 48B.\n"
        )
        result = assess_case(body, citation="[2006] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_distant_rrt_date_qualifies_only_when_the_source_has_one_clear_decision(self):
        body = (
            "Example v Minister [2006] FCA 12\n"
            "MIGRATION – Application dismissed.\n"
            "Migration Act 1958 (Cth)\n"
            "REASONS FOR JUDGMENT\n"
            "The application seeks judicial review of a decision of the Refugee Review Tribunal.\n"
            + ("The applicant gave evidence about the history of this proceeding.\n" * 12)
            + "The decision of the Tribunal was made on 1 December 2003.\n"
        )
        result = assess_case(body, citation="[2006] FCA 12")
        proof = result.values["visa_type"]
        self.assertEqual(proof.value, "Protection visa")
        self.assertIn("decision of the Refugee Review Tribunal", proof.quote)
        self.assertIn("made on 1 December 2003", result.candidates[-1]["qualification_quote"])

    def test_distant_rrt_date_is_held_when_the_case_has_multiple_decision_dates(self):
        body = (
            "Example v Minister [2006] FCA 12\n"
            "MIGRATION – Application dismissed.\n"
            "Migration Act 1958 (Cth)\n"
            "REASONS FOR JUDGMENT\n"
            "The application seeks judicial review of a decision of the Refugee Review Tribunal.\n"
            + ("The applicant gave evidence about the history of this proceeding.\n" * 12)
            + "A decision of the Tribunal was made on 1 December 2003.\n"
            + "A second decision of the Tribunal was made on 4 February 2004.\n"
        )
        result = assess_case(body, citation="[2006] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_distant_rrt_date_for_a_different_applicant_is_held(self):
        body = (
            "Example v Minister [2006] FCA 12\n"
            "MIGRATION – Application dismissed.\n"
            "Migration Act 1958 (Cth)\n"
            "REASONS FOR JUDGMENT\n"
            "The application seeks judicial review of a decision of the Refugee Review Tribunal.\n"
            + ("The applicant gave evidence about the history of this proceeding.\n" * 12)
            + "A decision of the Refugee Review Tribunal dated 1 December 2003 appears to refer to a different applicant.\n"
        )
        result = assess_case(body, citation="[2006] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_distant_rrt_date_parser_uses_the_decision_year_not_a_later_court_year(self):
        body = (
            "Example v Minister [2006] FCA 12\n"
            "MIGRATION – Application dismissed.\n"
            "Migration Act 1958 (Cth)\n"
            "REASONS FOR JUDGMENT\n"
            "The application seeks judicial review of an adverse decision of the Refugee Review Tribunal.\n"
            + ("The applicant gave evidence about the history of this proceeding.\n" * 12)
            + "The Tribunal's decision was delivered in December 2001 and it was not until January 2005 that the applicant approached the Court.\n"
        )
        result = assess_case(body, citation="[2006] FCA 12")
        self.assertEqual(result.values["visa_type"].value, "Protection visa")
        self.assertIn("December 2001", result.candidates[-1]["qualification_quote"])
        self.assertNotIn("January 2005", result.candidates[-1]["qualification_quote"])

    def test_minister_decision_with_an_rrt_history_is_not_an_rrt_review_target(self):
        body = (
            "Example v Minister [2006] FMCA 12\n"
            "REASONS FOR JUDGMENT\n"
            "This is an application for judicial review of a decision of the Minister in a refugee case "
            "whereby the applicant has been before the Refugee Review Tribunal.\n"
            + ("The applicant filed material about the history of this proceeding.\n" * 12)
            + "The Refugee Review Tribunal decision was handed down on 1 December 2003.\n"
        )
        result = assess_case(body, citation="[2006] FMCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_body_rrt_inference_does_not_bypass_ambiguous_section_417_target(self):
        body = (
            "Example v Minister [2005] FMCA 12\n"
            "MIGRATION – Application for orders nisi in respect of a decision of the Refugee Review Tribunal.\n"
            "Migration Act 1958 (Cth), s.417\n"
            "REASONS FOR JUDGMENT\n"
            "The application on its face purports to challenge the decision of the Minister, which is the "
            "Ministerial decision under s.417. The notice of motion also seeks an order that the decision of "
            "the Refugee Review Tribunal made on 11 December 2001 be set aside.\n"
        )
        result = assess_case(body, citation="[2005] FMCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_reviewable_s36_2c_decision_and_complementary_protection_identify_protection_visa(self):
        body = (
            "WSZB and Minister for Immigration and Border Protection (Migration) [2019] AATA 163\n"
            "CATCHWORDS\nMIGRATION – serious non-political crime – decision under review affirmed\n"
            "LEGISLATION\nMigration Act 1958 (Cth), s 36\n"
            "REASONS FOR DECISION\n"
            "The reviewable decision made by the Minister's delegate was that within the meaning of "
            "s.36 (2C)(a)(ii) of the Migration Act 1958 (Cth) there are serious reasons for considering "
            "that the applicant committed a serious non-political crime. If so, complementary protection "
            "obligations under s.36(2)(aa) of the Act are not owed in relation to the applicant.\n"
        )
        result = assess_case(body, citation="[2019] AATA 163")
        proof = result.values["visa_type"]
        self.assertEqual(proof.value, "Protection visa")
        self.assertEqual(proof.rule, "protection_visa_s36_reviewable_decision")
        self.assertIn("reviewable decision", proof.quote)
        self.assertIn("complementary protection obligations under s.36(2)(aa)",
                      result.candidates[-1]["qualification_quote"])

    def test_incidental_s36_citation_does_not_identify_protection_visa(self):
        body = (
            "Example v Minister [2019] FCA 12\n"
            "CATCHWORDS\nMIGRATION – judicial review dismissed\n"
            "REASONS FOR JUDGMENT\n"
            "Section 36(2C)(a)(ii) is discussed in a cited authority. The current decision under review "
            "is not identified.\n"
        )
        result = assess_case(body, citation="[2019] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_rrt_reference_and_minister_intervention_do_not_identify_visa_type(self):
        body = (
            "Example v Minister [2004] FCA 12\n"
            "MIGRATION – review of the Minister's decision not to substitute a more favourable decision for an RRT decision.\n"
            "Migration Act 1958 (Cth), s 417\n"
            "REASONS FOR JUDGMENT\nThe RRT decision was made on 12 March 2001. The applicant sought ministerial intervention.\n"
        )
        result = assess_case(body, citation="[2004] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_ambiguous_rrt_or_section_417_target_is_not_inferred_as_protection_visa(self):
        body = (
            "Example v Minister [2005] FMCA 12\n"
            "MIGRATION – Application for orders nisi in respect of a decision of the Refugee Review Tribunal.\n"
            "Migration Act 1958 (Cth), s.417\n"
            "REASONS FOR JUDGMENT\n"
            "The application on its face purports to challenge the decision of the Minister, which is the "
            "Ministerial decision under s.417. If the applicant seeks to again challenge the decision of the "
            "RRT made on 11 December 2001, the application faces insuperable problems.\n"
        )
        result = assess_case(body, citation="[2005] FMCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_old_rrt_decision_is_not_inferred_as_protection_visa_from_court_year(self):
        body = (
            "Example v Minister [2005] FCA 12\n"
            "MIGRATION – Review of decision by Refugee Review Tribunal – application dismissed.\n"
            "Migration Act 1958 (Cth), s 477(1)\n"
            "REASONS FOR JUDGMENT\nThe RRT decision was made on 12 March 1993.\n"
        )
        result = assess_case(body, citation="[2005] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_rrt_headnote_without_original_decision_date_is_held(self):
        body = (
            "Example v Minister [2004] FCA 12\n"
            "MIGRATION – Review of decision by Refugee Review Tribunal – application dismissed.\n"
            "Migration Act 1958 (Cth), s 477(1)\n"
            "REASONS FOR JUDGMENT\nThe application concerns an RRT decision.\n"
        )
        result = assess_case(body, citation="[2004] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_earlier_rrt_decision_date_does_not_qualify_current_review(self):
        body = (
            "Example v Minister [2004] FCA 12\n"
            "MIGRATION – Review of a decision of the Refugee Review Tribunal – application dismissed.\n"
            "Migration Act 1958 (Cth), s 477(1)\n"
            "REASONS FOR JUDGMENT\nThe applicant previously challenged an earlier decision by the Tribunal made on 12 March 2001.\n"
            "The date of the RRT decision now under review is not stated.\n"
        )
        result = assess_case(body, citation="[2004] FCA 12")
        self.assertNotIn("visa_type", result.values)

    def test_background_rrt_decision_does_not_turn_costs_application_into_visa_case(self):
        body = (
            "Minister for Immigration v Example [2006] FMCA 390\n"
            "REASONS FOR JUDGMENT\n"
            "1. The respondent Minister seeks a costs order against the applicant's former solicitors "
            "for costs thrown away by the conduct of the substantive proceeding.\n"
            "2. The application concerns the conduct of the former solicitors.\n"
            "Background\n"
            "3. On 16 September 2004 the applicant filed a judicial review application relating to a "
            "decision of the Refugee Review Tribunal made on 1 February 2000.\n"
        )
        result = assess_case(body, citation="[2006] FMCA 390")
        self.assertEqual(
            result.not_applicable["visa_type"],
            "ancillary_costs_dispute_no_current_visa_review",
        )
        self.assertNotIn("visa_type", result.values)

    def test_current_rrt_review_still_qualifies_when_costs_are_incidental(self):
        body = (
            "Example v Minister [2006] FMCA 12\n"
            "MIGRATION – Review of decision by Refugee Review Tribunal – application dismissed.\n"
            "REASONS FOR JUDGMENT\n"
            "This is an application for judicial review of the decision of the Refugee Review Tribunal "
            "made on 12 March 2001. The application is dismissed with costs.\n"
        )
        result = assess_case(body, citation="[2006] FMCA 12")
        self.assertEqual(result.values["visa_type"].value, "Protection visa")
        self.assertNotIn("visa_type", result.not_applicable)

    def test_bare_numeric_visa_name_is_captured_when_current_refusal_is_linked(self):
        body = (
            "Ved v Minister [2018] FCCA 2827\n"
            "CATCHWORDS: MIGRATION – review of Administrative Appeals Tribunal decision – "
            "jurisdictional error not established\n"
            "REASONS FOR JUDGMENT\n"
            "The Applicant applied to the Minister's department for a 457 visa. The delegate "
            "refused to grant the 457 visa because there was no approved nomination. The "
            "Applicant sought review of that decision before the Tribunal.\n"
        )
        result = assess_case(body, citation="[2018] FCCA 2827")
        self.assertEqual(result.values["visa_type"].value, "Subclass 457 visa")
        self.assertEqual(
            result.values["visa_type"].rule,
            "direct_current_numbered_visa_decision",
        )

    def test_inline_reasons_heading_exposes_current_numbered_visa_decision(self):
        body = (
            "Ved v Minister [2018] FCCA 2827\n"
            "CATCHWORDS: MIGRATION - Review of Administrative Appeals Tribunal decision\n"
            "ADMINISTRATIVE APPEALS TRIBUNAL\n"
            "Second Respondent REASONS FOR JUDGMENT (Ex tempore) "
            "The Applicant applied for a 457 visa. The delegate refused to grant that "
            "457 visa and the Tribunal affirmed the refusal.\n"
        )
        result = assess_case(body, citation="[2018] FCCA 2827")
        self.assertEqual(result.values["visa_type"].value, "Subclass 457 visa")

    def test_ceased_visa_mention_does_not_borrow_distant_appeal_action(self):
        body = (
            "Singh v Minister [2026] FCA 1449\n"
            "CATCHWORDS: MIGRATION - application for leave to appeal - failure to prosecute\n"
            "REASONS FOR JUDGMENT\n"
            "The applicant filed an application for leave to appeal in this Court. "
            "The proceeding concerns compliance with court directions and the applicant "
            "did not file submissions. "
            "The records show that the applicant's WE-050 visa has ceased, and that he "
            "does not currently hold an Australian visa.\n"
        )
        result = assess_case(body, citation="[2026] FCA 1449")
        self.assertNotIn("visa_type", result.values)

    def test_legacy_class_codes_are_bound_to_the_current_visa_decision(self):
        examples = (
            (
                "[2007] AATA 12",
                "Example v Minister [2007] AATA 12\n"
                "CATCHWORDS: MIGRATION – visa cancellation – character test\n"
                "REASONS FOR DECISION\nThe decision was to cancel the applicant's TY 444 visa.\n",
                "Subclass 444 visa",
            ),
            (
                "[2010] MRTA 12",
                "Example v Minister [2010] MRTA 12\n"
                "CATCHWORDS: MIGRATION – review of visa cancellation\n"
                "STATEMENT OF DECISION AND REASONS\n"
                "The applicant was granted a student TU-572 visa. The visa was automatically "
                "cancelled and the applicant applied for review of that cancellation.\n",
                "Subclass 572 visa",
            ),
            (
                "[2013] FCCA 12",
                "Minister v Example [2013] FCCA 12\n"
                "CATCHWORDS: MIGRATION – review application by Minister\n"
                "REASONS FOR JUDGMENT\nThe Tribunal upheld the review of the delegate's "
                "decision not to grant the first respondent a subclause 802 visa.\n",
                "Subclass 802 visa",
            ),
            (
                "[2023] FedCFamC2G 12",
                "Example v Minister [2023] FedCFamC2G 12\n"
                "CATCHWORDS: MIGRATION – 485 visa – application for review – applicant seeks "
                "review of the registrar's order\nREASONS FOR JUDGMENT\n",
                "Subclass 485 visa",
            ),
        )
        for citation, body, expected in examples:
            with self.subTest(expected=expected):
                result = assess_case(body, citation=citation)
                self.assertEqual(result.values["visa_type"].value, expected)

    def test_visa_code_in_a_citation_or_for_another_applicant_is_not_current_evidence(self):
        cited_case = (
            "Example v Minister [2011] FCA 12\n"
            "CATCHWORDS: MIGRATION – application about publication procedure\n"
            "REASONS FOR JUDGMENT\n"
            "The Court mentions [2005] AATA 798 Visa Cancellation Applicant and Minister "
            "for Immigration as a cited case. No visa category is identified for this appeal.\n"
        )
        wrong_applicant = (
            "Example v Minister [2001] AATA 519\n"
            "CATCHWORDS: MIGRATION – visa review\n"
            "REASONS FOR DECISION\nMr Chen applied for a sub-class 129 visa for his employment. "
            "The present applicant is not named in that application.\n"
        )
        for body, citation in ((cited_case, "[2011] FCA 12"), (wrong_applicant, "[2001] AATA 519")):
            with self.subTest(citation=citation):
                result = assess_case(body, citation=citation)
                self.assertNotIn("visa_type", result.values)

    def test_nomination_only_review_does_not_fill_personal_visa_type(self):
        body = (
            "TLC Foods Pty Ltd v Minister [2016] AATA 3979\n"
            "CATCHWORDS: MIGRATION – review of refusal of nomination application\n"
            "DECISION RECORD\nThe Tribunal affirms the decision under review to refuse the nomination.\n"
            "REASONS FOR DECISION\nThe applicant company sought approval of a nomination for an "
            "employee who held a Subclass 457 visa.\n"
        )
        result = assess_case(body, citation="[2016] AATA 3979", title="TLC Foods Pty Ltd")
        self.assertEqual(
            result.not_applicable["visa_type"],
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertNotIn("visa_type", result.values)

    def test_costs_only_discontinuance_does_not_inherit_old_visa_type(self):
        body = (
            "Prevendido v Minister [2014] FCCA 215\n"
            "CATCHWORDS: PRACTICE AND PROCEDURE – Costs – where applicant seeks to file "
            "notice of discontinuance – where respondent claims costs\n"
            "REASONS FOR JUDGMENT\nThe applicant had applied for a Skilled (Provisional) "
            "(Class VC) visa in the earlier proceeding. The present application concerns costs.\n"
        )
        result = assess_case(body, citation="[2014] FCCA 215")
        self.assertEqual(
            result.not_applicable["visa_type"],
            "ancillary_costs_dispute_no_current_visa_review",
        )
        self.assertNotIn("visa_type", result.values)

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
    def test_historical_student_subclasses_map_to_class_tu(self):
        from immi_case_downloader.repair_workflow import _expected_visa_metadata

        for subclass in ("570", "571", "572", "573", "574", "575", "576"):
            with self.subTest(subclass=subclass):
                self.assertEqual(
                    _expected_visa_metadata("visa_class_code", f"Subclass {subclass} visa"),
                    "TU",
                )

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
                      "full_text_path": "downloaded_cases/case.txt", "text_snippet": "",
                      "visa_subclass": "", "visa_class_code": "", "visa_subclass_number": ""},
                     {"case_id": "b", "citation": "[2024] FCA 13", "title": "Other",
                      "url": "", "judges": "Correct J", "outcome": "Allowed", "visa_type": "Subclass 866",
                      "user_notes": "", "full_text_path": "", "text_snippet": "",
                      "visa_subclass": "572", "visa_class_code": "TP", "visa_subclass_number": "572.0"}]
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

    def test_legacy_reason_labels_normalize_to_stable_codes(self):
        for label, code in _LEGACY_REASON_CODE_ALIASES.items():
            with self.subTest(label=label[:48]):
                self.assertIn(code, REASONS)
                self.assertEqual(_normalize_reason_code(label), code)
        self.assertEqual(
            _normalize_reason_code(REASONS["sponsorship_or_nomination_not_a_personal_visa"]),
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        self.assertEqual(_normalize_reason_code("future_unknown_reason"), "future_unknown_reason")

    def test_source_limit_reasons_require_verified_identity_and_page_shell(self):
        row = {
            "citation": "[2007] MRTA 729",
            "title": "071235250 [2007] MRTA 729 (12 December 2007)",
            "url": "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/MRTA/2007/729.html",
        }
        shell = (
            f"Title: {row['title']}\nCitation: {row['citation']}\nCourt: MRTA\n"
            f"URL: {row['url']}\n{'=' * 80}\n"
            "Specific Year\nAny\n2015\n1970\nApply\n-->\n"
            "Print (pretty)\nPrint (eco-friendly)\nRTF format (107 KB)\n"
            "Signed PDF/A format\nLawCite records\nNoteUp references\n"
            "Tweet this page\nFollow @AustLII on Twitter\n-->\n"
        )
        self.assertEqual(_source_limitation_reason(row, shell), "incomplete_publication")
        self.assertEqual(
            _source_limitation_reason(row, shell + "DECISION: The application is dismissed.\n"),
            "",
        )
        wrong_identity = dict(row, citation="[2007] MRTA 730")
        self.assertEqual(_source_limitation_reason(wrong_identity, shell), "")

        restricted = (
            "[2003] MRTA 140\nDIRECTION TO RESTRICT PUBLICATION OF INFORMATION\n"
            "(a) the whole of decision due to best interests of the children and health condition of the child"
        )
        self.assertEqual(_source_limitation_reason({}, restricted), "restricted_publication")

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
        catchwords = "MIGRATION - Temporary Business Entry (Class UC) visas - application dismissed"
        body = (
            HEAD
            + "CATCHWORDS: " + catchwords + "\n"
            + "JUDGE: SMITH J\nORDERS:\n1. The application is dismissed.\n"
            + "REASONS FOR JUDGMENT\nThe case concerns the applicant's relationship.\n"
        )
        self.source.write_text(body, encoding="utf-8")
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
        self.assertEqual(visa["evidence"]["value"], "Temporary Business Entry (Class UC) visa")
        self.assertIn("Temporary Business Entry (Class UC) visas", visa["evidence"]["quote"])
        self.assertTrue(visa["evidence"]["rule"].startswith("austlii_catchwords_"))

        approvals = json.loads((self.root / "review/proposals.json").read_text(encoding="utf-8"))
        for row in approvals:
            row.update(reviewer="independent-test-review", review_note="Exact official case and catchwords checked")
        result = apply_approved(self.root, self.root / "catchwords-apply", approvals)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        self.assertEqual(result["verification"]["verified_cells_each_store"], 3)
        self.assertEqual(self.review("after-catchwords-apply")["missing_cells"], 0)

    def test_sponsorship_na_with_direct_visa_refusal_can_be_reviewed_and_applied(self):
        catchwords = (
            "MIGRATION - Employer Nomination (Permanent) (Class EN) visa - nomination decision"
        )
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            "URL: https://www.austlii.edu.au/au/cases/cth/FCA/2024/12.html\n"
            + "=" * 50 + "\n"
            + "Example v Minister [2024] FCA 12\n"
            + "CATCHWORDS: " + catchwords + "\n"
            + "JUDGE: SMITH J\nORDERS:\n1. The application is dismissed.\n"
            + "REASONS FOR JUDGMENT\n"
            + "The Employer Nomination (Permanent) (Class EN) visa was refused "
            + "because the nomination was not approved.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("ALTER TABLE cases ADD COLUMN catchwords TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE cases ADD COLUMN source TEXT NOT NULL DEFAULT ''")
            conn.execute(
                "UPDATE cases SET catchwords=?,source='AustLII' WHERE case_id='a'",
                (catchwords,),
            )
            conn.commit()
        self.rows[0]["catchwords"] = catchwords
        self.rows[0]["source"] = "AustLII"
        self.save_exports()

        prior = self.root / "prior-sponsorship-na.csv"
        with prior.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["case_id", "field", "fact_status", "reason_code", "reason", "source_sha256"],
            )
            writer.writeheader()
            writer.writerow({
                "case_id": "a",
                "field": "visa_type",
                "fact_status": "not_applicable",
                "reason_code": "sponsorship_or_nomination_not_a_personal_visa",
                "reason": "Earlier review classified this as employer nomination only.",
                "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            })

        self.review(prior_status=prior)
        proposal = next(
            row for row in json.loads((self.root / "review/proposals.json").read_text(encoding="utf-8"))
            if row["case_id"] == "a" and row["field"] == "visa_type"
        )
        self.assertEqual(proposal["fact_status"], "candidate_review")
        self.assertEqual(proposal["evidence"]["value"], "Employer Nomination (Permanent) (Class EN) visa")
        proposal.update(reviewer="independent-test-review", review_note="Direct visa refusal in judgment body")

        result = apply_approved(self.root, self.root / "sponsorship-visa-apply", [proposal])
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        self.assertEqual(result["verification"]["verified_cells_each_store"], 1)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(
                conn.execute("SELECT visa_type FROM cases WHERE case_id='a'").fetchone()[0],
                "Employer Nomination (Permanent) (Class EN) visa",
            )

    def test_sponsorship_nomination_without_personal_visa_decision_stays_blocked(self):
        catchwords = "MIGRATION - Employer Nomination Scheme - approval of employer nomination"
        quote = "Employer Nomination (Permanent) (Class EN) visa"
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            "URL: https://www.austlii.edu.au/au/cases/cth/FCA/2024/12.html\n"
            + "=" * 50 + "\n"
            + "Example v Minister [2024] FCA 12\n"
            + "CATCHWORDS: " + catchwords + "\n"
            + "REASONS FOR JUDGMENT\n"
            + "The employer's " + quote + " nomination was approved.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("ALTER TABLE cases ADD COLUMN catchwords TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE cases ADD COLUMN source TEXT NOT NULL DEFAULT ''")
            conn.execute(
                "UPDATE cases SET catchwords=?,source='AustLII' WHERE case_id='a'",
                (catchwords,),
            )
            conn.commit()
        self.rows[0]["catchwords"] = catchwords
        self.rows[0]["source"] = "AustLII"
        self.save_exports()

        prior = self.root / "prior-sponsorship-na-localized.csv"
        with prior.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["case_id", "field", "fact_status", "reason_code", "reason", "source_sha256"],
            )
            writer.writeheader()
            writer.writerow({
                "case_id": "a",
                "field": "visa_type",
                "fact_status": "not_applicable",
                "reason_code": REASONS["sponsorship_or_nomination_not_a_personal_visa"],
                "reason": REASONS["sponsorship_or_nomination_not_a_personal_visa"],
                "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            })

        self.review(prior_status=prior)
        visa = next(
            row for row in json.loads((self.root / "review/review.json").read_text(encoding="utf-8"))
            if row["case_id"] == "a" and row["field"] == "visa_type"
        )
        self.assertEqual(visa["fact_status"], "not_applicable")
        self.assertIsNone(visa["evidence"])
        self.assertEqual(
            visa["reason_code"],
            "sponsorship_or_nomination_not_a_personal_visa",
        )
        approval = {
            "case_id": "a",
            "field": "visa_type",
            "value": quote,
            "expected_current": "",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "method": "manual_source_bound_visa_review",
                "value": quote,
                "quote": "The employer's " + quote + " nomination was approved.",
            },
        }
        with self.assertRaisesRegex(ValueError, "not-applicable evidence"):
            validate_approvals(self.root, [approval])

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
            ("IMMIGRATION – Visas – skilled graduate\nvisa – appeal dismissed", "Skilled Graduate visa"),
            ("MIGRATION – Medical Treatment\nvisas – application dismissed", "Medical Treatment visa"),
            ("MIGRATION – Temporary Business Entry\n(Class UC) visas – application dismissed", "Temporary Business Entry (Class UC) visa"),
            ("MIGRATION – Safe Haven Enterprise\nvisas – costs", "Safe Haven Enterprise visa"),
            ("MIGRATION – Skilled\nMigrant visa – appeal dismissed", "Skilled Migrant visa"),
            ("MIGRATION – Bridging visa – application for interlocutory relief regarding detention", "Bridging visa"),
            ("Review of visa refusal - Subclass 428 - religious worker", "Subclass 428 visa"),
            ("Review of visa refusals - Subclass 151", "Subclass 151 visa"),
            ("Visa refusal - subclass 457 - Australian business", "Subclass 457 visa"),
            ("MIGRATION – Skilled (Provisional) (Class VC) visa – application out of time", "Skilled (Provisional) (Class VC) visa"),
            ("MIGRATION – Skilled (Residence) (Class VB) visa – no jurisdiction", "Skilled (Residence) (Class VB) visa"),
            ("MIGRATION – Student (Temporary) (Class TU) visa – summary dismissal", "Student (Temporary) (Class TU) visa"),
            ("MIGRATION – Partner (Temporary) (Class UK) visa – procedural fairness", "Partner (Temporary) (Class UK) visa"),
            ("MIGRATION – Medical Treatment (Visitor) (Class UB) visa – application dismissed", "Medical Treatment (Visitor) (Class UB) visa"),
            ("MIGRATION – Business Skills (Residence) (Class DF) visa – review dismissed", "Business Skills (Residence) (Class DF) visa"),
            ("MIGRATION – Business Skills (Residence) (Class VF) visa – no jurisdictional error", "Business Skills (Residence) (Class VF) visa"),
            ("MIGRATION – Temporary Business Entry (Class UC) visas – application dismissed", "Temporary Business Entry (Class UC) visa"),
            ("MIGRATION – Partner (Residence) (Class BS) visa – review out of time", "Partner (Residence) (Class BS) visa"),
            ("MIGRATION – Return (Residence) (Class BB) visa – no jurisdiction", "Return (Residence) (Class BB) visa"),
            ("MIGRATION – Employer Nomination (Residence) (Class BW) visa – application dismissed", "Employer Nomination (Residence) (Class BW) visa"),
            ("MIGRATION – Business Skills (Residence) Visa – ownership interest", "Business Skills (Residence) visa"),
            ("Migration – Business Skills (Provisional) visas – applicants outside the migration zone", "Business Skills (Provisional) visa"),
            ("MIGRATION – Temporary Business Entry visa – decision of the Tribunal", "Temporary Business Entry visa"),
            ("MIGRATION – Temporary Work (Skilled) visa – application withdrawn", "Temporary Work (Skilled) visa"),
            ("MIGRATION – Safe Haven Enterprise visas – costs", "Safe Haven Enterprise visa"),
            ("MIGRATION – Medical Treatment (Support Person) visa – extension application dismissed", "Medical Treatment (Support Person) visa"),
            ("MIGRATION – refusal of medical treatment visas – application dismissed", "Medical Treatment visa"),
            ("IMMIGRATION – Visas – skilled graduate visa – appeal dismissed", "Skilled Graduate visa"),
            ("MIGRATION – Skilled migrant visa – English language test", "Skilled Migrant visa"),
            ("MIGRATION – skilled independent visa – jurisdictional error", "Skilled Independent visa"),
            ("MIGRATION – judicial review – refusal of a skilled residence visa", "Skilled (Residence) visa"),
            ("MIGRATION – visa refusal – skilled-nominated visa", "Skilled Nominated visa"),
            ("MIGRATION – applicant's son applied offshore for a carer's visa – visa refused", "Carer visa"),
            ("Application for extension of time to appeal a decision regarding a protection visa", "Protection visa"),
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

    def test_austlii_catchwords_with_multiple_visa_classes_remain_unresolved(self):
        self.assertIsNone(_austlii_catchwords_visa_evidence({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "catchwords": (
                "MIGRATION – Prospective Marriage (Temporary) (Class TO) visa – "
                "Partner (Migrant) (Class BC) – Partner (Provisional) (Class UF) – decision remitted"
            ),
        }))
        self.assertIsNone(_austlii_catchwords_visa_evidence({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "catchwords": (
                "MIGRATION – refusal of employment visa – observations on adverse consequences "
                "of abuse of the class 457 visa program"
            ),
        }))
        self.assertIsNone(_austlii_catchwords_visa_evidence({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "catchwords": (
                "MIGRATION – Regional Employer Nomination (Permanent) (Class RN) visas – "
                "whether nomination for the position to which the visa application related was approved"
            ),
        }))
        self.assertIsNone(_austlii_catchwords_visa_evidence({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "catchwords": (
                "MIGRATION – Regional Employer Nomination (Permanent) (Class RN) visa – "
                "application for review of a judicial Registrar's decision to set aside an order as to costs refused"
            ),
        }))

    def test_austlii_protection_catchword_is_approved_against_source_and_stores(self):
        catchwords = "MIGRATION – Protection visa – appeal against refusal"
        self.source.write_text(
            HEAD + "CATCHWORDS: " + catchwords + "\n"
            + "JUDGE: SMITH J\nORDERS:\n1. The appeal is dismissed.\n"
            "REASONS FOR JUDGMENT\nThe published reasons identify this case.\n",
            encoding="utf-8",
        )
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

    def test_austlii_citizenship_heading_marks_visa_type_not_applicable(self):
        self.assertEqual(
            _austlii_catchwords_visa_not_applicable({
                "source": "AustLII",
                "url": self.rows[0]["url"],
                "title": "Applicant and Minister (Citizenship) [2024] AATA 1",
                "catchwords": "CITIZENSHIP – good character – decision affirmed",
            }),
            "citizenship_matter_not_a_visa_decision",
        )
        self.assertEqual(
            _austlii_catchwords_visa_not_applicable({
                "source": "AustLII",
                "url": self.rows[0]["url"],
                "title": "Applicant and Minister (Citizenship) [2024] AATA 1",
                "catchwords": "CITIZENSHIP – false documents in support of a past visa application",
            }),
            "citizenship_matter_not_a_visa_decision",
        )
        self.assertIsNone(_austlii_catchwords_visa_not_applicable({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "title": "Applicant and Minister (Citizenship) [2024] AATA 1",
            "catchwords": "CITIZENSHIP – review of visa cancellation – subclass 202",
        }))
        self.assertIsNone(_austlii_catchwords_visa_not_applicable({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "title": "Applicant and Minister (Migration) [2024] FCA 1",
            "catchwords": "CITIZENSHIP AND MIGRATION – visa review application",
        }))
        self.assertIsNone(_austlii_catchwords_visa_not_applicable({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "title": "A v B [2024] AATA 1",
            "catchwords": "CITIZENSHIP",
        }))

    def test_austlii_detention_catchword_marks_visa_type_not_applicable(self):
        self.assertEqual(
            _austlii_catchwords_visa_not_applicable({
                "source": "AustLII",
                "url": self.rows[0]["url"],
                "catchwords": "MIGRATION – application for release from immigration detention pending deportation",
            }),
            "detention_proceeding_not_a_visa_decision",
        )
        self.assertIsNone(_austlii_catchwords_visa_not_applicable({
            "source": "AustLII",
            "url": self.rows[0]["url"],
            "catchwords": "MIGRATION – detention – review of visa cancellation – subclass 202",
        }))
        for catchwords in (
            "MIGRATION – detention – Bridging visa – interlocutory relief",
            "MIGRATION – detention – visa grant disputed",
            "MIGRATION – removal – applicant's visa had been cancelled under s 501(3A)",
            "MIGRATION – detention – visa status disputed",
            "MIGRATION – deportation – subclass 866 application refused",
            "MIGRATION – detention – s 501(2) character decision",
        ):
            with self.subTest(catchwords=catchwords):
                self.assertIsNone(_austlii_catchwords_visa_not_applicable({
                    "source": "AustLII",
                    "url": self.rows[0]["url"],
                    "catchwords": catchwords,
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
                       "public_source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
                       "field_definition": "Select the judge(s) or tribunal member(s) who issued THIS current judgment. "
                                           "Prefer the current Judge/Judgment of/Member/Before header or current signature. "
                                           "Include the complete current panel if available. Exclude judges mentioned only "
                                           "in cited or earlier decisions, lawyers and headings. Select none if the "
                                           "candidates omit the supported answer or the evidence is insufficient."}}
            conn.execute("INSERT INTO judgments VALUES (?,?,?,?)", ("cached", json.dumps(payload),
                         json.dumps({"answers": {"select": {"choice": "Invented Judge", "confidence": 1}}}), "jev-test"))
            conn.commit()
        first_review = self.review(jev_cache=cache)
        self.assertEqual(first_review["review_workflow_version"], "jev-field-binding-v2")
        review = json.loads((self.root / "review/review.json").read_text(encoding="utf-8"))
        advice_by_field = {row["field"]: row["jev_cached_advice"] for row in review if row["case_id"] == "a"}
        self.assertEqual(len(advice_by_field["judges"]), 1)
        self.assertEqual(advice_by_field["visa_type"], [])
        self.assertEqual(advice_by_field["outcome"], [])
        proposals = json.loads((self.root / "review/proposals.json").read_text(encoding="utf-8"))
        self.assertEqual(next(x for x in proposals if x["field"] == "judges")["evidence"]["value"], "SMITH J")
        result = self.review("second")
        self.assertEqual(result["counts"]["field_bound_cache_fields"], 1)
        self.assertEqual(result["counts"]["unchanged_evidence_skipped"], 3)
        self.source.write_text(BODY + "source changed", encoding="utf-8")
        self.assertNotIn("field_bound_cache_fields", self.review("third")["counts"])

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
        result = self.review(jev_cache=cache)
        self.assertNotIn("field_bound_cache_fields", result["counts"])
        self.assertEqual(result["counts"]["jev_untyped_advice_field_associations_skipped"], 3)
        review = json.loads((self.root / "review/review.json").read_text(encoding="utf-8"))
        self.assertTrue(all(not row["jev_cached_advice"] for row in review))
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET url=? WHERE case_id='a'", (self.rows[0]["url"].replace('/12.html', '/13.html'),))
            conn.commit()
        self.assertNotIn("field_bound_cache_fields", self.review("changed_url")["counts"])

    def test_cached_advice_is_attached_only_to_the_field_it_classified(self):
        cache = self.root / "jev.sqlite3"
        definitions = {
            "judge": "Select the judge(s) or tribunal member(s) who issued THIS current judgment. "
                     "Prefer the current Judge/Judgment of/Member/Before header or current signature. "
                     "Include the complete current panel if available. Exclude judges mentioned only "
                     "in cited or earlier decisions, lawyers and headings. Select none if the candidates "
                     "omit the supported answer or the evidence is insufficient.",
            "outcome": "Select the complete operative result of THIS current judgment, preferably its "
                       "formal current DECISION/THE COURT ORDERS block. Exclude the earlier delegate/tribunal "
                       "result, cited cases, proposed orders and grounds. Current procedural judgments and "
                       "costs-only judgments have their own operative result: use that current result, not the "
                       "earlier merits result.",
        }
        source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        with closing(sqlite3.connect(cache)) as conn:
            conn.execute("CREATE TABLE judgments (request_hash TEXT,payload TEXT,response TEXT,model TEXT)")
            for request_hash, definition in definitions.items():
                payload = {"state": {"citation": self.rows[0]["citation"], "public_url": self.rows[0]["url"],
                                      "public_source_sha256": source_hash, "field_definition": definition}}
                conn.execute("INSERT INTO judgments VALUES (?,?,?,?)", (
                    request_hash, json.dumps(payload), json.dumps({"answers": {"select": {"choice": "none"}}}),
                    "jev-test",
                ))
            conn.commit()

        result = self.review(jev_cache=cache)
        review = json.loads((self.root / "review/review.json").read_text(encoding="utf-8"))
        advice_by_field = {row["field"]: row["jev_cached_advice"] for row in review if row["case_id"] == "a"}
        self.assertEqual([a["request_hash"] for a in advice_by_field["judges"]], ["judge"])
        self.assertEqual([a["request_hash"] for a in advice_by_field["outcome"]], ["outcome"])
        self.assertEqual(advice_by_field["visa_type"], [])
        self.assertEqual(result["counts"]["field_bound_cache_fields"], 2)
        self.assertEqual(result["counts"]["jev_other_field_advice_associations_skipped"], 4)

    def test_legacy_question_prompt_recovers_missing_field_definition(self):
        cache = self.root / "jev.sqlite3"
        source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        state = {"citation": self.rows[0]["citation"], "public_url": self.rows[0]["url"],
                 "public_source_sha256": source_hash}
        questions = {"select": {"instructions": "Who issued THIS judgment? Select the complete current "
                                                   "issuing judge/member or full panel from its current header "
                                                   "or certification/signature. Exclude cited judges, lawyers, "
                                                   "headings and partial panels. If the offered candidates omit "
                                                   "the complete answer, select none."}}
        with closing(sqlite3.connect(cache)) as conn:
            conn.execute("CREATE TABLE judgments (request_hash TEXT,payload TEXT,response TEXT,model TEXT)")
            conn.execute("INSERT INTO judgments VALUES (?,?,?,?)", (
                "legacy-judge", json.dumps({"state": state, "questions": questions}),
                json.dumps({"answers": {"select": {"choice": "none"}}}), "jev-test",
            ))
            conn.commit()

        result = self.review(jev_cache=cache)
        review = json.loads((self.root / "review/review.json").read_text(encoding="utf-8"))
        advice_by_field = {row["field"]: row["jev_cached_advice"] for row in review if row["case_id"] == "a"}
        self.assertEqual([a["request_hash"] for a in advice_by_field["judges"]], ["legacy-judge"])
        self.assertEqual(advice_by_field["visa_type"], [])
        self.assertEqual(advice_by_field["outcome"], [])
        self.assertEqual(result["counts"]["field_bound_cache_fields"], 1)
        self.assertEqual(result["counts"]["jev_other_field_advice_associations_skipped"], 2)

    def test_prior_not_applicable_is_preserved_on_matching_evidence(self):
        prior = self.root / "prior.csv"
        with prior.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["case_id", "field", "status", "reason", "source_sha256"])
            writer.writeheader()
            writer.writerow(dict(case_id="a", field="visa_type", status="不適用（前輪已確認）", reason="Confirmed citizenship review", source_sha256=hashlib.sha256(self.source.read_bytes()).hexdigest()))
        first = self.review(prior_status=prior)
        self.assertEqual(first["counts"]["not_applicable"], 1)
        self.assertEqual(first["reviewed_blank_cells"], 3)
        self.assertEqual(first["not_applicable_blank_cells"], 1)
        self.assertEqual(first["actionable_missing_cells"], 2)
        self.assertEqual(first["missing_cells"], 2)

        second = self.review("second")
        self.assertEqual(second["counts"]["not_applicable"], 1)
        self.assertEqual(second["reviewed_blank_cells"], 3)
        self.assertEqual(second["actionable_missing_cells"], 2)

    def test_apply_preserves_notes_rows_and_json_envelope(self):
        result = apply_approved(self.root, self.root / "apply", self.approvals())
        self.assertEqual(result["applied"], 3)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        self.assertEqual(self.review("after")["missing_cells"], 0)
        self.assertEqual(apply_approved(self.root, self.root / "noop", [])["applied"], 0)

    def _case_nature_approval(self):
        catchwords = "CITIZENSHIP – application for Australian citizenship by conferral – refusal on character grounds"
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            f"URL: {self.rows[0]['url']}\n"
            + "=" * 80 + "\n"
            + "CATCHWORDS: " + catchwords + "\n"
            + "LEGISLATION\nAustralian Citizenship Act 2007\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("ALTER TABLE cases ADD COLUMN case_nature TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE cases ADD COLUMN catchwords TEXT NOT NULL DEFAULT ''")
            conn.execute(
                "UPDATE cases SET case_nature='Other',catchwords=? WHERE case_id='a'",
                (catchwords,),
            )
            conn.execute("UPDATE cases SET case_nature='Other' WHERE case_id='b'")
            conn.commit()
        for row in self.rows:
            row["case_nature"] = "Other"
            row["catchwords"] = catchwords if row["case_id"] == "a" else ""
        self.save_exports()
        return {
            "case_id": "a",
            "field": "case_nature",
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "expected_current_by_store": {"database": "Other", "csv": "Other", "json": "Other"},
            "evidence": {
                "value": "Citizenship",
                "quote": catchwords,
                "method": "manual_source_bound_case_nature_review",
            },
            "reviewer": "independent-test-review",
            "review_note": "Official catchwords and source identity checked.",
        }

    def test_source_bound_case_nature_correction_updates_all_stores(self):
        result = apply_approved(
            self.root,
            self.root / "case-nature-apply",
            [self._case_nature_approval()],
        )
        self.assertEqual(result["applied"], 1)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        self.assertEqual(result["verification"]["verified_cells_each_store"], 1)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(conn.execute("SELECT case_nature FROM cases WHERE case_id='a'").fetchone()[0], "Citizenship")
        with (self.data / "immigration_cases.csv").open(encoding="utf-8-sig", newline="") as handle:
            self.assertEqual(next(csv.DictReader(handle))["case_nature"], "Citizenship")
        json_rows = json.loads((self.data / "immigration_cases.json").read_text(encoding="utf-8"))["cases"]
        self.assertEqual(json_rows[0]["case_nature"], "Citizenship")
        self.assertEqual(json_rows[1]["case_nature"], "Other")

    def test_source_bound_case_nature_rejects_nonliteral_or_wrong_classification(self):
        approval = self._case_nature_approval()
        approval["evidence"]["quote"] = "not present in source"
        with self.assertRaisesRegex(ValueError, "literal source quote"):
            validate_approvals(self.root, [approval])
        approval["evidence"]["quote"] = (
            "CITIZENSHIP – application for Australian citizenship by conferral – refusal on character grounds"
        )
        approval["evidence"]["value"] = "Protection visa"
        with self.assertRaisesRegex(ValueError, "source-bound classification"):
            validate_approvals(self.root, [approval])

    def test_source_bound_outcome_review_corrects_a_conflicting_label(self):
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            f"URL: {self.rows[0]['url']}\n"
            + "=" * 80 + "\n"
            "Example v Minister [2024] FCA 12\n"
            "DECISION RECORD\n"
            "TRIBUNAL MEMBER: Jane Smith\n"
            "DECISION: The Tribunal remits the application for reconsideration.\n"
            "STATEMENT OF DECISION AND REASONS\n"
            "The Tribunal considered the application.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.rows[0]["outcome"] = "Dismissed"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET outcome='Dismissed' WHERE case_id='a'")
            conn.commit()
        self.save_exports()

        proof = assess_case(
            source_text,
            citation=self.rows[0]["citation"],
            title=self.rows[0]["title"],
            url=self.rows[0]["url"],
        ).values["outcome"]
        approval = {
            "case_id": "a",
            "field": "outcome",
            "expected_current_by_store": {
                "database": "Dismissed",
                "csv": "Dismissed",
                "json": "Dismissed",
            },
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Remitted",
                "source_value": proof.value,
                "quote": proof.value,
                "method": "manual_source_bound_outcome_review",
            },
            "reviewer": "independent-test-review",
            "review_note": "The published decision line contradicts the stored outcome label.",
        }
        invalid = dict(approval, evidence=dict(approval["evidence"]))
        invalid["evidence"]["value"] = "Affirmed"
        with self.assertRaisesRegex(ValueError, "exact, matching operative decision"):
            validate_approvals(self.root, [invalid])

        result = apply_approved(self.root, self.root / "source-bound-outcome-apply", [approval])
        self.assertEqual(result["applied"], 1)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(conn.execute("SELECT outcome FROM cases WHERE case_id='a'").fetchone()[0], "Remitted")
        with (self.data / "immigration_cases.csv").open(encoding="utf-8-sig", newline="") as handle:
            self.assertEqual(next(row for row in csv.DictReader(handle) if row["case_id"] == "a")["outcome"], "Remitted")
        payload = json.loads((self.data / "immigration_cases.json").read_text(encoding="utf-8"))
        self.assertEqual(next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"], "Remitted")

    def test_manual_source_bound_visa_review_applies_only_literal_identified_evidence(self):
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            f"URL: {self.rows[0]['url']}\n"
            + "=" * 80 + "\n"
            "Citation:\n"
            "URL:\n"
            "The delegate's decision to refuse a Subclass 050 (Bridging E) visa was without effect.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.save_exports()
        quote = "a Subclass 050 (Bridging E) visa"
        approval = {
            "case_id": "a", "field": "visa_type",
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Subclass 050 (Bridging E) visa",
                "quote": quote,
                "method": "manual_source_bound_visa_review",
            },
            "reviewer": "independent-test-review",
            "review_note": "The exact source wording identifies the visa whose refusal is addressed.",
        }
        result = apply_approved(self.root, self.root / "manual-visa-apply", [approval])
        self.assertEqual(result["applied"], 1)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(conn.execute("SELECT visa_type FROM cases WHERE case_id='a'").fetchone()[0],
                             "Subclass 050 (Bridging E) visa")

    def test_manual_source_bound_visa_metadata_updates_all_stores(self):
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            f"URL: {self.rows[0]['url']}\n"
            + "=" * 80 + "\n"
            "Example v Minister [2024] FCA 12\n"
            "CATCHWORDS: MIGRATION - review of refusal of a Subclass 866 visa\n"
            "REASONS FOR JUDGMENT\n"
            "The Minister refused the applicant's Subclass 866 Protection visa.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.rows[0].update({
            "visa_subclass": "785.0",
            "visa_class_code": "TP",
            "visa_subclass_number": "785.0",
        })
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute(
                "UPDATE cases SET visa_subclass='785.0', visa_class_code='TP', "
                "visa_subclass_number='785.0' WHERE case_id='a'"
            )
            conn.commit()
        self.save_exports()
        proof = assess_case(
            source_text,
            citation="[2024] FCA 12",
            title=self.rows[0]["title"],
            url=self.rows[0]["url"],
        ).values["visa_type"]
        self.assertEqual(proof.value, "Subclass 866 visa")
        source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        values = {
            "visa_subclass": "866",
            "visa_class_code": "XA",
            "visa_subclass_number": "866",
        }
        old_values = {
            "visa_subclass": "785.0",
            "visa_class_code": "TP",
            "visa_subclass_number": "785.0",
        }
        approvals = [
            {
                "case_id": "a",
                "field": field,
                "source_path": "downloaded_cases/case.txt",
                "source_sha256": source_hash,
                "expected_current_by_store": {
                    "database": old_values[field],
                    "csv": old_values[field],
                    "json": old_values[field],
                },
                "evidence": {
                    "value": value,
                    "quote": "Subclass 866 Protection visa",
                    "current_visa_value": proof.value,
                    "method": "manual_source_bound_visa_metadata_review",
                },
                "reviewer": "independent-test-review",
                "review_note": "Current subclass is directly identified in the source; class code follows the subclass crosswalk.",
            }
            for field, value in values.items()
        ]

        result = apply_approved(self.root, self.root / "manual-visa-metadata", approvals)

        self.assertEqual(result["verification"]["verified_cells_each_store"], 3)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT visa_subclass, visa_class_code, visa_subclass_number "
                    "FROM cases WHERE case_id='a'"
                ).fetchone(),
                ("866", "XA", "866"),
            )

    def test_manual_source_bound_visa_review_normalizes_source_line_wrap(self):
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            f"URL: {self.rows[0]['url']}\n"
            + "=" * 80 + "\n"
            "The delegate's decision concerned the Special Category (Temporary) "
            "(Class TY, Subclass\n444) visa.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.save_exports()
        quote = "The delegate's decision concerned the Special Category (Temporary) (Class TY, Subclass\n444) visa."
        value = "Special Category (Temporary) (Class TY, Subclass 444) visa"
        approval = {
            "case_id": "a", "field": "visa_type",
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": value,
                "quote": quote,
                "method": "manual_source_bound_visa_review",
            },
            "reviewer": "independent-test-review",
            "review_note": "The exact source wording identifies the visa under review.",
        }
        result = apply_approved(self.root, self.root / "manual-visa-line-wrap", [approval])
        self.assertEqual(result["applied"], 1)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])

    def test_manual_source_bound_visa_review_accepts_exact_grounded_category_proof(self):
        cases = (
            (
                "The applicant applied for a temporary protection visa on 23 September 2015. "
                "The delegate made a decision refusing to grant the protection visa that he sought.",
                "Subclass 785 visa",
                "The source names the visa as a temporary protection visa; subclass follows the applicable statutory category.",
            ),
            (
                "The first applicant (applicant) applied for a SHEV, including his wife. "
                "The delegate refused to grant the applicants a SHEV.",
                "Subclass 790 visa",
                "The source identifies the applied-for and refused visa as a SHEV; subclass follows the applicable statutory category.",
            ),
        )
        for passage, expected, note in cases:
            with self.subTest(expected=expected):
                source_text = (
                    "Title: Example v Minister [2024] FCA 12\n"
                    "Citation: [2024] FCA 12\n"
                    f"URL: {self.rows[0]['url']}\n"
                    + "=" * 80 + "\n"
                    + "Example v Minister [2024] FCA 12\n"
                    + "CATCHWORDS: MIGRATION – review of visa refusal\n"
                    + "REASONS FOR JUDGMENT\n"
                    + passage
                )
                self.source.write_text(source_text, encoding="utf-8")
                self.save_exports()
                proof = assess_case(
                    source_text,
                    citation="[2024] FCA 12",
                    title=self.rows[0]["title"],
                    url=self.rows[0]["url"],
                ).values["visa_type"]
                self.assertEqual(proof.value, expected)
                self.assertNotIn(expected, " ".join(proof.quote.split()))
                approval = {
                    "case_id": "a",
                    "field": "visa_type",
                    "expected_current_by_store": {
                        "database": "",
                        "csv": "",
                        "json": "",
                    },
                    "source_path": "downloaded_cases/case.txt",
                    "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
                    "evidence": {
                        "value": proof.value,
                        "quote": proof.quote,
                        "method": "manual_source_bound_visa_review",
                    },
                    "reviewer": "independent-test-review",
                    "review_note": note,
                }
                validate_approvals(self.root, [approval])

    def test_manual_source_bound_visa_review_rejects_wrong_identity_or_unquoted_value(self):
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            f"URL: {self.rows[0]['url']}\n"
            + "=" * 80 + "\n"
            "The decision concerns a Subclass 050 (Bridging E) visa.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        approval = {
            "case_id": "a", "field": "visa_type",
            "source_path": "downloaded_cases/case.txt", "source_sha256": source_hash,
            "evidence": {
                "value": "Subclass 866 Protection visa",
                "quote": "a Subclass 050 (Bridging E) visa",
                "method": "manual_source_bound_visa_review",
            },
            "reviewer": "independent-test-review", "review_note": "Checked source wording.",
        }
        with self.assertRaisesRegex(ValueError, "exact source wording"):
            validate_approvals(self.root, [approval])
        approval["evidence"]["value"] = "Subclass 050 (Bridging E) visa"
        approval["source_sha256"] = source_hash
        self.rows[0]["url"] = "https://www.austlii.edu.au/au/cases/cth/FCA/2024/99.html"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET url=? WHERE case_id='a'", (self.rows[0]["url"],))
            conn.commit()
        self.save_exports()
        with self.assertRaisesRegex(ValueError, "matching source identity"):
            validate_approvals(self.root, [approval])

    def test_manual_official_source_judge_review_applies_cited_court_index_evidence(self):
        source_url = "https://search.judgments.fedcourt.gov.au/s/search.html?meta_MNC=%5B2024%5D+FCA+12"
        supporting_url = "https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2024/2024fca0012"
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            f"URL: {source_url}\n"
            f"Supporting URL: {supporting_url}\n"
            + "=" * 80 + "\n"
            "Federal Court of Australia judgment search result\n"
            "Judge Perram J (1)\n"
            "Example v Minister [2024] FCA 12\n"
            "1 January 2024 PERRAM J\n"
            "The Reasons for Judgment are not published.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.rows[0]["judges"] = "Not specified"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET judges='Not specified' WHERE case_id='a'")
            conn.commit()
        self.save_exports()
        approval = {
            "case_id": "a", "field": "judges",
            "expected_current": "Not specified",
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Perram J",
                "quote": "1 January 2024 PERRAM J",
                "method": "manual_official_source_judge_review",
                "source_url": source_url,
                "supporting_url": supporting_url,
            },
            "reviewer": "independent-test-review",
            "review_note": "The Federal Court index names Perram J; its linked official page confirms reasons are unpublished.",
        }
        result = apply_approved(self.root, self.root / "official-judge-apply", [approval])
        self.assertEqual(result["applied"], 1)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(conn.execute("SELECT judges FROM cases WHERE case_id='a'").fetchone()[0], "Perram J")

    def test_manual_official_source_judge_review_rejects_unofficial_source_or_unquoted_value(self):
        source_url = "https://www.fedcourt.gov.au/digital-law-library/judgments/search"
        supporting_url = "https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2024/2024fca0012"
        source_text = (
            "Title: Example v Minister [2024] FCA 12\n"
            "Citation: [2024] FCA 12\n"
            f"URL: {source_url}\n"
            f"Supporting URL: {supporting_url}\n"
            + "=" * 80 + "\n"
            "1 January 2024 PERRAM J\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        approval = {
            "case_id": "a", "field": "judges",
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Other J",
                "quote": "1 January 2024 PERRAM J",
                "method": "manual_official_source_judge_review",
                "source_url": source_url,
                "supporting_url": supporting_url,
            },
            "reviewer": "independent-test-review",
            "review_note": "Checked the source wording.",
        }
        with self.assertRaisesRegex(ValueError, "exact source wording"):
            validate_approvals(self.root, [approval])
        approval["evidence"]["value"] = "Perram J"
        approval["evidence"]["source_url"] = "https://example.com/search"
        with self.assertRaisesRegex(ValueError, "matching official source identity"):
            validate_approvals(self.root, [approval])

    def test_manual_official_docket_outcome_review_applies_exact_procedural_status(self):
        source_url = "https://www.comcourts.gov.au/file/FEDERAL/P/NSD270/2013/order_list"
        supporting_url = (
            "https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2013/2013fca0430"
        )
        file_number = "NSD270/2013"
        quote = (
            "23-May-2013 10:00 Administrative Listing Justice Perram "
            "Finalised - Discontinued/Withdrawn"
        )
        source_text = (
            "Title: Party name omitted [2013] FCA 430\n"
            "Citation: [2013] FCA 430\n"
            f"URL: {source_url}\n"
            f"Supporting URL: {supporting_url}\n"
            f"File number: {file_number}\n"
            + "=" * 80 + "\n"
            "Federal Law Search court event details\n"
            f"{quote}\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.rows[0].update(
            citation="[2013] FCA 430",
            title="Party name omitted [2013] FCA 430",
            url=source_url,
        )
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute(
                "UPDATE cases SET citation=?,title=?,url=? WHERE case_id='a'",
                (self.rows[0]["citation"], self.rows[0]["title"], self.rows[0]["url"]),
            )
            conn.commit()
        self.save_exports()
        approval = {
            "case_id": "a",
            "field": "outcome",
            "expected_current_by_store": {"database": "", "csv": "", "json": ""},
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Finalised - Discontinued/Withdrawn",
                "quote": quote,
                "method": "manual_official_docket_outcome_review",
                "source_url": source_url,
                "supporting_url": supporting_url,
                "file_number": file_number,
            },
            "reviewer": "independent-test-review",
            "review_note": (
                "The official docket gives this exact procedural status; it is not presented as a merits judgment."
            ),
        }

        result = apply_approved(self.root, self.root / "official-docket-outcome-apply", [approval])
        self.assertEqual(result["applied"], 1)
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        self.assertEqual(result["verification"]["verified_cells_each_store"], 1)
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(
                conn.execute("SELECT outcome FROM cases WHERE case_id='a'").fetchone()[0],
                "Finalised - Discontinued/Withdrawn",
            )
        with (self.data / "immigration_cases.csv").open(encoding="utf-8-sig", newline="") as handle:
            self.assertEqual(
                next(row for row in csv.DictReader(handle) if row["case_id"] == "a")["outcome"],
                "Finalised - Discontinued/Withdrawn",
            )
        payload = json.loads((self.data / "immigration_cases.json").read_text(encoding="utf-8"))
        self.assertEqual(
            next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"],
            "Finalised - Discontinued/Withdrawn",
        )

    def test_manual_official_docket_outcome_review_rejects_wrong_source_or_quote(self):
        source_url = "https://www.comcourts.gov.au/file/FEDERAL/P/NSD270/2013/order_list"
        supporting_url = (
            "https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2013/2013fca0430"
        )
        quote = "23-May-2013 10:00 Administrative Listing Justice Perram Finalised - Discontinued/Withdrawn"
        source_text = (
            "Title: Party name omitted [2013] FCA 430\n"
            "Citation: [2013] FCA 430\n"
            f"URL: {source_url}\n"
            f"Supporting URL: {supporting_url}\n"
            "File number: NSD270/2013\n"
            + "=" * 80 + "\n"
            f"{quote}\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.rows[0].update(
            citation="[2013] FCA 430",
            title="Party name omitted [2013] FCA 430",
            url=source_url,
        )
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute(
                "UPDATE cases SET citation=?,title=?,url=? WHERE case_id='a'",
                (self.rows[0]["citation"], self.rows[0]["title"], self.rows[0]["url"]),
            )
            conn.commit()
        self.save_exports()
        approval = {
            "case_id": "a",
            "field": "outcome",
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Finalised - Discontinued/Withdrawn",
                "quote": quote,
                "method": "manual_official_docket_outcome_review",
                "source_url": source_url,
                "supporting_url": supporting_url,
                "file_number": "NSD270/2013",
            },
            "reviewer": "independent-test-review",
            "review_note": "Checked the exact official docket entry.",
        }
        invalid = {**approval, "evidence": {**approval["evidence"], "source_url": "https://example.com/order_list"}}
        with self.assertRaisesRegex(ValueError, "matching official source identity"):
            validate_approvals(self.root, [invalid])
        invalid = {
            **approval,
            "evidence": {**approval["evidence"], "value": "Allowed"},
        }
        with self.assertRaisesRegex(ValueError, "exact source wording"):
            validate_approvals(self.root, [invalid])

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

    def test_remitted_order_summary_repairs_only_wrong_json_export(self):
        source_text = (
            "Example v Minister [2024] FCA 12\n"
            "DECISION: The Tribunal remits the application for reconsideration.\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.rows[0]["outcome"] = "Remitted"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET outcome='Remitted' WHERE case_id='a'")
            conn.commit()
        self.save_exports()

        json_path = self.data / "immigration_cases.json"
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        wrong_json_value = "DECISION:\\t5 April 2024"
        next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"] = wrong_json_value
        json_path.write_text(json.dumps(payload), encoding="utf-8")

        assessment = assess_case(source_text, citation=self.rows[0]["citation"],
                                 title=self.rows[0]["title"], url=self.rows[0]["url"])
        proof = assessment.values["outcome"]
        approval = {
            "case_id": "a", "field": "outcome",
            "expected_current_by_store": {
                "database": "Remitted", "csv": "Remitted", "json": wrong_json_value,
            },
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Remitted", "source_value": proof.value,
                "quote": "The Tribunal remits the application for reconsideration.",
                "method": "manual_operative_order_summary",
            },
            "reviewer": "manual-source-test",
            "review_note": "The verified operative decision remits the application; only the wrong JSON export is replaced.",
        }
        invalid = {**approval, "evidence": {**approval["evidence"], "quote": "The Tribunal dismisses the application."}}
        with self.assertRaisesRegex(ValueError, "Approval no longer matches grounded evidence"):
            validate_approvals(self.root, [invalid])

        result = apply_approved(self.root, self.root / "repair-remitted-json", [approval])
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            self.assertEqual(conn.execute("SELECT outcome FROM cases WHERE case_id='a'").fetchone()[0], "Remitted")
        with (self.data / "immigration_cases.csv").open(encoding="utf-8-sig", newline="") as handle:
            self.assertEqual(next(row for row in csv.DictReader(handle) if row["case_id"] == "a")["outcome"], "Remitted")
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        self.assertEqual(next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"], "Remitted")

    def test_affirmed_order_summary_restores_only_blank_json_export(self):
        source_text = (
            "Example v Minister [2024] FCA 12\n"
            "THE COURT ORDERS THAT:\n"
            "1. The decision under review be affirmed.\n"
            "REASONS FOR JUDGMENT\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        self.rows[0]["outcome"] = "Affirmed"
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET outcome='Affirmed' WHERE case_id='a'")
            conn.commit()
        self.save_exports()

        json_path = self.data / "immigration_cases.json"
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"] = ""
        json_path.write_text(json.dumps(payload), encoding="utf-8")
        assessment = assess_case(source_text, citation=self.rows[0]["citation"],
                                 title=self.rows[0]["title"], url=self.rows[0]["url"])
        proof = assessment.values["outcome"]
        approval = {
            "case_id": "a", "field": "outcome",
            "expected_current_by_store": {
                "database": "Affirmed", "csv": "Affirmed", "json": "",
            },
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "Affirmed", "source_value": proof.value,
                "quote": proof.quote,
                "method": "manual_operative_order_summary",
            },
            "reviewer": "manual-source-test",
            "review_note": "The exact operative order confirms the existing database and CSV result.",
        }
        result = apply_approved(self.root, self.root / "repair-affirmed-json", [approval])
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        self.assertEqual(next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"], "Affirmed")

    def test_exact_operative_order_text_restores_only_blank_json_export(self):
        source_text = (
            "Example v Minister [2024] FCA 12\n"
            "THE COURT ORDERS THAT:\n"
            "1. The application be dismissed.\n"
            "2. The applicant pay the respondent's costs.\n"
            "REASONS FOR JUDGMENT\n"
        )
        self.source.write_text(source_text, encoding="utf-8")
        assessment = assess_case(source_text, citation=self.rows[0]["citation"],
                                 title=self.rows[0]["title"], url=self.rows[0]["url"])
        proof = assessment.values["outcome"]
        self.rows[0]["outcome"] = proof.value
        with closing(sqlite3.connect(self.data / "cases.db")) as conn:
            conn.execute("UPDATE cases SET outcome=? WHERE case_id='a'", (proof.value,))
            conn.commit()
        self.save_exports()
        json_path = self.data / "immigration_cases.json"
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"] = ""
        json_path.write_text(json.dumps(payload), encoding="utf-8")
        approval = {
            "case_id": "a", "field": "outcome",
            "expected_current_by_store": {
                "database": proof.value, "csv": proof.value, "json": "",
            },
            "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "evidence": {
                "value": proof.value, "source_value": proof.value,
                "quote": proof.quote, "method": "manual_operative_order_summary",
            },
            "reviewer": "manual-source-test",
            "review_note": "The stored outcome is an exact extraction of the verified operative order.",
        }
        result = apply_approved(self.root, self.root / "repair-exact-order-json", [approval])
        self.assertTrue(result["verification"]["all_unapproved_data_preserved"])
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        self.assertEqual(next(row for row in payload["cases"] if row["case_id"] == "a")["outcome"], proof.value)

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
