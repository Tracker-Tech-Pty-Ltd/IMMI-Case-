// Chart series colours from the token layer (src/tokens/tokens.json →
// color.chart / color.dark.chart) so they follow the active theme.
export const OUTCOME_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
];

export function approvalBadgeClass(rate: number): string {
  if (rate >= 35) return "bg-success/15 text-success";
  if (rate >= 20) return "bg-warning/15 text-warning";
  return "bg-danger/15 text-danger";
}
