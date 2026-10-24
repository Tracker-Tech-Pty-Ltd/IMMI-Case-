from immi_case_downloader.extraction.regex import _case_nature


def test_s200_deportation_order_review_gets_its_own_case_nature():
    source = """DECISION AND REASONS FOR DECISION
On 17 December 1999, a Deportation Order was made in respect of Mr Safwan.
Mr Safwan has applied to the Tribunal for a review of this
decision.
"""
    catchwords = "s 200 of the Migration Act 1958 should not be exercised to deport the Applicant."

    assert _case_nature(source, catchwords, "Safwan and Minister") == "Deportation review"


def test_background_deportation_mention_does_not_reclassify_a_visa_case():
    source = """The Tribunal reviews a decision to cancel the applicant's visa.
A historic Deportation Order is mentioned in the applicant's background.
"""
    catchwords = "Visa cancellation - review of a Student visa decision."

    assert _case_nature(source, catchwords, "Applicant v Minister") == "Student visa"
