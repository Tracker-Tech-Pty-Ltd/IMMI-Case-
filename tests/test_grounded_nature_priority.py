from immi_case_downloader.extraction.grounded import assess_case


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
