import { useTranslation } from "react-i18next";

interface ConceptEffectivenessTableProps {
  data: Array<{
    concept: string;
    total: number;
    win_rate: number;
    baseline_rate: number;
    lift: number;
  }>;
}

function liftClass(lift: number) {
  if (lift >= 1.2)
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (lift >= 1.0)
    return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200";
  return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
}

export function ConceptEffectivenessTable({
  data,
}: ConceptEffectivenessTableProps) {
  const { t } = useTranslation();

  if (!data.length) {
    return (
      <p className="text-sm text-muted-text">{t("judges.no_concept_data")}</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card p-3">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {t("judges.concept_effectiveness_caption", {
            defaultValue: "Legal concept effectiveness by judge",
          })}
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-text">
            <th scope="col" className="py-2 pr-2">{t("judges.concept")}</th>
            <th scope="col" className="py-2 pr-2">{t("judges.total")}</th>
            <th scope="col" className="py-2 pr-2">{t("judges.win_rate")}</th>
            <th scope="col" className="py-2">{t("judges.lift")}</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 20).map((item) => (
            <tr key={item.concept} className="border-b border-border-light/60">
              <td className="py-2 pr-2 text-foreground">{item.concept}</td>
              <td className="py-2 pr-2 text-muted-text">
                {item.total.toLocaleString()}
              </td>
              <td className="py-2 pr-2 text-muted-text">
                {item.win_rate.toFixed(1)}%
              </td>
              <td className="py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${liftClass(item.lift)}`}
                >
                  {item.lift.toFixed(2)}x
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
