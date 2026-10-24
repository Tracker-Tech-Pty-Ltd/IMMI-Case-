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


def test_current_s501_cancellation_selects_explicit_permanent_residence_visa():
    source = """Title: Rawsthorne v Minister [2012] AATA 484
Citation: [2012] AATA 484

CATCHWORDS
MIGRATION - visa cancellation - character test - decision under review affirmed

REASONS FOR DECISION
From November 1995, until the Delegate's 30 April 2012 cancellation decision that
is the subject of these review proceedings, Mr Rawsthorne held a visa entitling
him to reside permanently in Australia.
"""

    result = assess_case(source, citation="[2012] AATA 484")

    assert result.source_status == "checked"
    assert result.values["visa_type"].value == "Permanent visa"
    assert result.values["visa_type"].rule == "current_permanent_residence_cancellation"
    assert "that is the subject of these review proceedings" in " ".join(
        result.values["visa_type"].quote.split()
    )


def test_current_s501_cancellation_tolerates_replacement_characters_in_possessive():
    source = """Title: Rawsthorne v Minister [2012] AATA 484
Citation: [2012] AATA 484

CATCHWORDS
MIGRATION - visa cancellation - character test - decision under review affirmed

REASONS FOR DECISION
From November 1995, until the Delegate\uFFFD\uFFFD s 30 April 2012 cancellation decision
that is the subject of these review proceedings, Mr Rawsthorne held a visa entitling
him to reside permanently in Australia.
"""

    result = assess_case(source, citation="[2012] AATA 484")

    assert result.values["visa_type"].value == "Permanent visa"
    assert "\uFFFD\uFFFD" in result.values["visa_type"].quote


def test_historical_permanent_residency_does_not_identify_the_cancelled_visa():
    source = """Title: Rawsthorne v Minister [2012] AATA 484
Citation: [2012] AATA 484

CATCHWORDS
MIGRATION - visa cancellation - character test - decision under review affirmed

REASONS FOR DECISION
Mr Rawsthorne obtained permanent residency in 1995. The delegate cancelled a visa
in 2012, and the Tribunal reviewed that decision. The reasons do not identify the
visa that was cancelled.
"""

    result = assess_case(source, citation="[2012] AATA 484")

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


def test_current_class_bw_visa_beats_an_expired_student_visa_in_the_same_case():
    source = """Title: Example v Minister [2014] FCCA 946
Citation: [2014] FCCA 946

CATCHWORDS: MIGRATION - Application for review of decision of Migration Review Tribunal (MRT).

REASONS FOR JUDGMENT
The Department received an application from the applicant for an Employer Nomination
(Residence) (Class BW) visa. The Tribunal affirmed the delegate's decision not to grant
the applicant an Employer Nomination visa. The applicant previously held a Subclass 572
student visa, which had expired before this application.
"""

    result = assess_case(source, citation="[2014] FCCA 946")

    assert result.values["visa_type"].value == "Employer Nomination (Residence) (Class BW) visa"
    assert result.values["visa_type"].rule == "current_class_bw_application_under_review"


def test_current_student_refusal_clause_beats_an_older_student_subclass():
    source = """Title: Example v Minister [2017] FCCA 1983
Citation: [2017] FCCA 1983

CATCHWORDS: MIGRATION - Application seeking review of a former Tribunal decision.
Legislation: Migration Regulations 1994 (Cth), Schedule 2, cl.573.223

REASONS FOR JUDGMENT
The applicant previously held a TU 572 visa. The visa application was refused by a
delegate on 11 December 2014 because the applicant did not satisfy cl 573.223 of
Schedule 2. The delegate found that he was not a genuine student.
"""

    result = assess_case(source, citation="[2017] FCCA 1983")

    assert result.values["visa_type"].value == "Subclass 573 visa"
    assert result.values["visa_type"].rule == "current_student_application_refusal_clause"


def test_current_temporary_protection_application_beats_an_invited_shev_option():
    source = """Title: Example v Minister [2018] FCCA 2191
Citation: [2018] FCCA 2191

CATCHWORDS: MIGRATION - protection decision review.

REASONS FOR JUDGMENT
The Department invited the applicant to apply for a temporary protection visa or a
Safe Haven Enterprise (subclass 790) visa. The applicant applied for a temporary
protection visa. The delegate later made a decision refusing to grant the protection
visa that the applicant sought.
"""

    result = assess_case(source, citation="[2018] FCCA 2191")

    assert result.values["visa_type"].value == "Subclass 785 visa"
    assert result.values["visa_type"].rule == "current_temporary_protection_application_refusal"


def test_current_shev_application_beats_an_invited_temporary_protection_option():
    source = """Title: Example v Minister [2021] FCCA 1072
Citation: [2021] FCCA 1072

CATCHWORDS: MIGRATION - review of an Immigration Assessment Authority decision.

REASONS FOR JUDGMENT
The applicants were invited to apply for a temporary protection (subclass 785) visa
or a Safe Haven Enterprise Visa (SHEV). The first applicant (applicant) applied for a
SHEV. The delegate refused to grant the applicants a SHEV.
"""

    result = assess_case(source, citation="[2021] FCCA 1072")

    assert result.values["visa_type"].value == "Subclass 790 visa"
    assert result.values["visa_type"].rule == "current_shev_application_refusal"


def test_named_regional_visa_is_linked_to_the_decision_under_review():
    source = """Title: Birdi & Ors v Minister [2015] FCCA 1088
Citation: [2015] FCCA 1088

MIGRATION - Judicial review - visa cancellation

REASONS FOR JUDGMENT
I have before me an application for judicial review of a decision of the
Migration Review Tribunal which affirmed a decision of a Delegate of the
Minister to cancel the visa, being a Skilled-Independent Regional
(Provisional) visa (the visa) of the First Applicant.
"""

    result = assess_case(source, citation="[2015] FCCA 1088")

    assert result.source_status == "checked"
    assert result.values["visa_type"].value == "Skilled-Independent Regional (Provisional) visa"
    assert result.values["visa_type"].rule == "current_named_visa_cancellation_review"


def test_standard_temporary_class_visa_is_linked_to_cancellation_review():
    source = """Title: Palla v Minister [2005] FMCA 1850
Citation: [2005] FMCA 1850

MIGRATION - Application dismissed due to non-attendance regarding visa cancellation

REASONS FOR JUDGMENT
The applicant filed an application on 11 July 2005 seeking to review a
decision to cancel a standard Temporary Class (TC) visa under section 116 of
the Migration Act 1958 (Cth).
"""

    result = assess_case(source, citation="[2005] FMCA 1850")

    assert result.source_status == "checked"
    assert result.values["visa_type"].value == "Temporary Class (TC) visa"
    assert result.values["visa_type"].rule == "current_named_visa_cancellation_review"


def test_named_visa_in_history_without_current_cancellation_link_stays_blank():
    source = """Title: Example v Minister [2015] FCCA 1088
Citation: [2015] FCCA 1088

MIGRATION - Judicial review - procedural fairness

REASONS FOR JUDGMENT
The applicant previously held a Skilled-Independent Regional (Provisional)
visa. The current application concerns procedural fairness in the handling of
the hearing, not a decision to cancel a visa.
"""

    result = assess_case(source, citation="[2015] FCCA 1088")

    assert "visa_type" not in result.values
