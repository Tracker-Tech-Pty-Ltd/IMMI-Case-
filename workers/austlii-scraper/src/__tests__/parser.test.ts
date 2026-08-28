import { describe, expect, it } from "vitest";
import { extractFullText, extractMetadata } from "../parser";

// extractFullText requires >100 characters before it accepts a strategy's
// output (parser.ts:33,37,41).
const FILLER = "x".repeat(120);
const FILLER_Y = "y".repeat(120);

describe("extractFullText", () => {
  it('prefers id="page-main" over id="cases_doc"', () => {
    const html = `<html><body><div id="page-main">PRIMARY ${FILLER}</div><div id="cases_doc">SECONDARY ${FILLER}</div></body></html>`;
    expect(extractFullText(html)).toBe(`PRIMARY ${FILLER}`);
  });

  it('falls back to id="cases_doc" when there is no page-main', () => {
    const html = `<html><body><div id="cases_doc">FALLBACK2 ${FILLER}</div></body></html>`;
    expect(extractFullText(html)).toBe(`FALLBACK2 ${FILLER}`);
  });

  it('falls back to class="document" when there is no cases_doc', () => {
    const html = `<html><body><div class="document">FALLBACK3 ${FILLER}</div></body></html>`;
    expect(extractFullText(html)).toBe(`FALLBACK3 ${FILLER}`);
  });

  it("falls back to <body> and strips nav/script/style/footer", () => {
    const html = `<html><body><nav>NAVLINKS</nav><script>var a=1;</script><style>.x{}</style>BODYTEXT ${FILLER}<footer>FOOT</footer></body></html>`;
    expect(extractFullText(html)).toBe(`BODYTEXT ${FILLER}`);
  });

  it("returns an empty string for non-HTML input", () => {
    expect(extractFullText("not html")).toBe("");
  });

  it("ignores a page-main shorter than 100 characters and falls through to body", () => {
    const html = `<html><body><div id="page-main">tiny</div>BODYWINS ${FILLER}</body></html>`;
    expect(extractFullText(html)).toBe(`tiny\nBODYWINS ${FILLER}`);
  });

  it("decodes HTML entities", () => {
    const html = `<html><body><div id="page-main">R &amp; R v Minister &#8212; s&nbsp;501 &lt;test&gt; ${FILLER}</div></body></html>`;
    expect(extractFullText(html)).toBe(`R & R v Minister — s 501 <test> ${FILLER}`);
  });
});

describe("extractMetadata", () => {
  const AATA_TEXT = [
    "ADMINISTRATIVE APPEALS TRIBUNAL",
    "Singh and Minister for Immigration [2024] AATA 100",
    "TRIBUNAL MEMBER: Senior Member A Jones",
    "CATCHWORDS: MIGRATION - protection visa - character test - decision affirmed",
    "",
    "Date of decision: 15 March 2024",
    "The Tribunal affirms the decision under review.",
    "",
    "Migration Act 1958 (Cth) s 501 was considered.",
  ].join("\n");

  const FCA_TEXT = [
    "FEDERAL COURT OF AUSTRALIA",
    "Patel v Minister for Immigration [2023] FCA 500",
    "Coram: Williams J",
    "CATCHWORDS: MIGRATION - judicial review - jurisdictional error",
    "",
    "Date of judgment: 10 September 2023",
    "The Court orders that the application be allowed.",
    "",
    "Migration Regulations 1994 (Cth) reg 2.03 applies.",
  ].join("\n");

  it("extracts the TRIBUNAL MEMBER as judges (AATA)", () => {
    expect(extractMetadata(AATA_TEXT).judges).toBe("Senior Member A Jones");
  });

  it("extracts the decision date (AATA)", () => {
    expect(extractMetadata(AATA_TEXT).date).toBe("15 March 2024");
  });

  it("extracts the catchwords line (AATA)", () => {
    expect(extractMetadata(AATA_TEXT).catchwords).toBe(
      "MIGRATION - protection visa - character test - decision affirmed",
    );
  });

  it("extracts the citation (AATA)", () => {
    expect(extractMetadata(AATA_TEXT).citation_extracted).toBe("[2024] AATA 100");
  });

  it("extracts the visa type (AATA)", () => {
    expect(extractMetadata(AATA_TEXT).visa_type).toBe("protection visa");
  });

  it("extracts Coram as judges (FCA), proving the Coram: pattern (parser.ts)", () => {
    expect(extractMetadata(FCA_TEXT).judges).toBe("Williams J");
  });

  it("extracts the judgment date (FCA)", () => {
    expect(extractMetadata(FCA_TEXT).date).toBe("10 September 2023");
  });

  it("extracts the citation (FCA)", () => {
    expect(extractMetadata(FCA_TEXT).citation_extracted).toBe("[2023] FCA 500");
  });

  it("extracts the operative order as outcome (FCA)", () => {
    expect(extractMetadata(FCA_TEXT).outcome).toBe(
      "The Court orders that the application be allowed.",
    );
  });

  it("returns an all-empty result for empty input", () => {
    expect(extractMetadata("")).toEqual({
      judges: "",
      date: "",
      catchwords: "",
      outcome: "",
      visa_type: "",
      legislation: "",
      citation_extracted: "",
    });
  });

  it("returns an all-empty result when nothing matches", () => {
    expect(extractMetadata("Nothing useful here at all.")).toEqual({
      judges: "",
      date: "",
      catchwords: "",
      outcome: "",
      visa_type: "",
      legislation: "",
      citation_extracted: "",
    });
  });

  // EXPECTED-TO-FAIL BLOCK. Each assertion below states the CORRECT behaviour and
  // is marked it.fails because parser.ts is currently wrong. They exist so the
  // defects are visible in CI, so the right answer is written down next to the
  // wrong one, and so a fix produces an obvious it.fails->passes failure instead
  // of a silent change in ingested data.
  // parser.ts is owned by plans/033-single-source-the-domain-vocabulary.md — do
  // not "fix" it from here. See plans/040 "Maintenance notes" for D1/D2/D3 and
  // for the remediation plan that must accompany any fix.

  it.fails("D1: keeps the text of a block element followed by another tag", () => {
    // Today returns only "SECOND PARAGRAPH ${FILLER_Y}" — stripHtmlTags at
    // parser.ts:211 eats everything between a block tag's own '>' and the
    // next '>' anywhere in the document.
    const html = `<div id="page-main"><p>FIRST PARAGRAPH</p><p>SECOND PARAGRAPH ${FILLER_Y}</p></div>`;
    expect(extractFullText(html)).toContain("FIRST PARAGRAPH");
  });

  it.fails("D1: keeps the text before an inline <a> inside a block", () => {
    // Today returns only "inline link inside ${FILLER_Y}" — same root cause
    // as above.
    const html = `<div id="page-main"><p>Text with an <a href="/l">inline link</a> inside ${FILLER_Y}</p></div>`;
    expect(extractFullText(html)).toContain("Text with an");
  });

  it.fails("D2: outcome is the operative order, not a catchwords word", () => {
    // Today returns "decision affirmed" — the /i flag makes DECISION match the
    // lowercase word inside the CATCHWORDS line (parser.ts:303).
    expect(extractMetadata(AATA_TEXT).outcome).toBe(
      "The Tribunal affirms the decision under review.",
    );
  });

  it.fails("D3: legislation keeps a regulation number containing a \".\"", () => {
    // Today truncated to "Migration Regulations 1994 (Cth) reg 2" — the
    // [^.]* pattern at parser.ts:325-326 stops at the first '.'.
    expect(extractMetadata(FCA_TEXT).legislation).toBe(
      "Migration Regulations 1994 (Cth) reg 2.03",
    );
  });
});
