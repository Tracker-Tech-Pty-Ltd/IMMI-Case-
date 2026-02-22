import { useTranslation } from "react-i18next";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { VisaQuickLookup } from "@/components/taxonomy/VisaQuickLookup";
import { LegalConceptBrowser } from "@/components/taxonomy/LegalConceptBrowser";
import { JudgeAutocomplete } from "@/components/taxonomy/JudgeAutocomplete";
import { CountryDropdown } from "@/components/taxonomy/CountryDropdown";

export function TaxonomyPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: t("common.dashboard"), href: "/" },
          { label: t("taxonomy.title", { defaultValue: "Search Taxonomy" }) },
        ]}
      />

      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          {t("taxonomy.title", { defaultValue: "Search Taxonomy" })}
        </h1>
        <p className="mt-1 text-sm text-secondary-text">
          {t("taxonomy.description", {
            defaultValue:
              "Search and filter immigration cases using specialized taxonomies",
          })}
        </p>
      </div>

      {/* Visa Quick Lookup Section */}
      <div className="rounded-lg border border-border bg-card p-5">
        <VisaQuickLookup />
      </div>

      {/* Legal Concepts Browser Section */}
      <div className="rounded-lg border border-border bg-card p-5">
        <LegalConceptBrowser />
      </div>

      {/* Judge Autocomplete Section */}
      <div className="rounded-lg border border-border bg-card p-5">
        <JudgeAutocomplete />
      </div>

      {/* Country Dropdown Section */}
      <div className="rounded-lg border border-border bg-card p-5">
        <CountryDropdown />
      </div>
    </div>
  );
}
