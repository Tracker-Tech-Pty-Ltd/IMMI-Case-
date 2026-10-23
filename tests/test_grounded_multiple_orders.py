from immi_case_downloader.extraction.grounded import _outcome


def test_multiple_formal_orders_keep_each_applicant_and_outcome_together():
    source = """Citation: [2001] FCA 918
IN THE FEDERAL COURT OF AUSTRALIA
N 1062 of 2001
BETWEEN: OLEG CUJBA
APPLICANT
THE COURT ORDERS THAT:
1 The application for interlocutory relief be dismissed.
2 There be liberty to apply on 24 hours' notice.
3 Costs be reserved.
4 The proceeding stand over for directions to 17 July 2001 at 9.30 am.
IN THE FEDERAL COURT OF AUSTRALIA
N 1063 of 2001
BETWEEN: NICOLAE CUJBA
APPLICANT
THE COURT ORDERS THAT:
1 The Respondent be restrained from removing the Applicant from Australia until further order.
2 There be liberty to apply on 24 hours' notice.
3 Costs be reserved.
4 The proceeding stand over for directions to 17 July 2001 at 9.30 am.
Note: Settlement and entry of orders is dealt with in Order 36 of the Federal Court Rules.
IN THE FEDERAL COURT OF AUSTRALIA
REASONS FOR JUDGMENT
"""

    result = _outcome(source)

    assert result is not None
    assert result.rule == "published_multiple_operative_tables"
    assert "OLEG CUJBA: 1 The application for interlocutory relief be dismissed." in result.value
    assert "NICOLAE CUJBA: 1 The Respondent be restrained from removing the Applicant" in result.value
    assert "THE COURT ORDERS THAT:" in result.quote
    assert "N 1063 of 2001" in result.quote
    assert "Note: Settlement" not in result.quote
    assert "IN THE FEDERAL COURT OF AUSTRALIA" not in result.value


def test_single_operative_table_keeps_existing_outcome_extraction():
    result = _outcome("""IN THE FEDERAL COURT OF AUSTRALIA
THE COURT ORDERS THAT:
1 The application be dismissed.
REASONS FOR JUDGMENT
""")

    assert result is not None
    assert result.rule == "published_operative_table"
    assert result.value == "1 The application be dismissed."
