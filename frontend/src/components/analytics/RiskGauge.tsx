import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface RiskGaugeProps {
  /** 0-100 risk/success score */
  score: number;
  /** Text label displayed below the score */
  label: string;
  /** Optional baseline value (0-100) to show a comparison marker */
  baseline?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function scoreColorClass(score: number): string {
  if (score < 40) return "text-danger";
  if (score < 65) return "text-warning";
  return "text-success";
}

function arcStrokeColor(score: number): string {
  if (score < 40) return "var(--color-semantic-danger)";
  if (score < 65) return "var(--color-semantic-warning)";
  return "var(--color-semantic-success)";
}

export function RiskGauge({ score, label, baseline }: RiskGaugeProps) {
  const { t } = useTranslation();
  const clamped = clamp(Math.round(score), 0, 100);
  const colorClass = useMemo(() => scoreColorClass(clamped), [clamped]);
  const strokeColor = useMemo(() => arcStrokeColor(clamped), [clamped]);

  // Semi-circle arc from 180° to 0° (left to right)
  const radius = 70;
  const cx = 90;
  const cy = 85;
  const circumference = Math.PI * radius; // half-circle
  const progress = (clamped / 100) * circumference;

  return (
    <div data-testid="risk-gauge" className="flex flex-col items-center">
      <svg
        width={180}
        height={100}
        viewBox="0 0 180 100"
        role="img"
        aria-label={t("analytics.risk_gauge_aria", {
          score: clamped,
          label,
          defaultValue: `Score ${clamped} out of 100: ${label}`,
        })}
      >
        {/* Background track */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={12}
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
        />
        {/* Score text in center */}
        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={28}
          fontWeight="bold"
          fill="currentColor"
        >
          {clamped}
        </text>
        {/* Baseline marker */}
        {baseline !== undefined && (
          <text
            data-testid="risk-gauge-baseline"
            x="50%"
            y="90%"
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-text-muted)"
          >
            {t("analytics.vs_avg", { defaultValue: "vs avg" })} {baseline}%
          </text>
        )}
      </svg>
      <span
        data-testid="risk-gauge-label"
        className={`-mt-2 text-sm font-medium ${colorClass}`}
      >
        {label}
      </span>
    </div>
  );
}
