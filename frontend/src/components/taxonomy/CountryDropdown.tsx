import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { useCountries } from "@/hooks/use-taxonomy";
import { cn } from "@/lib/utils";
import type { CountryEntry } from "@/lib/api";

export function CountryDropdown() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Fetch top 30 countries with case counts
  const { data, isLoading } = useCountries(30);

  const countries = data?.countries ?? [];

  const handleCountryChange = useCallback(
    (country: string) => {
      if (!country) return;
      // Navigate to cases page with keyword filter for the country
      navigate(`/cases?keyword=${encodeURIComponent(country)}`);
    },
    [navigate],
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h2 className="font-heading text-lg font-semibold text-foreground">
          {t("taxonomy.country_dropdown", {
            defaultValue: "Country of Origin",
          })}
        </h2>
        <p className="mt-0.5 text-sm text-secondary-text">
          {t("taxonomy.country_dropdown_desc", {
            defaultValue: "Filter cases by applicant's country of origin",
          })}
        </p>
      </div>

      {/* Dropdown select */}
      <div className="relative">
        <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-text" />
        <select
          onChange={(e) => handleCountryChange(e.target.value)}
          disabled={isLoading}
          className={cn(
            "w-full appearance-none rounded-md border border-border bg-card py-2 pl-9 pr-10 text-sm",
            "text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            "focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent",
            "transition-shadow",
            "bg-[length:16px_16px] bg-[position:right_0.75rem_center] bg-no-repeat",
            "[background-image:url('data:image/svg+xml;charset=UTF-8,%3csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%20stroke%3D%22%23999%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3cpath%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3c%2Fsvg%3E')]",
          )}
        >
          <option value="">
            {isLoading
              ? t("common.loading", { defaultValue: "Loading..." })
              : t("taxonomy.select_country", {
                  defaultValue: "Select a country",
                })}
          </option>
          {countries.map((entry: CountryEntry) => (
            <option key={entry.country} value={entry.country}>
              {entry.country} ({entry.case_count.toLocaleString()}{" "}
              {t("common.cases", { defaultValue: "cases" })})
            </option>
          ))}
        </select>
      </div>

      {/* Summary */}
      {!isLoading && countries.length > 0 && (
        <div className="rounded-md border border-border bg-surface px-3 py-2">
          <p className="text-xs text-secondary-text">
            {t("taxonomy.country_summary", {
              defaultValue: "Showing {{count}} countries with the most cases",
              count: countries.length,
            })}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && countries.length === 0 && (
        <div className="rounded-md border border-border bg-card p-4 text-center text-sm text-muted-text">
          {t("taxonomy.no_countries", {
            defaultValue: "No country data available",
          })}
        </div>
      )}
    </div>
  );
}
