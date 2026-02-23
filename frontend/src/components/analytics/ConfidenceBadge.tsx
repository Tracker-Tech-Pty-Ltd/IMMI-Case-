import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  totalMatching: number;
}

export function ConfidenceBadge({ totalMatching }: ConfidenceBadgeProps) {
  const { t } = useTranslation();

  const getConfidenceLevel = (total: number) => {
    if (total >= 100) {
      return {
        level: "high",
        label: t("analytics.confidence_high"),
        bgColor: "bg-green-100",
        textColor: "text-green-800",
        borderColor: "border-green-200",
      };
    } else if (total >= 50) {
      return {
        level: "medium",
        label: t("analytics.confidence_medium"),
        bgColor: "bg-yellow-100",
        textColor: "text-yellow-800",
        borderColor: "border-yellow-200",
      };
    } else {
      return {
        level: "low",
        label: t("analytics.confidence_low"),
        bgColor: "bg-red-100",
        textColor: "text-red-800",
        borderColor: "border-red-200",
      };
    }
  };

  const confidence = getConfidenceLevel(totalMatching);

  return (
    <div className="flex items-center gap-2">
      <div
        data-testid={`confidence-badge-${confidence.level}`}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
          confidence.bgColor,
          confidence.textColor,
          confidence.borderColor,
        )}
      >
        <span>N={totalMatching}</span>
        <span>•</span>
        <span>{confidence.label}</span>
      </div>
      <button
        aria-label={t("analytics.confidence_tooltip_label")}
        className="text-muted-text hover:text-foreground transition-colors"
        title={t("analytics.confidence_tooltip")}
      >
        <HelpCircle className="h-4 w-4" />
      </button>
    </div>
  );
}
