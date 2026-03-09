export const OUTCOME_COLORS = [
  "#1a5276",
  "#2d7d46",
  "#6c3483",
  "#b9770e",
  "#a83232",
  "#117864",
];

export function approvalBadgeClass(rate: number): string {
  if (rate >= 35) return "bg-success/15 text-success";
  if (rate >= 20) return "bg-warning/15 text-warning";
  return "bg-danger/15 text-danger";
}
