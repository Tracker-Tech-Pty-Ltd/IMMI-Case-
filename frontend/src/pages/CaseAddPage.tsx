import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, ChevronDown } from "lucide-react";
import { useState, useCallback } from "react";
import { useCreateCase } from "@/hooks/use-cases";
import { isCaseMutationsDisabledError } from "@/lib/api";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { CaseMutationsDisabledNotice } from "@/components/shared/CaseMutationsDisabledNotice";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const COURT_OPTIONS = [
  "",
  "AATA",
  "ARTA",
  "FCA",
  "FCCA",
  "FedCFamC2G",
  "FMCA",
  "HCA",
  "MRTA",
  "RRTA",
];

const NATURE_OPTIONS = [
  "",
  "Migration",
  "Refugee",
  "Judicial Review",
  "Citizenship",
  "Visa Cancellation",
  "Deportation",
  "Character",
  "Bridging Visa",
];

export function CaseAddPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createMutation = useCreateCase();
  const [form, setForm] = useState<Record<string, string>>({});
  const [adminOpen, setAdminOpen] = useState(false);
  const [mutationsDisabled, setMutationsDisabled] = useState(false);

  const updateField = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) {
      toast.error(t("pages.case_add.title_required"));
      return;
    }
    if (form.citation && !/^\[?\d{4}\]?\s+\w+\s+\d+/.test(form.citation)) {
      toast.error(t("pages.case_add.citation_format"));
      return;
    }
    setMutationsDisabled(false);
    try {
      const newCase = await createMutation.mutateAsync(form);
      toast.success(t("pages.case_add.success"));
      navigate(`/cases/${newCase.case_id}`);
    } catch (err) {
      if (isCaseMutationsDisabledError(err)) {
        setMutationsDisabled(true);
        return;
      }
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: t("nav.cases"), href: "/cases" },
          { label: t("pages.case_add.breadcrumb_add") },
        ]}
      />

      <h1 className="font-heading text-2xl font-semibold text-foreground">
        {t("pages.case_add.breadcrumb_add", { defaultValue: "Add Case" })}
      </h1>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Main fields — grouped sections */}
          <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
            <h2 className="mb-5 font-heading text-base font-semibold">
              {t("pages.case_add.new_case")}
            </h2>

            {/* Section 1: Case Identity */}
            <SectionHeader label={t("pages.case_add.section_identity", "Case Identity")} />
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field
                label={`${t("cases.case_title")} *`}
                value={form.title}
                onChange={(v) => updateField("title", v)}
                maxLength={500}
              />
              <Field
                label={t("cases.citation")}
                value={form.citation}
                onChange={(v) => updateField("citation", v)}
                placeholder={t("cases.citation_placeholder")}
                maxLength={200}
              />
              <Field
                label={t("cases.court")}
                value={form.court}
                onChange={(v) => updateField("court", v)}
              />
              <SelectField
                label={t("cases.court_code")}
                value={form.court_code}
                options={COURT_OPTIONS}
                onChange={(v) => updateField("court_code", v)}
              />
            </div>

            {/* Section 2: Tribunal Details */}
            <div className="mt-5 border-t border-border/50 pt-5">
              <SectionHeader label={t("pages.case_add.section_tribunal", "Tribunal Details")} />
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field
                  label={t("cases.date")}
                  value={form.date}
                  onChange={(v) => updateField("date", v)}
                  placeholder={t("cases.date_placeholder")}
                />
                <Field
                  label={t("cases.judges")}
                  value={form.judges}
                  onChange={(v) => updateField("judges", v)}
                />
              </div>
            </div>

            {/* Section 3: Visa & Outcome */}
            <div className="mt-5 border-t border-border/50 pt-5">
              <SectionHeader label={t("pages.case_add.section_visa", "Visa & Outcome")} />
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field
                  label={t("cases.visa_type")}
                  value={form.visa_type}
                  onChange={(v) => updateField("visa_type", v)}
                />
                <Field
                  label={t("cases.visa_subclass")}
                  value={form.visa_subclass}
                  onChange={(v) => updateField("visa_subclass", v)}
                />
                <Field
                  label={t("cases.class_code")}
                  value={form.visa_class_code}
                  onChange={(v) => updateField("visa_class_code", v)}
                />
                <Field
                  label={t("cases.outcome")}
                  value={form.outcome}
                  onChange={(v) => updateField("outcome", v)}
                />
                <SelectField
                  label={t("cases.nature")}
                  value={form.case_nature}
                  options={NATURE_OPTIONS}
                  onChange={(v) => updateField("case_nature", v)}
                />
              </div>
            </div>

            {/* Section 4: Administrative (collapsed by default) */}
            <div className="mt-5 border-t border-border/50 pt-5">
              <button
                type="button"
                onClick={() => setAdminOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-md px-0 py-0.5 text-left transition-colors hover:text-foreground"
                aria-expanded={adminOpen}
              >
                <SectionHeader
                  label={t("pages.case_add.section_admin", "Administrative")}
                  as="span"
                />
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-text transition-transform duration-200",
                    adminOpen && "rotate-180",
                  )}
                />
              </button>
              {adminOpen && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t("cases.url")}
                    value={form.url}
                    onChange={(v) => updateField("url", v)}
                    span2
                  />
                  <Field
                    label={t("cases.source")}
                    value={form.source}
                    onChange={(v) => updateField("source", v)}
                  />
                  <Field
                    label={t("cases.legislation")}
                    value={form.legislation}
                    onChange={(v) => updateField("legislation", v)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right: Annotations */}
          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="mb-3 font-heading text-base font-semibold">
                {t("pages.case_edit.annotations")}
              </h2>
              <Field
                label={t("case_detail.tags")}
                value={form.tags}
                onChange={(v) => updateField("tags", v)}
                placeholder={t("cases.tags_placeholder")}
              />
              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-muted-text">
                  {t("case_detail.notes")}
                </label>
                <textarea
                  value={form.user_notes ?? ""}
                  onChange={(e) => updateField("user_notes", e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
            {mutationsDisabled && <CaseMutationsDisabledNotice />}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-1 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {createMutation.isPending
                  ? t("pages.case_add.creating")
                  : t("pages.case_add.save_button")}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function SectionHeader({
  label,
  as: Tag = "p",
}: {
  label: string;
  as?: "p" | "span";
}) {
  return (
    <Tag className="text-[10px] font-semibold uppercase tracking-wider text-muted-text">
      {label}
    </Tag>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  span2,
  maxLength,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  span2?: boolean;
  maxLength?: number;
}) {
  const len = value?.length ?? 0;
  const nearLimit = maxLength !== undefined && len >= Math.floor(maxLength * 0.85);

  return (
    <div className={span2 ? "sm:col-span-2" : ""}>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-medium text-muted-text">{label}</label>
        {nearLimit && maxLength && (
          <span className="text-xs text-muted-text">
            {len}/{maxLength}
          </span>
        )}
      </div>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-text">
        {label}
      </label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o || t("common.all", { defaultValue: `— ${label} —` })}
          </option>
        ))}
      </select>
    </div>
  );
}
