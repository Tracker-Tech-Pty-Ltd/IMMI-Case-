import { useTranslation } from "react-i18next";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { StatePanel } from "@/components/shared/StatePanel";

interface ApiErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ApiErrorState({ title, message, onRetry }: ApiErrorStateProps) {
  const { t } = useTranslation();

  const defaultTitle = title ?? t("errors.unable_to_load_data");
  const defaultMessage = message ?? t("errors.unable_to_load_message");
  return (
    <StatePanel
      tone="error"
      align="start"
      icon={<AlertTriangle className="h-5 w-5" />}
      title={defaultTitle}
      description={defaultMessage}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-md border border-danger/25 bg-background-card px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("common.retry")}
          </button>
        ) : null
      }
    />
  );
}
