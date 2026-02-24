import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useState, useCallback } from "react";
import { useCreateCase } from "@/hooks/use-cases";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { toast } from "sonner";

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
    try {
      const newCase = await createMutation.mutateAsync(form);
      toast.success(t("pages.case_add.success"));
      navigate(`/cases/${newCase.case_id}`);
    } catch (err) {
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

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Main fields */}
          <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
            <h2 className="mb-3 font-heading text-base font-semibold">
              {t("pages.case_add.new_case")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={`${t("cases.case_title")} *`}
                value={form.title}
                onChange={(v) => updateField("title", v)}
              />
              <Field
                label={t("cases.citation")}
                value={form.citation}
                onChange={(v) => updateField("citation", v)}
                placeholder={t("cases.citation_placeholder")}
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
              <Field
                label={t("cases.outcome")}
                value={form.outcome}
                onChange={(v) => updateField("outcome", v)}
              />
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
              <SelectField
                label={t("cases.nature")}
                value={form.case_nature}
                options={NATURE_OPTIONS}
                onChange={(v) => updateField("case_nature", v)}
              />
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  span2,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium text-muted-text">
        {label}
      </label>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
