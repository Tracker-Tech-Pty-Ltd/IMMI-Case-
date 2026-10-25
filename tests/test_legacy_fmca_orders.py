from immi_case_downloader.extraction.grounded import assess_case
from immi_case_downloader.repair_workflow import _canonical_operative_outcome


def test_parenthesized_fmca_orders_without_spacing_are_grounded_as_dismissed():
    for citation, second_order in (
        ("[2005] FMCA 1883", "(2)Applicant to pay the respondent's costs assessed at $4,500."),
        ("[2005] FMCA 1916", "(2)Applicant to pay the respondent's costs of $4,250."),
    ):
        source = f"""{citation}
FEDERAL MAGISTRATES COURT OF AUSTRALIA
ORDERS
(1)Application dismissed pursuant to Part 13 Rule 13.03A(c).
{second_order}
REASONS FOR JUDGMENT
The dismissal was made because the applicant did not attend.
"""

        assessment = assess_case(source, citation=citation)

        assert assessment.source_status == "checked"
        proof = assessment.values["outcome"]
        assert proof.rule == "published_operative_table"
        assert "Application dismissed" in proof.quote
        assert "REASONS FOR JUDGMENT" not in proof.quote
        assert _canonical_operative_outcome("Dismissed", proof.quote) == "Dismissed"
