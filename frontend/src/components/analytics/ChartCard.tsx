import { memo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { EmptyState } from "@/components/shared/EmptyState";

interface ChartCardProps {
  title: string;
  children: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
}

function ChartCardInner({
  title,
  children,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  isEmpty,
  emptyMessage,
  className,
}: ChartCardProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 400px" }}
      className={`flex h-full flex-col rounded-lg border border-border bg-card p-4 ${className ?? ""}`}
    >
      <h3 className="mb-3 font-heading text-base font-semibold text-foreground">
        {title}
      </h3>
      {isLoading ? (
        <div className="flex flex-1 flex-col gap-3 pt-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-border/40" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-border/40" />
          <div className="h-32 w-full animate-pulse rounded bg-border/40" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-border/40" />
        </div>
      ) : isError ? (
        <ApiErrorState
          title={t("errors.unable_to_load_data")}
          message={errorMessage ?? t("errors.unable_to_load_message")}
          onRetry={onRetry}
        />
      ) : isEmpty ? (
        <div className="flex flex-1 items-center justify-center py-4">
          <EmptyState
            title={emptyMessage ?? t("chart.no_data")}
            contained={false}
            className="py-0"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1">{children}</div>
      )}
    </div>
  );
}

export const ChartCard = memo(ChartCardInner);
