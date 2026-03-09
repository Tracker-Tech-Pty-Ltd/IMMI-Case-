import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { compareCases } from "@/lib/api";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { NatureBadge } from "@/components/shared/NatureBadge";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageLoader } from "@/components/shared/PageLoader";
import { cn } from "@/lib/utils";
import { GitCompare, ExternalLink } from "lucide-react";
import type { ImmigrationCase } from "@/types/case";

const COMPARE_KEYS: Array<{ key: keyof ImmigrationCase; i18nKey: string }> = [
  { key: "court", i18nKey: "cases.court" },
  { key: "court_code", i18nKey: "cases.court_code" },
  { key: "date", i18nKey: "cases.date" },
  { key: "year", i18nKey: "units.year" },
  { key: "judges", i18nKey: "cases.judges" },
  { key: "outcome", i18nKey: "cases.outcome" },
  { key: "case_nature", i18nKey: "cases.nature" },
  { key: "visa_type", i18nKey: "cases.visa_type" },
  { key: "visa_subclass", i18nKey: "cases.visa_subclass" },
  { key: "legislation", i18nKey: "cases.legislation" },
  { key: "legal_concepts", i18nKey: "cases.legal_concepts" },
  { key: "catchwords", i18nKey: "case_detail.catchwords" },
  { key: "source", i18nKey: "cases.source" },
  { key: "tags", i18nKey: "case_detail.tags" },
];

export function CaseComparePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ids = searchParams.getAll("ids");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["compare", ids],
    queryFn: () => compareCases(ids),
    enabled: ids.length >= 2,
  });

  if (ids.length < 2) {
    return (
      <EmptyState
        icon={<GitCompare className="h-8 w-8" />}
        title={t("pages.case_comparison.select_cases")}
        description={t("pages.case_comparison.description")}
        action={
          <button
            onClick={() => navigate("/cases")}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
          >
            {t("pages.case_comparison.go_to_cases")}
          </button>
        }
      />
    );
  }

  if (isLoading) {
    return <PageLoader />;
  }

  if (isError) {
    return (
      <ApiErrorState
        title={t("errors.failed_to_load", { name: t("cases.comparison") })}
        message={
          error instanceof Error
            ? error.message
            : t("errors.api_request_failed", { name: t("cases.comparison") })
        }
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  if (!data) {
    return (
      <ApiErrorState
        title={t("errors.data_unavailable", { name: t("cases.comparison") })}
        message={t("errors.payload_error", { name: t("cases.comparison") })}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  const cases = data.cases;

  const compareFields = COMPARE_KEYS.map(({ key, i18nKey }) => ({
    key,
    label: t(i18nKey),
  }));

  // Detect fields that differ
  const differingFields = new Set<string>();
  for (const { key } of compareFields) {
    const values = cases.map((c) => String(c[key] ?? ""));
    if (new Set(values).size > 1) differingFields.add(key);
  }

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: t("nav.cases"), href: "/cases" },
          { label: `${t("cases.comparison")} (${cases.length})` },
        ]}
      />

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-max text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="sticky left-0 z-10 bg-surface p-3 text-left font-medium text-muted-text">
                {t("pages.data_dictionary.field_name")}
              </th>
              {cases.map((c) => (
                <th
                  key={c.case_id}
                  className="min-w-[200px] max-w-[250px] p-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <CourtBadge court={c.court_code} className="shrink-0" />
                    <span
                      className="line-clamp-1 font-medium text-foreground"
                      title={c.citation || c.title}
                    >
                      {c.citation || c.title}
                    </span>
                  </div>
                  <Link
                    to={`/cases/${c.case_id}`}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    {t("buttons.view_details")}{" "}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {compareFields.map(({ key, label }) => {
              const isDiffering = differingFields.has(key);
              return (
                <tr
                  key={key}
                  className={cn(
                    "border-b border-border-light",
                    isDiffering && "bg-warning/5",
                  )}
                >
                  <td className="sticky left-0 z-10 bg-card p-3 font-medium text-muted-text whitespace-nowrap">
                    {label}
                    {isDiffering && (
                      <span className="ml-1 text-[10px] text-warning">
                        {t("pages.case_comparison.differs")}
                      </span>
                    )}
                  </td>
                  {cases.map((c) => (
                    <td
                      key={c.case_id}
                      className="max-w-[250px] p-3 text-foreground"
                    >
                      {key === "outcome" ? (
                        <OutcomeBadge outcome={c[key]} />
                      ) : key === "court_code" ? (
                        <CourtBadge court={String(c[key] ?? "")} />
                      ) : key === "case_nature" ? (
                        <NatureBadge nature={String(c[key] ?? "")} />
                      ) : (
                        <span
                          className="line-clamp-3"
                          title={String(c[key] ?? "")}
                        >
                          {String(c[key] ?? "") || (
                            <span className="text-muted-text">—</span>
                          )}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
