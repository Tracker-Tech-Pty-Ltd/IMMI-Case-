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
