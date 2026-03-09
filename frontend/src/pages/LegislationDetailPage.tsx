import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Scale,
  Globe,
  Calendar,
  Hash,
  RefreshCw,
} from "lucide-react";
import { useLegislationDetail } from "@/hooks/use-legislations";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { EmptyState } from "@/components/shared/EmptyState";
import { LegislationTextViewer } from "@/components/legislation/LegislationTextViewer";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoader } from "@/components/shared/PageLoader";
import { cn } from "@/lib/utils";

const AUSTLII_BASE = "https://www.austlii.edu.au/au/legis/cth";

// ── Sub-components ────────────────────────────────────────────────────────────

interface MetaChipProps {
  icon: React.ReactNode;
  label: string;
  value?: string | number | null;
  mono?: boolean;
  accent?: boolean;
}

function MetaChip({ icon, label, value, mono, accent }: MetaChipProps) {
  if (!value && value !== 0) return null;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2",
        accent ? "border-accent/20 bg-accent/5" : "border-border bg-surface",
      )}
    >
      <span
        className={cn("shrink-0", accent ? "text-accent" : "text-muted-text")}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-text">
          {label}
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs font-semibold text-foreground",
            mono && "font-mono",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

/** Empty state when sections haven't been scraped yet */
function NotScrapedState({ onUpdate }: { onUpdate: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<BookOpen className="h-8 w-8" />}
      title={t("legislations.not_scraped_title", {
        defaultValue: "Full text not yet downloaded",
      })}
      description={t("legislations.not_scraped_description", {
        defaultValue:
          'Click "Update Laws" on the legislations list to download section text from AustLII.',
      })}
      action={
        <button
          type="button"
          onClick={onUpdate}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          {t("legislations.back_button")}
        </button>
      }
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function LegislationDetailPage() {
  const { t } = useTranslation();
  const { legislationId: id } = useParams<{ legislationId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useLegislationDetail(id ?? null);

  if (error) {
    return (
      <div className="space-y-4">
        <Breadcrumb
          items={[
            { label: t("common.dashboard"), href: "/" },
            {
              label: t("legislations.title", { defaultValue: "Legislations" }),
              href: "/legislations",
            },
            { label: t("common.not_found") },
          ]}
        />
        <ApiErrorState
          title={t("common.not_found")}
          message={t("legislations.not_found_description", {
            defaultValue: "This legislation could not be found",
          })}
        />
        <div>
          <button
            type="button"
            onClick={() => navigate("/legislations")}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return <PageLoader />;
  }

  const legislation = data.data;
  const sections = legislation.sections ?? [];
  const austliiUrl = `${AUSTLII_BASE}/${legislation.austlii_id}/`;

  return (
    <div className="space-y-4">
      {/* Breadcrumb + Back */}
      <div className="flex items-center justify-between">
        <Breadcrumb
          items={[
            { label: t("common.dashboard"), href: "/" },
            {
              label: t("legislations.title", { defaultValue: "Legislations" }),
              href: "/legislations",
            },
            { label: legislation.title },
          ]}
        />
        <button
          onClick={() => navigate("/legislations")}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-surface"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("common.back")}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-accent/5 px-5 py-3">
          <PageHeader
            title={legislation.title}
            description={legislation.description}
            eyebrow={
              legislation.type ||
              t("legislations.type", { defaultValue: "Legislation" })
            }
            icon={<Scale className="h-5 w-5" />}
            meta={
              <>
                {legislation.jurisdiction ? (
                  <span className="inline-flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {legislation.jurisdiction}
                  </span>
                ) : null}
                {legislation.shortcode ? (
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Hash className="h-3 w-3" />
                    {legislation.shortcode}
                  </span>
                ) : null}
              </>
            }
            actions={
              <a
                href={austliiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-md border border-accent/30 bg-background px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                AustLII
              </a>
            }
          />
        </div>

        <div className="px-5 py-4">
          <h2 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-text">
            {t("legislations.legislation_information", {
              defaultValue: "Legislation Information",
            })}
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <MetaChip
              icon={<Hash className="h-3.5 w-3.5" />}
              label={t("legislations.austlii_id", {
                defaultValue: "AustLII ID",
              })}
              value={legislation.austlii_id}
              mono
            />
            <MetaChip
              icon={<BookOpen className="h-3.5 w-3.5" />}
              label={t("legislations.sections", { defaultValue: "Sections" })}
              value={legislation.sections_count || undefined}
              accent
            />
            <MetaChip
              icon={<Calendar className="h-3.5 w-3.5" />}
              label={t("legislations.last_amended", {
                defaultValue: "Last Amended",
              })}
              value={legislation.last_amended || undefined}
            />
            <MetaChip
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              label={t("legislations.last_scraped", {
                defaultValue: "Last Scraped",
              })}
              value={
                legislation.last_scraped
                  ? new Date(legislation.last_scraped).toLocaleDateString(
                      "en-GB",
                      { day: "numeric", month: "short", year: "numeric" },
                    )
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      {/* Sections viewer */}
      {sections.length === 0 ? (
        <NotScrapedState onUpdate={() => navigate("/legislations")} />
      ) : (
        <LegislationTextViewer sections={sections} />
      )}
    </div>
  );
}
