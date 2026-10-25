from immi_case_downloader.extraction.grounded import _outcome
from immi_case_downloader.repair_workflow import _canonical_operative_outcome


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


def test_federal_circuit_caption_ends_order_before_reasons():
    source = """ORDERS
(1) The proceeding be discontinued.
(2) The applicant pay the respondent's costs.
FEDERAL CIRCUIT COURT OF AUSTRALIA
AT BRISBANE
BRG 1090 of 2019
Second Respondent REASONS FOR JUDGMENT
Although the proceeding should be discontinued, it is appropriate to dismiss it.
"""

    result = _outcome(source)

    assert result is not None
    assert result.value == "(1) The proceeding be discontinued. (2) The applicant pay the respondent's costs."
    assert "dismiss" not in result.value.casefold()
    assert "REASONS FOR JUDGMENT" not in result.quote
    assert _canonical_operative_outcome("Withdrawn", result.quote) == "Withdrawn"
    assert _canonical_operative_outcome("Dismissed", result.quote) is None


def test_inline_reasons_heading_ends_operative_order():
    source = """ORDERS
(1) The proceeding be discontinued.
(2) The applicant pay the respondent's costs.
Second Respondent REASONS FOR JUDGMENT
It is appropriate to dismiss the proceeding rather than discontinue it.
"""

    result = _outcome(source)

    assert result is not None
    assert result.value == "(1) The proceeding be discontinued. (2) The applicant pay the respondent's costs."
    assert "dismiss" not in result.value.casefold()
    assert "dismiss" not in result.quote.casefold()


def test_wrapped_catchword_decision_is_not_mistaken_for_operative_result():
    source = """[2002] MRTA 4627
CATCHWORDS: Review of visa refusal - Bridging E visa - security
decision
- refusal affirmed
REVIEW APPLICANT: XHT
TRIBUNAL: Migration Review Tribunal
DATE OF DECISION: 9 August 2002
DECISION: The Tribunal affirms the decision under review.
STATEMENT OF DECISION AND REASONS
The applicant discussed the visa refusal.
"""

    result = _outcome(source)

    assert result is not None
    assert result.value == "The Tribunal affirms the decision under review."
    assert "refusal affirmed" not in result.quote


def test_bare_catchword_decision_followed_by_summary_word_is_skipped():
    result = _outcome("""CATCHWORDS: review decision
decision
affirmed
REVIEW APPLICANT: XHT
DECISION: The Tribunal affirms the decision under review.
STATEMENT OF DECISION AND REASONS
""")

    assert result is not None
    assert result.value == "The Tribunal affirms the decision under review."


def test_bare_decision_heading_followed_by_direct_order_is_supported():
    result = _outcome("DECISION\nThe Tribunal affirms the decision under review.\nREASONS FOR DECISION\n")

    assert result is not None
    assert result.value == "The Tribunal affirms the decision under review."


def test_federal_magistrates_rules_reference_is_not_treated_as_caption():
    result = _outcome("""ORDERS
1. The application is dismissed.
2. The applicant pay costs under Part 21 Rule 21.02(2)(a) of the Federal Magistrates Court Rules 2001.
FEDERAL MAGISTRATES
COURT OF AUSTRALIA
AT SYDNEY
REASONS FOR JUDGMENT
The application should be allowed.
""")

    assert result is not None
    assert "Federal Magistrates Court Rules 2001" in result.value
    assert "FEDERAL MAGISTRATES" not in result.value
    assert "should be allowed" not in result.quote
