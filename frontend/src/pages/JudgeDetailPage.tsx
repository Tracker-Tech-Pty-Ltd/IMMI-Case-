import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { OutcomeStackedBar } from "@/components/shared/OutcomeStackedBar";
import { JudgeHero } from "@/components/judges/JudgeHero";
import { CourtComparisonCard } from "@/components/judges/CourtComparisonCard";
import { RepresentationCard } from "@/components/judges/RepresentationCard";
import { CountryOriginChart } from "@/components/judges/CountryOriginChart";
import { VisaBreakdownChart } from "@/components/judges/VisaBreakdownChart";
import { NatureBreakdownChart } from "@/components/judges/NatureBreakdownChart";
import { ConceptEffectivenessTable } from "@/components/judges/ConceptEffectivenessTable";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { PageLoader } from "@/components/shared/PageLoader";
import { useJudgeProfile, useJudgeBio } from "@/hooks/use-judges";

const SECTION_NAV = [
  { id: "section-outcomes", key: "judges.section_outcomes" },
  { id: "section-trend", key: "judges.section_trend" },
  { id: "section-court", key: "judges.section_court" },
  { id: "section-visa", key: "judges.section_visa" },
  { id: "section-nature", key: "judges.section_nature" },
  { id: "section-representation", key: "judges.section_representation" },
  { id: "section-country", key: "judges.section_country" },
  { id: "section-concepts", key: "judges.section_concepts" },
  { id: "section-recent", key: "judges.section_recent" },
] as const;

export function JudgeDetailPage() {
  const { t } = useTranslation();
  const { name = "" } = useParams();
  const decodedName = decodeURIComponent(name);
  const { data, isLoading, isError, error, refetch } =
    useJudgeProfile(decodedName);
  const { data: bioData, isLoading: bioLoading } = useJudgeBio(decodedName);

  if (isLoading) {
    return <PageLoader />;
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <Link
          to="/judge-profiles"
          className="text-sm font-medium text-accent hover:underline"
        >
          {t("judges.back_to_profiles")}
        </Link>
        <ApiErrorState
          title={t("judges.profile_load_failed")}
          message={
            error instanceof Error
              ? error.message
              : t("judges.profile_load_failed")
          }
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Link
          to="/judge-profiles"
          className="text-sm font-medium text-accent hover:underline"
        >
          {t("judges.back_to_profiles")}
        </Link>
        <ApiErrorState
          title={t("judges.profile_not_found")}
          message={t("errors.payload_error", { name: decodedName })}
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          to="/judge-profiles"
          className="text-sm font-medium text-accent hover:underline"
        >
          {t("judges.back_to_profiles")}
        </Link>
      </div>

      <JudgeHero
        profile={data}
        bio={bioData ?? { found: false }}
        isLoading={bioLoading}
      />

      <nav className="sticky top-0 z-10 -mx-4 overflow-x-auto border-b border-border bg-background/95 px-4 py-2 backdrop-blur-sm">
        <div className="flex gap-4 whitespace-nowrap text-xs font-medium text-muted-text">
          {SECTION_NAV.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="transition-colors hover:text-accent"
            >
              {t(s.key)}
            </a>
          ))}
        </div>
      </nav>

      {data.recent_3yr_trend.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {t("judges.recent_3yr_trend")}
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {data.recent_3yr_trend.map((yr) => (
              <div
                key={yr.year}
                className="rounded-md border border-border-light/60 p-3 text-center"
              >
                <p className="text-xs text-muted-text">{yr.year}</p>
                <p className="text-lg font-semibold text-foreground">
                  {yr.approval_rate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-text">
                  {yr.total.toLocaleString()} {t("judges.cases")}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          id="section-outcomes"
          className="scroll-mt-12 rounded-lg border border-border bg-card p-4"
        >
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {t("judges.outcome_distribution")}
          </h2>
          <OutcomeStackedBar data={data.outcome_distribution} height={36} />
        </section>

        <section
          id="section-trend"
          className="scroll-mt-12 rounded-lg border border-border bg-card p-4"
        >
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {t("judges.yearly_approval_trend")}
          </h2>
          {data.yearly_trend.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={data.yearly_trend}
                margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  opacity={0.35}
                />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
                />
                <Tooltip
                  formatter={(value: number | string | undefined) => [
                    `${Number(value ?? 0).toFixed(1)}%`,
                    t("judges.approval_rate"),
                  ]}
                  contentStyle={{
                    backgroundColor: "var(--color-background-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius)",
                    color: "var(--color-text)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="approval_rate"
                  stroke="#1a5276"
                  fill="#1a527640"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-text">
              {t("judges.no_trend_data")}
            </p>
          )}
        </section>
      </div>

      {/* Court Comparison */}
      <div id="section-court" className="scroll-mt-12">
        <CourtComparisonCard data={data.court_comparison} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          id="section-visa"
          className="scroll-mt-12 rounded-lg border border-border bg-card p-4"
        >
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {t("judges.visa_breakdown")}
          </h2>
          <VisaBreakdownChart data={data.visa_breakdown} />
        </section>

        <section
          id="section-nature"
          className="scroll-mt-12 rounded-lg border border-border bg-card p-4"
        >
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {t("judges.nature_breakdown")}
          </h2>
          <NatureBreakdownChart data={data.nature_breakdown} />
        </section>
      </div>

      {/* Representation Analysis */}
      <div id="section-representation" className="scroll-mt-12">
        <RepresentationCard data={data.representation_analysis} />
      </div>

      {/* Country of Origin */}
      <div id="section-country" className="scroll-mt-12">
        <CountryOriginChart data={data.country_breakdown} />
      </div>

      <section id="section-concepts" className="scroll-mt-12">
        <h2 className="mb-3 text-base font-semibold text-foreground">
          {t("judges.concept_effectiveness")}
        </h2>
        <ConceptEffectivenessTable data={data.concept_effectiveness} />
      </section>

      <section
        id="section-recent"
        className="scroll-mt-12 rounded-lg border border-border bg-card p-4"
      >
        <h2 className="mb-3 text-base font-semibold text-foreground">
          {t("judges.recent_cases")}
        </h2>
        {!data.recent_cases?.length ? (
          <p className="text-sm text-muted-text">
            {t("judges.no_recent_cases")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-text">
                  <th className="py-2 pr-2">{t("judges.citation")}</th>
                  <th className="py-2 pr-2">{t("judges.date")}</th>
                  <th className="py-2 pr-2">{t("judges.outcome")}</th>
                  <th className="py-2">{t("judges.visa")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_cases.slice(0, 10).map((item) => (
                  <tr
                    key={item.case_id}
                    className="border-b border-border-light/60"
                  >
                    <td className="py-2 pr-2 text-accent">
                      <Link
                        className="hover:underline"
                        to={`/cases/${item.case_id}`}
                      >
                        {item.citation}
                      </Link>
                    </td>
                    <td className="py-2 pr-2 text-muted-text">
                      {item.date || "-"}
                    </td>
                    <td className="py-2 pr-2 text-muted-text">
                      {item.outcome || "-"}
                    </td>
                    <td className="py-2 text-muted-text">
                      {item.visa_subclass || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
