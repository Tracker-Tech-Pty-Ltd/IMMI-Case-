from immi_case_downloader.extraction.grounded import assess_case


def test_class_numbered_visa_is_selected_for_its_cancellation_review():
    source = """Title: Example v Minister [2004] FCA 750
Citation: [2004] FCA 750

MIGRATION - judicial review - cancellation of visa

REASONS FOR JUDGMENT
1. The applicant was the holder of a Class 209 Resident T100 visa.
2. The Minister's decision to cancel his visa was made under s 501.
3. The applicant seeks judicial review of that cancellation decision.
"""

    result = assess_case(source, citation="[2004] FCA 750")

    assert result.source_status == "checked"
    assert result.values["visa_type"].value == "Class 209 Resident T100 visa"
    assert any(
        candidate.get("qualified")
        and "decision to cancel" in candidate.get("qualification_quote", "").lower()
        for candidate in result.candidates
    )


def test_class_numbered_historical_visa_stays_blank_in_deportation_case():
    source = """Title: Example v Minister [2003] FCA 792
Citation: [2003] FCA 792

MIGRATION - deportation order - interlocutory relief

REASONS FOR JUDGMENT
1. The applicant arrived as the holder of a Class 200 (Refugee) Visa.
2. The Minister made a deportation order under s 200.
3. This application concerns whether deportation should be delayed.
4. It does not seek review of a decision to cancel or refuse a visa.
5. The interim request is to pause removal while a separate appeal is prepared.
"""

    result = assess_case(source, citation="[2003] FCA 792")

    assert "visa_type" not in result.values


def test_resident_return_visa_is_selected_from_current_cancellation_catchwords():
    source = """Title: Nguyen v Minister [2022] AATA 114
Citation: [2022] AATA 114

CATCHWORDS
MIGRATION - Non-revocation of mandatory cancellation of a Five Year Resident Return visa
- decision under review set aside

DECISION RECORD
Decision: The Tribunal revokes the mandatory cancellation of the applicant's visa.
Reasons for decision
The applicant's visa was a subclass 155 visa.
"""

    result = assess_case(source, citation="[2022] AATA 114")

    assert result.source_status == "checked"
    assert result.values["visa_type"].value == "Five Year Resident Return visa"
    assert result.values["visa_type"].rule == "current_resident_return_visa_catchwords"


def test_historical_resident_return_visa_does_not_qualify_without_current_review_catchwords():
    source = """Title: Example v Minister [2022] FCA 114
Citation: [2022] FCA 114

CATCHWORDS
MIGRATION - judicial review - procedural fairness

REASONS FOR JUDGMENT
The applicant once held a Five Year Resident Return visa. This proceeding
concerns a different decision and does not review that visa or its cancellation.
The application raises a separate procedural issue about the materials before
the decision-maker. The Court addresses only the fairness of that process and
does not make an order concerning the applicant's former resident return visa.
"""

    result = assess_case(source, citation="[2022] FCA 114")

    assert "visa_type" not in result.values


def test_decision_record_prefers_current_partner_visa_over_prior_temporary_visa():
    source = """Title: Example and Minister [2016] AATA 4728
Citation: [2016] AATA 4728

DECISION RECORD
DIVISION: Migration and Refugee Division
DATE: 21 November 2016
PLACE OF DECISION:
Brisbane
DECISION:
The Tribunal affirms the decision not to grant the applicant a Partner (Residence) (Class BS) visa.
CATCHWORDS
MIGRATION - partner visa application - review of a decision not to grant a visa

REASONS FOR DECISION
The applicant previously applied for a Subclass 820 visa. The decision under
review concerns the later Partner (Residence) (Class BS) visa application.
"""

    result = assess_case(source, citation="[2016] AATA 4728")

    assert result.values["visa_type"].value == "Partner (Residence) (Class BS) visa"
    assert result.values["visa_type"].rule == "operative_decision_record_visa"


def test_safe_haven_enterprise_visa_selected_from_current_case_catchwords():
    source = """Title: Example v Minister [2022] FCA 268
Citation: [2022] FCA 268

CATCHWORDS: Migration appeal - application by a family of three for Safe Haven Enterprise visas -
where the Authority affirmed the delegate's decision to refuse to grant the visas.

REASONS FOR JUDGMENT
The case discusses the general legal definition of a protection visa.
"""

    result = assess_case(source, citation="[2022] FCA 268")

    assert result.values["visa_type"].value == "Safe Haven Enterprise visa"
    assert result.values["visa_type"].rule == "current_safe_haven_enterprise_visa_catchwords"


def test_historical_safe_haven_enterprise_reference_does_not_qualify():
    source = """Title: Example v Minister [2022] FCA 269
Citation: [2022] FCA 269

CATCHWORDS: Migration - judicial review of a decision about procedural fairness.

REASONS FOR JUDGMENT
The case refers to Safe Haven Enterprise visas when summarising an earlier authority.
The current proceeding concerns a separate protection decision and contains no
visa subclass, refusal, or cancellation for this applicant.
"""

    result = assess_case(source, citation="[2022] FCA 269")

    assert "visa_type" not in result.values
