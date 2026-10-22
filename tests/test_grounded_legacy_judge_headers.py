"""Regression coverage for directly named members in older decision headers."""

import unittest

from immi_case_downloader.extraction.grounded import assess_case


class LegacyJudgeHeaderTests(unittest.TestCase):
    def test_split_tribunal_member_label(self):
        result = assess_case(
            """[2004] RRTA 36 (13 January 2004)
REFUGEE REVIEW TRIBUNAL
DECISION AND REASONS FOR DECISION
TRIBUNAL
Member: Luke Hardy
Date decision made: 13 January 2004
CATCHWORDS: Protection visa
""",
            citation="[2004] RRTA 36",
        )
        self.assertEqual(result.values["judges"].value, "Luke Hardy")

    def test_members_panel_keeps_each_named_member_and_stops_before_date(self):
        result = assess_case(
            """[2019] AATA 1413 (31 May 2019)
DECISION RECORD
DIVISION: Migration & Refugee Division
MEMBERS:
Deputy President Jan Redfern (Presiding)
Darren Renton, Member DATE: 31 May 2019
CATCHWORDS: Protection visa
""",
            citation="[2019] AATA 1413",
        )
        self.assertEqual(
            result.values["judges"].value,
            "Deputy President Jan Redfern (Presiding); Darren Renton, Member",
        )

    def test_named_tribunal_header_with_post_nominal(self):
        result = assess_case(
            """[2008] AATA 726
DECISION AND REASONS FOR DECISION
DECISION
Tribunal
Mr D Connolly AM
Date 20 August 2008
CATCHWORDS: Citizenship application
""",
            citation="[2008] AATA 726",
        )
        self.assertEqual(result.values["judges"].value, "Mr D Connolly AM")

    def test_reason_cover_member_role(self):
        result = assess_case(
            """[2009] AATA 693
REASONS FOR DECISION
26 August 2009
Mr P W Taylor SC, Senior Member
CATCHWORDS: Character test
""",
            citation="[2009] AATA 693",
        )
        self.assertEqual(result.values["judges"].value, "Mr P W Taylor SC, Senior Member")

    def test_discussion_of_a_member_is_not_a_signature(self):
        result = assess_case(
            """[2024] AATA 1
CATCHWORDS: Judicial review
REASONS FOR DECISION
Senior Member Smith was discussed at the hearing, but this extract does not name the decision-maker.
BACKGROUND
""",
            citation="[2024] AATA 1",
        )
        self.assertNotIn("judges", result.values)


if __name__ == "__main__":
    unittest.main()
