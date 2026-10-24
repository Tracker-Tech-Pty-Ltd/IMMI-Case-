from immi_case_downloader.extraction.regex import extract_regex


def test_extract_regex_from_loaded_text():
    text = """
    APPLICANT:

    Jane Citizen
    CASE NUMBER: 123

    The applicant is a citizen of India and applied for a Subclass 500 visa.
    The matter was heard on 12 March 2024.
    The applicant was represented by Ms Counsel.
    CATCHWORDS: MIGRATION - student visa - genuine temporary entrant
    """

    fields = extract_regex(text, {"title": "Jane Citizen v Minister [2024] AATA 1"})

    assert fields["applicant_name"]["value"] == "Jane Citizen"
    assert fields["country_of_origin"]["value"] == "India"
    assert fields["visa_subclass_number"]["value"] == "500"
    assert fields["hearing_date"]["value"] == "12 March 2024"
    assert fields["is_represented"]["value"] == "Yes"
    assert fields["case_nature"]["value"] == "Student visa"


def test_partner_class_catchwords_override_background_protection_visa():
    catchwords = "MIGRATION – Partner (Temporary) (Class UK) visa – Subclass 820"
    text = (
        f"CATCHWORDS: {catchwords}\n"
        "LEGISLATION\nMigration Regulations 1994\n"
        "The sponsor previously held a protection visa."
    )

    fields = extract_regex(text, {"catchwords": catchwords})

    assert fields["case_nature"]["value"] == "Partner visa"


def test_prospective_marriage_subclass_300_is_partner_visa_nature():
    catchwords = "Review of visa refusal - Subclass 300 - prospective marriage"
    text = f"CATCHWORDS: {catchwords}\nREVIEW APPLICANT: Jane Doe\n"

    fields = extract_regex(text, {"catchwords": catchwords})

    assert fields["case_nature"]["value"] == "Partner visa"


def test_partner_visa_program_mentioned_in_nomination_reasons_is_not_case_nature():
    catchwords = "MIGRATION – nomination – Direct Entry nomination stream – Fleet Manager"
    text = (
        f"CATCHWORDS: {catchwords}\n"
        "LEGISLATION\nMigration Regulations 1994\n"
        "A representative mentioned the Partner visa program in another context."
    )

    fields = extract_regex(text, {"catchwords": catchwords})

    assert fields["case_nature"]["value"] == "Skilled migration"


def test_direct_entry_nomination_catchwords_override_refugee_division_label():
    catchwords = "MIGRATION - nomination - Direct Entry nomination stream - Fleet Manager"
    text = (
        f"CATCHWORDS: {catchwords}\n"
        "DECISION RECORD\n"
        "DIVISION: Migration & Refugee Division\n"
    )

    fields = extract_regex(text, {"catchwords": catchwords})

    assert fields["case_nature"]["value"] == "Skilled migration"


def test_refugee_division_name_alone_is_not_protection_visa_case_nature():
    catchwords = "MIGRATION - employer nomination - subclass 186"
    text = (
        f"CATCHWORDS: {catchwords}\n"
        "DECISION RECORD\n"
        "DIVISION: Migration & Refugee Division\n"
    )

    fields = extract_regex(text, {"catchwords": catchwords})

    assert fields["case_nature"]["value"] is None


def test_protection_visa_catchwords_set_protection_case_nature():
    catchwords = "MIGRATION - refusal of Protection visa - Subclass 866"
    text = f"CATCHWORDS: {catchwords}\nREASONS FOR DECISION\n"

    fields = extract_regex(text, {"catchwords": catchwords})

    assert fields["case_nature"]["value"] == "Protection visa"


def test_explicit_citizenship_catchwords_override_incidental_visa_terms():
    text = """
    CATCHWORDS
    CITIZENSHIP – application for citizenship by conferral – refusal of application
    LEGislation
    Australian Citizenship Act 2007 (Cth)

    The applicant previously held a protection visa.
    """

    fields = extract_regex(text, {"catchwords": "CITIZENSHIP – application for citizenship by conferral"})

    assert fields["case_nature"]["value"] == "Citizenship"


def test_citizenship_and_migration_heading_does_not_override_migration_subject():
    text = """
    CATCHWORDS
    CITIZENSHIP AND MIGRATION – Migration – protection visa review
    LEGISLATION
    Migration Act 1958 (Cth)
    """

    fields = extract_regex(
        text,
        {
            "title": "Applicant v Minister (Citizenship) [2024] FCA 1",
            "catchwords": "CITIZENSHIP AND MIGRATION – Migration – protection visa review",
        },
    )

    assert fields["case_nature"]["value"] == "Protection visa"


def test_full_source_migration_heading_overrules_shortened_citizenship_metadata():
    text = """
    CATCHWORDS
    CITIZENSHIP AND MIGRATION – Migration – protection visa review
    LEGISLATION
    Migration Act 1958 (Cth)
    """

    fields = extract_regex(
        text,
        {
            "title": "Applicant v Minister (Citizenship) [2024] FCA 2",
            "catchwords": "CITIZENSHIP – migration review",
        },
    )

    assert fields["case_nature"]["value"] == "Protection visa"


def test_bare_citizenship_tag_in_party_name_is_not_a_subject():
    text = """
    CATCHWORDS
    Immigration – Refugees – ministerial intervention request
    LEGISLATION
    Migration Act 1958 (Cth)
    """

    fields = extract_regex(
        text,
        {
            "title": "Applicant v Minister for Immigration, Citizenship and Multicultural Affairs",
            "catchwords": "CITIZENSHIP",
        },
    )

    assert fields["case_nature"]["value"] == "Protection visa"


def test_citizenship_title_tag_resolves_bare_catchword_even_with_student_visa_text():
    text = """
    CATCHWORDS
    CITIZENSHIP
    – Application for citizenship by descent
    LEGISLATION
    Australian Citizenship Act 2007 (Cth)

    The applicant previously held a student visa.
    """

    fields = extract_regex(
        text,
        {
            "title": "Applicant and Minister for Home Affairs (Citizenship) [2024] AATA 1",
            "catchwords": "CITIZENSHIP",
        },
    )

    assert fields["case_nature"]["value"] == "Citizenship"


def test_inline_catchwords_dash_identifies_citizenship_subject():
    text = """
    CATCHWORDS – CITIZENSHIP – criminal record – good character for conferral
    Migration Act s 501 is mentioned as background only.
    """

    fields = extract_regex(text, {"catchwords": ""})

    assert fields["case_nature"]["value"] == "Citizenship"


def test_split_legacy_citizenship_heading_identifies_citizenship_subject():
    text = """
    DECISION
    Tribunal Mr John Handley, Senior Member
    CITIZENSHIP
    Australia – application for citizenship by conferral – residence requirement
    """

    fields = extract_regex(
        text,
        {"catchwords": "", "title": "Minhas and Minister [2011] AATA 388"},
    )

    assert fields["case_nature"]["value"] == "Citizenship"


def test_citizenship_heading_does_not_hide_a_current_visa_cancellation():
    text = "CATCHWORDS – CITIZENSHIP – review of visa cancellation – subclass 866"

    fields = extract_regex(text, {"catchwords": ""})

    assert fields["case_nature"]["value"] != "Citizenship"


def test_legacy_member_catchwords_with_mojibake_dash_identify_citizenship():
    for text in (
        "Senior Member CITIZENSHIP \ufffdC application by spouse of an Australian citizen",
        "Senior Member CATCHWORDS \ufffdC CITIZENSHIP \ufffdC cancellation of citizenship approval",
        "CATCHWORDS\n\ufffdC CITIZENSHIP\n\n\ufffdC whether applicant of good character",
    ):
        fields = extract_regex(text, {"catchwords": ""})
        assert fields["case_nature"]["value"] == "Citizenship"


def test_citizenship_mentions_in_visa_and_registration_cases_do_not_change_subject():
    for text in (
        "CATCHWORDS: MIGRATION – cancellation – Return Residence visa – potential dual citizenship",
        "CATCHWORDS: MIGRATION – Training Subclass 407 visa – decision of delegate of Minister for Immigration and Citizenship",
        "CATCHWORDS: IMMIGRATION & CITIZENSHIP – application for visa refused – Partner visa",
        "CATCHWORDS: IMMIGRATION AND CITIZENSHIP – application for registration as a migration agent",
    ):
        fields = extract_regex(text, {"catchwords": ""})
        assert fields["case_nature"]["value"] != "Citizenship"


def test_judicial_review_of_citizenship_application_is_citizenship():
    text = "CATCHWORDS: MIGRATION – Judicial review of citizenship application – construction of Citizenship Act"

    fields = extract_regex(text, {"catchwords": ""})

    assert fields["case_nature"]["value"] == "Citizenship"


def test_department_and_citizenship_status_mentions_do_not_change_migration_subject():
    for text in (
        "CATCHWORDS: MIGRATION – review of Refugee Review Tribunal decision – "
        "whether applicant was notified by the Department of Immigration and Citizenship",
        "CATCHWORDS: MIGRATION – detention – visa cancellation – "
        "applicant claims to be an Australian citizen – habeas corpus",
        "CATCHWORDS: MIGRATION – detention – visa cancellation – "
        "applicant claims to be an Australian citizen – habeas corpus – "
        "CITIZENSHIP – whether applicant is an Australian citizen",
    ):
        fields = extract_regex(text, {"catchwords": ""})
        assert fields["case_nature"]["value"] != "Citizenship"


def test_minister_portfolio_names_do_not_change_migration_subject():
    cases = (
        (
            "CATCHWORDS: MIGRATION – application for protection visa – "
            "where application refused by delegate of Minister of Immigration and Citizenship",
            "Protection visa",
        ),
        (
            "CATCHWORDS: MIGRATION – review of a decision of the Assistant Minister for "
            "Citizenship and Multicultural Affairs under s 501A(3)(b) of the Migration Act",
            None,
        ),
        (
            "CATCHWORDS: IMMIGRATION – application for review of decision by Minister of "
            "Immigration and Citizenship refusing to grant partner-provisional and "
            "partner-migrant visa",
            None,
        ),
    )
    for text, expected in cases:
        fields = extract_regex(text, {"catchwords": ""})
        actual = fields["case_nature"]["value"]
        if expected:
            assert actual == expected
        else:
            assert actual != "Citizenship"


def test_mixed_citizenship_and_visa_cancellation_heading_is_not_pure_citizenship():
    text = (
        "CATCHWORDS: MIGRATION – revocation of citizenship – review by the Tribunal "
        "of the decision to revoke citizenship – whether discretion should be exercised – "
        "applicant deemed to have been granted an ex-citizen visa – cancellation of visa "
        "on character grounds – application to delegate for revocation of visa cancellation – "
        "application to the Tribunal for review of the delegate's decision"
    )

    fields = extract_regex(text, {"catchwords": ""})

    assert fields["case_nature"]["value"] != "Citizenship"


def test_historical_visa_cancellation_does_not_hide_citizenship_subject():
    text = (
        "CATCHWORDS: CITIZENSHIP – application for citizenship by conferral – "
        "good character – previous visa cancellation occurred before the citizenship application"
    )

    fields = extract_regex(text, {"catchwords": ""})

    assert fields["case_nature"]["value"] == "Citizenship"
