/**
 * a11y-components.test.tsx
 *
 * Runs axe-core over the shared presentational components that appear on
 * nearly every page. Each test asserts the EXACT set of violation rule ids,
 * so a new violation fails and a fixed violation also fails (telling you to
 * delete the expectation). Baseline measured against the live tree per
 * plans/024 Step 5.
 *
 * Scope notes:
 *  * runOnly wcag2a + wcag2aa — axe "best-practice" rules (region,
 *    page-has-heading-one, ...) are page-level and meaningless for an
 *    isolated component render.
 *  * color-contrast is DISABLED: jsdom cannot rasterise text, so axe throws
 *    "Not implemented: HTMLCanvasElement.prototype.getContext" and reports
 *    the rule as "incomplete" rather than pass/fail. Token contrast is
 *    covered exhaustively by __tests__/css-tokens.test.ts instead.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import axe from "axe-core";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { NatureBadge } from "@/components/shared/NatureBadge";
import { FilterPill } from "@/components/shared/FilterPill";
import { Pagination } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/EmptyState";

const AXE_OPTIONS: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  rules: { "color-contrast": { enabled: false } },
};

async function violationIds(container: HTMLElement): Promise<string[]> {
  const results = await axe.run(container, AXE_OPTIONS);
  return results.violations.map((violation) => violation.id).toSorted();
}

const COURTS = [
  "AATA",
  "ARTA",
  "FCA",
  "FCCA",
  "FedCFamC2G",
  "HCA",
  "RRTA",
  "MRTA",
  "FMCA",
];

describe("Shared component accessibility (axe-core, WCAG 2.1 A + AA)", () => {
  it("CourtBadge has no violations for any of the 9 courts", async () => {
    const { container } = render(
      <div>
        {COURTS.map((court) => (
          <CourtBadge key={court} court={court} />
        ))}
      </div>,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("OutcomeBadge has no violations", async () => {
    const { container } = render(
      <div>
        <OutcomeBadge outcome="Decision under review affirmed" />
        <OutcomeBadge outcome="Decision under review set aside" />
      </div>,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("NatureBadge has no violations", async () => {
    const { container } = render(
      <div>
        <NatureBadge nature="Protection visa" />
        <NatureBadge nature="Partner visa" />
      </div>,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("Pagination has no violations", async () => {
    const { container } = render(
      <Pagination
        currentPage={3}
        totalPages={12}
        totalItems={240}
        pageSize={20}
        onPageChange={() => {}}
      />,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("EmptyState has no violations", async () => {
    const { container } = render(
      <EmptyState
        title="No cases found"
        description="Try widening the date range or clearing a filter."
        action={<button type="button">Clear filters</button>}
      />,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("FilterPill has no violations", async () => {
    // At commit 42826a3 this expected ["button-name"]: the remove control was
    // an icon-only <button> wrapping a lucide <X /> with no accessible name.
    // plans/023-fix-accessibility-semantics.md Step 7a added
    //   aria-label={`${removeLabel}: ${label}: ${value}`}
    // and 023 is a hard prerequisite of this plan, so the expectation is now [].
    const { container } = render(
      <FilterPill label="Court" value="AATA" onRemove={() => {}} />,
    );
    expect(await violationIds(container)).toEqual([]);
  });
});
