import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useCase, useUpdateCase } from "@/hooks/use-cases";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { PageLoader } from "@/components/shared/PageLoader";
import { toast } from "sonner";
import type { ImmigrationCase } from "@/types/case";

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

const EDITABLE_FIELDS = [
  "title",
  "citation",
  "court",
  "court_code",
  "date",
  "year",
  "judges",
  "outcome",
  "visa_type",
  "visa_subclass",
  "visa_class_code",
  "case_nature",
  "legislation",
  "legal_concepts",
  "catchwords",
  "url",
  "source",
  "tags",
  "user_notes",
  "applicant_name",
  "respondent",
  "country_of_origin",
  "visa_subclass_number",
  "hearing_date",
  "is_represented",
  "representative",
] as const;

function buildInitialForm(caseData: ImmigrationCase): Record<string, string> {
  const initial: Record<string, string> = {};
  for (const f of EDITABLE_FIELDS) {
    initial[f] = String(caseData[f as keyof ImmigrationCase] ?? "");
  }
  return initial;
}

const EMPTY_EDITS: Record<string, string> = {};

export function CaseEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const caseId = id ?? "";
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useCase(caseId);
  const updateMutation = useUpdateCase();
  const [formEditsByCaseId, setFormEditsByCaseId] = useState<
    Record<string, Record<string, string>>
  >({});

  const baseForm = data?.case ? buildInitialForm(data.case) : EMPTY_EDITS;
  const currentEdits = formEditsByCaseId[caseId] ?? EMPTY_EDITS;
  const form = { ...baseForm, ...currentEdits };
  const dirty = Object.keys(currentEdits).length > 0;

  // Unsaved changes warning
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const updateField = useCallback((key: string, value: string) => {
    setFormEditsByCaseId((prev) => {
      const nextByCase = { ...prev };
      const nextEdits = { ...(nextByCase[caseId] ?? {}) };
      const originalValue = baseForm[key] ?? "";

      if (value === originalValue) {
        delete nextEdits[key];
      } else {
        nextEdits[key] = value;
      }

      if (Object.keys(nextEdits).length === 0) {
        delete nextByCase[caseId];
      } else {
        nextByCase[caseId] = nextEdits;
      }

      return nextByCase;
    });
  }, [baseForm, caseId]);

  if (!id) {
    return <Navigate to="/cases" replace />;
  }

  if (isLoading) {
    return <PageLoader />;
  }

  if (isError && !data) {
    return (
      <ApiErrorState
        title={t("errors.failed_to_load", { name: t("nav.cases") })}
        message={
          error instanceof Error
            ? error.message
            : t("errors.api_request_failed", { name: t("nav.cases") })
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
        title={t("errors.data_unavailable", { name: t("nav.cases") })}
        message={t("errors.payload_error", { name: t("nav.cases") })}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) {
      toast.error(t("pages.case_edit.title_required"));
      return;
    }
    try {
      await updateMutation.mutateAsync({ id, data: form });
      toast.success(t("pages.case_edit.success"));
      setFormEditsByCaseId((prev) => {
        const next = { ...prev };
        delete next[caseId];
        return next;
      });
      navigate(`/cases/${id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Breadcrumb
          items={[
            { label: t("nav.cases"), href: "/cases" },
            {
              label: data.case.citation || t("cases.title"),
              href: `/cases/${id}`,
            },
            { label: t("pages.case_edit.breadcrumb_edit") },
          ]}
        />
        {dirty && (
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
            {t("pages.case_edit.unsaved_changes")}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Main fields (2 cols) */}
          <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
            <h2 className="mb-3 font-heading text-base font-semibold">
              {t("pages.case_edit.case_metadata")}
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
                label={t("units.year")}
                value={form.year}
                onChange={(v) => updateField("year", v)}
                type="number"
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
                label={t("cases.legislation")}
                value={form.legislation}
                onChange={(v) => updateField("legislation", v)}
                span2
              />
              <Field
                label={t("cases.legal_concepts")}
                value={form.legal_concepts}
                onChange={(v) => updateField("legal_concepts", v)}
                span2
                placeholder={t("cases.legal_concepts_placeholder")}
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
              <TextareaField
                label={t("case_detail.catchwords")}
                value={form.catchwords}
                onChange={(v) => updateField("catchwords", v)}
                rows={3}
              />
            </div>
            <h2 className="mb-3 mt-5 font-heading text-base font-semibold">
              {t("pages.case_edit.parties_representation")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("cases.applicant")}
                value={form.applicant_name}
                onChange={(v) => updateField("applicant_name", v)}
              />
              <Field
                label={t("cases.respondent")}
                value={form.respondent}
                onChange={(v) => updateField("respondent", v)}
              />
              <Field
                label={t("cases.country_of_origin")}
                value={form.country_of_origin}
                onChange={(v) => updateField("country_of_origin", v)}
              />
              <Field
                label={t("cases.subclass_no")}
                value={form.visa_subclass_number}
                onChange={(v) => updateField("visa_subclass_number", v)}
              />
              <Field
                label={t("cases.hearing_date")}
                value={form.hearing_date}
                onChange={(v) => updateField("hearing_date", v)}
                placeholder={t("cases.date_placeholder")}
              />
              <SelectField
                label={t("cases.represented")}
                value={form.is_represented}
                options={["", "Yes", "No", "Self-represented"]}
                onChange={(v) => updateField("is_represented", v)}
              />
              <Field
                label={t("cases.representative")}
                value={form.representative}
                onChange={(v) => updateField("representative", v)}
                span2
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
                <TextareaField
                  label={t("case_detail.notes")}
                  value={form.user_notes}
                  onChange={(v) => updateField("user_notes", v)}
                  rows={8}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-1 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
              >
                {t("pages.case_edit.cancel_button")}
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {updateMutation.isPending
                  ? t("pages.case_edit.saving")
                  : t("pages.case_edit.save_button")}
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
  type = "text",
  placeholder,
  span2,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium text-muted-text">
        {label}
      </label>
      <input
        type={type}
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
            {o
              ? o === "Yes"
                ? t("cases.representation_yes")
                : o === "No"
                  ? t("cases.representation_no")
                  : o === "Self-represented"
                    ? t("cases.representation_self")
                    : o
              : t("common.all", { defaultValue: `— ${label} —` })}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="sm:col-span-2">
      <label className="mb-1 block text-xs font-medium text-muted-text">
        {label}
      </label>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}
