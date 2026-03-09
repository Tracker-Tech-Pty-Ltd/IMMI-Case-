import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GraduationCap,
  Briefcase,
  Calendar,
  ExternalLink,
  Globe,
  Linkedin,
  Twitter,
  User,
  MapPin,
  Scale,
  BookMarked,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import type { JudgeProfile, JudgeBio } from "@/types/case";
import { formatCourtTypeLabel } from "@/lib/display";

interface JudgeHeroProps {
  profile: JudgeProfile;
  bio: JudgeBio;
  isLoading: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  google_scholar: "Google Scholar",
  researchgate: "ResearchGate",
  university_page: "University",
  bar_association: "Bar Association",
};

function PlatformIcon({ platform }: { platform: string }) {
  switch (platform) {
    case "linkedin":
      return <Linkedin className="h-3.5 w-3.5" />;
    case "twitter":
      return <Twitter className="h-3.5 w-3.5" />;
    default:
      return <Globe className="h-3.5 w-3.5" />;
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-light/60 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-text">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function JudgeHero({ profile, bio, isLoading }: JudgeHeroProps) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);

  const first = profile.judge.active_years.first ?? "-";
  const last = profile.judge.active_years.last ?? "-";
  const displayName =
    bio.found && bio.full_name ? bio.full_name : profile.judge.name;

  const currentYear = new Date().getFullYear();
  const age = bio.birth_year ? currentYear - bio.birth_year : null;
  const hasPhoto = bio.found && bio.photo_url && !imgError;
  const initials = getInitials(displayName);

  const trendLabel = useMemo(() => {
    const trend = profile.recent_3yr_trend;
    if (trend.length < 2) return "—";
    const delta =
      trend[trend.length - 1].approval_rate - trend[0].approval_rate;
    if (delta > 2) return "up";
    if (delta < -2) return "down";
    return "stable";
  }, [profile.recent_3yr_trend]);

  const careerItems =
    bio.found && bio.previously
      ? bio.previously.split(/;\s*/).filter(Boolean)
      : [];

  const socialEntries =
    bio.found && bio.social_media
      ? Object.entries(bio.social_media).filter(
          ([, url]) => url && typeof url === "string" && url.startsWith("http"),
        )
      : [];

  const courtTypeLabel = formatCourtTypeLabel(profile.court_type, t);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* Top section: avatar + name + role */}
      <div className="flex gap-4">
        <div className="shrink-0">
          {isLoading ? (
            <div className="h-20 w-20 animate-pulse rounded-full bg-border" />
          ) : hasPhoto ? (
            <img
              src={bio.photo_url}
              alt={displayName}
              className="h-20 w-20 rounded-full border border-border object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              aria-label={displayName}
              className="flex h-20 w-20 items-center justify-center rounded-full border border-accent/20 bg-accent-muted text-xl font-semibold tracking-wide text-accent"
            >
              {initials || "J"}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-1">
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-5 w-3/4 animate-pulse rounded bg-border" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-border" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-border" />
            </div>
          ) : (
            <>
              <PageHeader
                title={displayName}
                description={
                  [bio.found ? bio.role : null, bio.found ? bio.court : null]
                    .filter(Boolean)
                    .join(" • ") || undefined
                }
                className="space-y-2"
                meta={
                  <>
                    {bio.found && bio.registry ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {bio.registry}
                      </span>
                    ) : null}
                    {bio.found && bio.specialization ? (
                      <span className="inline-flex items-center gap-1 text-accent">
                        <Scale className="h-3 w-3" />
                        {bio.specialization}
                      </span>
                    ) : null}
                    {bio.found && bio.appointed_year ? (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {t("judges.appointed")} {bio.appointed_year}
                      </span>
                    ) : null}
                    {age && age > 0 && age < 120 ? (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {t("judges.age", { age })}
                      </span>
                    ) : null}
                  </>
                }
              />
            </>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label={t("judges.total_cases")}
          value={profile.judge.total_cases.toLocaleString()}
        />
        <Stat
          label={t("judges.approval_rate")}
          value={`${profile.approval_rate.toFixed(1)}%`}
        />
        <Stat label={t("judges.court_type")} value={courtTypeLabel} />
        <Stat label={t("judges.active_years")} value={`${first} - ${last}`} />
        <Stat
          label={t("judges.recent_3yr_trend")}
          value={
            trendLabel === "up"
              ? `↑ ${t("judges.trend_improving")}`
              : trendLabel === "down"
                ? `↓ ${t("judges.trend_declining")}`
                : trendLabel === "stable"
                  ? `→ ${t("judges.trend_stable")}`
                  : "—"
          }
        />
      </div>

      {/* Education */}
      {bio.found && bio.education && bio.education.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-text">
            <GraduationCap className="h-3.5 w-3.5" />
            {t("judges.education")}
          </div>
          <ul className="mt-1.5 space-y-0.5 text-sm text-foreground">
            {bio.education.map((edu) => (
              <li key={edu} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/40" />
                {edu}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Career History */}
      {careerItems.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-text">
            <Briefcase className="h-3.5 w-3.5" />
            {t("judges.career_history")}
          </div>
          {careerItems.length === 1 ? (
            <p className="mt-1.5 text-sm text-foreground">{careerItems[0]}</p>
          ) : (
            <ul className="mt-1.5 space-y-0.5 text-sm text-foreground">
              {careerItems.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary-text/30" />
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Current Role Description */}
      {bio.found && bio.current_role_desc && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-text">
            <Scale className="h-3.5 w-3.5" />
            {t("judges.current_role", { defaultValue: "Current Role" })}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">
            {bio.current_role_desc}
          </p>
        </div>
      )}

      {/* Notable Cases */}
      {bio.found && bio.notable_cases && bio.notable_cases.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-text">
            <BookMarked className="h-3.5 w-3.5" />
            {t("judges.notable_cases", { defaultValue: "Notable Cases" })}
          </div>
          <div className="mt-2 space-y-3">
            {bio.notable_cases.map((nc) => (
              <div
                key={nc.citation}
                className="rounded-md border border-border-light/60 bg-surface/50 px-3 py-2.5"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/70" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-accent">
                      {nc.citation}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-text">
                      {nc.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Social Media / Online Profiles */}
      {socialEntries.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-text">
            <Globe className="h-3.5 w-3.5" />
            {t("judges.social_profiles")}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {socialEntries.map(([platform, url]) => (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/10"
              >
                <PlatformIcon platform={platform} />
                {PLATFORM_LABELS[platform] ?? platform}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Source link */}
      {bio.found && bio.source_url && (
        <div className="mt-4 border-t border-border-light/60 pt-3">
          <a
            href={bio.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {(() => {
              try {
                return new URL(bio.source_url).hostname;
              } catch {
                return bio.source_url.length > 50
                  ? bio.source_url.slice(0, 50) + "..."
                  : bio.source_url;
              }
            })()}
          </a>
        </div>
      )}
    </div>
  );
}
