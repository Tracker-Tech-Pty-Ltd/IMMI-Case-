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
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { LegislationTextViewer } from "@/components/legislation/LegislationTextViewer";
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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-12 text-center">
      <BookOpen className="mb-3 h-10 w-10 text-muted-text" />
      <h3 className="font-heading text-base font-semibold text-foreground">
        {t("legislations.not_scraped_title", {
          defaultValue: "Full text not yet downloaded",
        })}
      </h3>
      <p className="mt-1 text-sm text-secondary-text">
        {t("legislations.not_scraped_description", {
          defaultValue:
            'Click "Update Laws" on the legislations list to download section text from AustLII.',
        })}
      </p>
      <button
        onClick={onUpdate}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
      >
        {t("legislations.back_button")}
      </button>
    </div>
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
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger/5 p-8 text-center">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            {t("common.not_found")}
          </h2>
          <p className="mt-2 text-sm text-secondary-text">
            {t("legislations.not_found_description", {
              defaultValue: "This legislation could not be found",
            })}
          </p>
          <button
            onClick={() => navigate("/legislations")}
            className="mt-4 flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-text">
        {t("common.loading_ellipsis")}
      </div>
    );
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

      {/* Unified Hero + Metadata */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* Accent header stripe */}
        <div className="border-b border-border bg-accent/5 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-accent" />
              <span className="text-xs font-semibold uppercase tracking-widest text-accent">
                {legislation.type ||
                  t("legislations.type", { defaultValue: "Legislation" })}
              </span>
              {legislation.jurisdiction && (
                <>
                  <span className="text-muted-text/50">·</span>
                  <span className="flex items-center gap-1 text-xs text-muted-text">
                    <Globe className="h-3 w-3" />
                    {legislation.jurisdiction}
                  </span>
                </>
              )}
            </div>
            <a
              href={austliiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded text-xs text-accent transition-colors hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              AustLII
            </a>
          </div>
        </div>

        {/* Title area */}
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="font-heading text-xl font-bold leading-snug text-foreground">
                {legislation.title}
              </h1>
              {legislation.description && (
                <p className="mt-1.5 text-sm leading-relaxed text-secondary-text">
                  {legislation.description}
                </p>
              )}
            </div>
            {legislation.shortcode && (
              <div className="shrink-0 rounded-md border border-accent/30 bg-accent/8 px-2.5 py-1.5 text-center">
                <p className="font-mono text-xs font-bold text-accent">
                  {legislation.shortcode}
                </p>
                <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-text">
                  shortcode
                </p>
              </div>
            )}
          </div>

          {/* Metadata chips */}
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
