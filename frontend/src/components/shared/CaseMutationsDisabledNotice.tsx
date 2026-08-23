import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { StatePanel } from "@/components/shared/StatePanel";

interface CaseMutationsDisabledNoticeProps {
  className?: string;
}

/**
 * Inline notice for case mutation surfaces (add / edit / delete) when the
 * backend rejects the request with `case_mutations_disabled` — production
 * gates writes behind `IMMI_CASE_MUTATIONS_ENABLED` during the Cloudflare-
 * native data-platform migration (see `workers/case-api/cloudflare_mutations.js`).
 *
 * Callers are responsible for leaving form state untouched; this component
 * only informs the user their input has not been lost.
 */
export function CaseMutationsDisabledNotice({
  className,
}: CaseMutationsDisabledNoticeProps) {
  const { t } = useTranslation();

  return (
    <div data-testid="case-mutations-disabled-notice">
      <StatePanel
        tone="warning"
        align="start"
        icon={<Lock className="h-5 w-5" />}
        title={t("errors.case_mutations_disabled_title", {
          defaultValue: "Case editing is temporarily read-only",
        })}
        description={t("errors.case_mutations_disabled_message", {
          defaultValue:
            "We are migrating the case data platform, so saving, editing, and deleting cases is temporarily disabled. Your input has not been lost — it will remain here until editing is restored.",
        })}
        className={className}
      />
    </div>
  );
}
