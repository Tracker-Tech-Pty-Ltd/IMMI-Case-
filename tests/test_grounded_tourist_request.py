from immi_case_downloader.extraction.grounded import Assessment, _visa, document_text


def extract(text):
    assessment = Assessment("[2001] FCA 918", "", "", source_status="checked")
    evidence = _visa(document_text(text), assessment)
    return evidence


def test_live_tourist_visa_request_linked_to_current_proceedings():
    text = """
    Citation: [2001] FCA 918
    The applicants wrote to the Minister:
    On receipt of your response to our request for 21 day tourist visas, and
    whether or not that response is positive, we promise to withdraw the
    current proceedings in the Federal Court and to abide by your decision.
    """

    evidence = extract(text)
    assert evidence is not None
    assert evidence.value == "Tourist visa"
    assert evidence.rule == "current_applicant_tourist_visa_request_in_proceedings"
    assert "request for 21 day tourist visas" in evidence.quote.casefold()


def test_historical_tourist_visa_mention_is_not_a_live_request():
    text = "Citation: [2001] FCA 918. The applicant previously held a tourist visa. The current proceedings concern detention."

    assert extract(text) is None


def test_unlinked_tourist_request_does_not_qualify():
    text = "Citation: [2001] FCA 918. The letter asks for 21 day tourist visas. The court proceedings continue."

    assert extract(text) is None
