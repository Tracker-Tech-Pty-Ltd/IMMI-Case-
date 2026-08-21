---
name: add-chart
description: Create a new Recharts chart component following project dark-mode patterns
---

# Add Chart Component

Create a new Recharts chart component that follows the project's established patterns for dark mode, theming, and layout.

## Required Pattern

Every chart component MUST include these dark-mode-safe patterns:

### Tooltip (CRITICAL — invisible text without `color`)
```tsx
<Tooltip
  cursor={{ fill: "var(--color-background-surface)", opacity: 0.5 }}
  contentStyle={{
    backgroundColor: "var(--color-background-card)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    color: "var(--color-text)",       // <-- REQUIRED for dark mode
    fontSize: 13,
  }}
  formatter={(value: number | undefined) => [
    Number(value ?? 0).toLocaleString(),
    "Cases",
  ]}
/>
```

### Axis Ticks
```tsx
tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
```

### CartesianGrid
```tsx
<CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
```

### Legend (if used)
```tsx
<Legend
  wrapperStyle={{ fontSize: 11, color: "var(--color-text-secondary)" }}
/>
```

### ResponsiveContainer (always wrap)
```tsx
<ResponsiveContainer width="100%" height={300}>
  {/* chart here */}
</ResponsiveContainer>
```

### Cell Colors (for bar charts with individual colors)
```tsx
import { Cell } from "recharts";
const COLORS = ["#1a5276", "#117864", "#6c3483", "#b9770e", "#a93226"];
<Bar dataKey="value" radius={[0, 4, 4, 0]}>
  {data.map((_, i) => (
    <Cell key={i} fill={COLORS[i % COLORS.length]} />
  ))}
</Bar>
```

## File Location

- Dashboard charts: `frontend/src/components/dashboard/`
- Analytics charts: `frontend/src/components/analytics/`

## Reference Files

- `CourtChart.tsx` — bar/pie with toggle, click navigation
- `TrendChart.tsx` — stacked area with custom tooltip filtering zeros
- `NatureChart.tsx` — horizontal bar with truncated labels
- `OutcomeByCourtChart.tsx` — grouped bar with percentage labels

## Arguments

When invoked, provide:
- Chart name (e.g., "OutcomeTimelineChart")
- Chart type (bar, line, area, pie, scatter)
- Data shape (e.g., `{ name: string, value: number }[]`)
- Placement (dashboard or analytics)
