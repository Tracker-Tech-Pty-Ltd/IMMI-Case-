"""Source-layout regressions for proceedings that do not decide a visa."""

from immi_case_downloader.extraction.grounded import assess_case


CASES = (
    (
        "[2000] FCA 485",
        """MIGRATION - MIGRATION ACT - Deportation of non-citizens who have committed serious crimes -
Migration Act 1958 (Cth), ss 200, 201, 253, 502
The applicant seeks judicial review of a decision made by the respondent to
deport the applicant pursuant to s 200 of the Migration Act 1958 (Cth).""",
        "deportation_order_review_not_a_visa_decision",
    ),
    (
        "[2003] FCA 1494",
        """PRACTICE & PROCEDURE - where application seeks damages said to be the
consequence of criminal conduct of Commonwealth employees - whether the
application should be struck out as abuse of process.""",
        "no_current_visa_decision",
    ),
    (
        "[2004] FCA 1267",
        """MIGRATION - unlawful non-citizen released from detention pursuant to a
court order - telephone number confidentially communicated to legal adviser.
LEGAL PROFESSIONAL PRIVILEGE - desire to avoid detention - whether the
communication attracts legal professional privilege.""",
        "no_current_visa_decision",
    ),
    (
        "[2008] FMCA 1524",
        """MIGRATION - Minister's exercise of powers to remove unlawful non-citizen -
consent application for indefinite adjournment while Minister considers grant
of visa - adjournment for only several months allowed.""",
        "no_current_visa_decision",
    ),
)


def test_current_case_summaries_mark_nonvisa_proceedings_not_applicable():
    for citation, summary, expected_reason in CASES:
        result = assess_case(
            f"{citation}\n{summary}\nREASONS FOR JUDGMENT\n"
            + "The Court considered the evidence and the parties' submissions. " * 16,
            citation=citation,
        )

        assert result.source_status == "checked", citation
        assert "visa_type" not in result.values, citation
        assert result.not_applicable.get("visa_type") == expected_reason, citation


def test_explicit_visa_cancellation_still_blocks_deportation_n_a_rule():
    citation = "[2024] FCA 12"
    text = """[2024] FCA 12
MIGRATION - visa cancellation - deportation order under s 200 of the Migration Act
The applicant seeks judicial review of a decision to deport the applicant.
REASONS FOR JUDGMENT
The application concerns visa cancellation. """ + (
        "The Court considered the evidence and the parties' submissions. " * 16
    )

    result = assess_case(text, citation=citation)

    assert "visa_type" not in result.not_applicable
