from immi_case_downloader.extraction.grounded import assess_case, document_text
from immi_case_downloader.extraction.regex import _case_nature


def test_citizenship_review_overrides_incidental_cancelled_visa_history():
    source = """LNRD & RFKS and Minister for Home Affairs (Citizenship) [2019] AATA 4247
[2019] AATA 4247
DECISION
The reviewable decision of the Minister's delegate dated 29 November 2018 to refuse to grant the first applicant, LNRD, Australian citizenship by conferral is affirmed.
CATCHWORDS
CITIZENSHIP - application for citizenship by conferral - where visa was cancelled under s 140 of the Migration Act due to the applicant being part of a family unit
REASONS FOR DECISION
The applicant seeks review of the delegate's refusal of citizenship.
"""

    result = assess_case(
        source,
        citation="[2019] AATA 4247",
        title="LNRD & RFKS and Minister for Home Affairs (Citizenship)",
    )

    assert "visa_type" not in result.values
    assert result.not_applicable["visa_type"] == "citizenship_review_not_a_visa_application"


def test_visa_card_scheme_case_is_not_classified_as_an_immigration_visa():
    source = """Visa International Service Association v Reserve Bank of Australia [2003] FCA 977
[2003] FCA 977
ADMINISTRATIVE LAW - judicial review - credit card schemes - payment systems
The application concerns regulation of credit card payment systems and interchange fees.
"""

    result = assess_case(
        source,
        citation="[2003] FCA 977",
        title="Visa International Service Association v Reserve Bank of Australia",
    )

    assert "visa_type" not in result.values
    assert result.not_applicable["visa_type"] == "payment_card_litigation_not_immigration"


def test_explicit_no_visa_applicant_header_marks_visa_field_not_applicable():
    source = """Global IT Australia [2003] MRTA 4058
[2003] MRTA 4058
CATCHWORDS: Eligibility - ineligible for review - failure to lodge review application
REVIEW APPLICANT: Global IT Australia
VISA APPLICANT (S): N/A
TRIBUNAL: Migration Review Tribunal
PRESIDING MEMBER: Maritsa Eftimiou
DECISION: The application for review of the Standard Business Sponsorship refusal was ineligible because it was not lodged within the prescribed period for applying for review under the Migration Act 1958.
"""

    result = assess_case(
        source,
        citation="[2003] MRTA 4058",
        title="Global IT Australia",
    )

    assert "visa_type" not in result.values
    assert result.not_applicable["visa_type"] == "sponsorship_review_has_no_personal_visa_applicant"


def test_deportation_order_review_is_not_a_personal_visa_decision():
    source = """Gupta and Minister for Immigration [2003] AATA 1298
[2003] AATA 1298
CATCHWORDS
Immigration - Deportation order - s 200 of the Migration Act 1958 should not be exercised to deport the Applicant.
REASONS FOR DECISION
On 17 December 1999, a Deportation Order was made in respect of the Applicant.
The Applicant lodged an application for a review of this decision by the Tribunal.
The decision under review was whether the Applicant should be deported.
"""

    result = assess_case(
        source,
        citation="[2003] AATA 1298",
        title="Gupta and Minister for Immigration",
    )

    assert "visa_type" not in result.values
    assert result.not_applicable["visa_type"] == "deportation_order_review_not_a_visa_decision"


def test_deportation_rule_does_not_override_current_visa_cancellation_review():
    source = """Applicant v Minister for Immigration [2003] AATA 1298
[2003] AATA 1298
CATCHWORDS
Visa cancellation - deportation order - s 200 of the Migration Act 1958.
REASONS FOR DECISION
The decision under review is the delegate's decision to cancel the Applicant's visa.
The Applicant applied to the Tribunal for review of this decision.
"""

    result = assess_case(
        source,
        citation="[2003] AATA 1298",
        title="Applicant v Minister for Immigration",
    )

    assert result.not_applicable.get("visa_type") != "deportation_order_review_not_a_visa_decision"


def test_student_guardian_visa_in_published_decision_is_student_visa_nature():
    source = """Title: 1416648 [2014] MRTA 2701 (10 November 2014)
Citation: [2014] MRTA 2701
URL: https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/MRTA/2014/2701.html
DECISION RECORD
DECISION: The Tribunal remits the application for a Student (Temporary) visa with direction that the applicant meets a criterion for a Subclass 580 Student Guardian visa.
STATEMENT OF DECISION AND REASONS
The matter is remitted for reconsideration.
"""

    assert _case_nature(source, "", "1416648 [2014] MRTA 2701") == "Student visa"


def test_student_guardian_visa_mentioned_only_in_reasons_does_not_set_case_nature():
    source = """Title: Example [2014] MRTA 2701
Citation: [2014] MRTA 2701
URL: https://example.test/case
STATEMENT OF DECISION AND REASONS
The applicant referred to another matter involving a Student Guardian visa.
"""

    assert _case_nature(source, "", "Example [2014] MRTA 2701") == ""


def test_short_eligibility_notice_keeps_its_explicit_member_and_result():
    source = """Mehajer, Mohamad [2003] MRTA 5747
[2003] MRTA 5747
ADVICE OF ELIGIBILITY DECISION
CATCHWORDS: Eligibility - ineligible for review - review applicant does not have standing
VISA APPLICANT (S): Yemen Mehajar
MEMBER: Linda Pearson
The review applicant is not a person with standing to apply for review of the Department's decision.
"""

    assert len(document_text(source)) < 350
    result = assess_case(
        source,
        citation="[2003] MRTA 5747",
        title="Mehajer, Mohamad",
    )

    assert result.source_status == "checked"
    assert result.values["judges"].value == "Linda Pearson"
    assert result.values["outcome"].value == "Ineligible for review"
    assert "ineligible for review" in result.values["outcome"].quote.lower()
    assert result.reasons["visa_type"] == "current_visa_not_stated"


def test_split_aata_cover_member_and_no_deportation_result_are_grounded():
    source = """Safwan and Minister [2003] AATA 1298
[2003] AATA 1298
DECISION AND REASONS FOR DECISION
ADMINISTRATIVE APPEALS TRIBUNAL
GENERAL ADMINISTRATIVE DIVISION
DECISION
Tribunal
Date
18 December 2003
Place
Sydney
Decision
s 200 of the Migration Act 1958 to deport the Applicant.
RP
Handley
CATCHWORDS
s 200 of the Migration Act 1958 should not be exercised to deport the Applicant.
Migration Act 1958 ss 200, 201
REASONS FOR DECISION
The other relevant considerations favour his not being deported.
"""

    result = assess_case(
        source,
        citation="[2003] AATA 1298",
        title="Safwan and Minister",
    )

    assert result.values["judges"].value == "RP Handley"
    assert "RP\nHandley" in result.values["judges"].quote
    assert result.values["outcome"].value == "The Applicant should not be deported"
    assert "should not be exercised to deport the Applicant" in result.values["outcome"].quote


def test_aata_no_deportation_catchwords_need_matching_conclusion():
    source = """[2003] AATA 1298
CATCHWORDS
s 200 of the Migration Act 1958 should not be exercised to deport the Applicant.
REASONS FOR DECISION
The Tribunal concludes that the Applicant should be deported.
"""

    result = assess_case(
        source,
        citation="[2003] AATA 1298",
        title="Applicant v Minister",
    )

    assert "outcome" not in result.values


def test_complete_aata_operative_order_precedes_catchword_summary():
    source = """Safwan and Minister [2003] AATA 1298
[2003] AATA 1298
ADMINISTRATIVE APPEALS TRIBUNAL
DECISION
Tribunal
Mr
RP Handley, Deputy President
Date
18 December 2003
Place
Sydney
Decision
The
Tribunal sets aside the decision under review and substitutes a decision not to
exercise the power in s 200 of the Migration Act 1958 to deport the Applicant.
...............................................
RP Handley Deputy President
CATCHWORDS
s 200 of the Migration Act 1958 should not be exercised to deport the Applicant.
REASONS FOR DECISION
The other relevant considerations favour his not being deported.
"""

    result = assess_case(
        source,
        citation="[2003] AATA 1298",
        title="Safwan and Minister",
    )

    assert result.values["judges"].value == "Mr RP Handley, Deputy President"
    assert result.values["outcome"].rule == "published_operative_table"
    assert result.values["outcome"].value.startswith(
        "The Tribunal sets aside the decision under review"
    )
    assert "s 200 of the Migration Act 1958 to deport the Applicant" in result.values["outcome"].value
    assert result.values["outcome"].value.endswith("the Applicant.")
    assert "Handley" not in result.values["outcome"].value
