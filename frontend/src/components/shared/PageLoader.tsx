import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatePanel } from "@/components/shared/StatePanel";

export function PageLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center py-20">
      <StatePanel
        tone="loading"
        icon={<div className="animate-spin" aria-hidden="true"><LoaderCircle className="h-5 w-5" /></div>}
        title={t("common.loading", { defaultValue: "Loading" })}
        description={t("common.loading_message", {
          defaultValue: "Preparing the latest data and interface state.",
        })}
        className="max-w-lg"
      />
    </div>
  );
}
