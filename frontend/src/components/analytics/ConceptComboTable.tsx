import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { SuccessRateCombo } from "@/types/case";

interface ConceptComboTableProps {
  combos: SuccessRateCombo[];
}

function liftTone(lift: number) {
  if (lift >= 1.2)
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (lift >= 1.0)
    return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200";
  return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
}

function ConceptComboTableInner({ combos }: ConceptComboTableProps) {
  const { t } = useTranslation();
  if (!combos.length) {
    return (
      <p className="text-sm text-muted-text">
        {t("analytics.no_cooccurrence_data")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[420px] text-sm">
        <caption className="sr-only">
          {t("analytics.concept_combo_caption", {
            defaultValue: "Legal concept combinations",
          })}
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-text">
            <th scope="col" className="py-2 pr-2">{t("analytics.concepts_col")}</th>
            <th scope="col" className="py-2 pr-2">{t("analytics.cases_col")}</th>
            <th scope="col" className="py-2 pr-2">{t("analytics.win_rate")}</th>
            <th scope="col" className="py-2">{t("analytics.lift")}</th>
          </tr>
        </thead>
        <tbody>
          {combos.slice(0, 8).map((combo) => (
            <tr
              key={combo.concepts.join("|")}
              className="border-b border-border-light/60"
            >
              <td className="py-2 pr-2 text-foreground">
                {combo.concepts.join(" + ")}
              </td>
              <td className="py-2 pr-2 text-muted-text">
                {combo.count.toLocaleString()}
              </td>
              <td className="py-2 pr-2 text-muted-text">
                {combo.win_rate.toFixed(1)}%
              </td>
              <td className="py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${liftTone(combo.lift)}`}
                >
                  {combo.lift.toFixed(2)}x
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ConceptComboTable = memo(ConceptComboTableInner);
