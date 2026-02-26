import { useParams, useNavigate, Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Edit,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  BookmarkPlus,
  Plus,
} from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { useCase, useRelatedCases, useDeleteCase } from "@/hooks/use-cases";
import { useSimilarCases } from "@/hooks/use-similar-cases";
import { SimilarCasesPanel } from "@/components/cases/SimilarCasesPanel";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { NatureBadge } from "@/components/shared/NatureBadge";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { CaseTextViewer } from "@/components/cases/CaseTextViewer";
import { BookmarkButton } from "@/components/shared/BookmarkButton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useBookmarks,
  addCaseToCollection,
  createCollection,
} from "@/hooks/use-bookmarks";

export function CaseDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useCase(id ?? "");
  const { data: related } = useRelatedCases(id ?? "");
  const { data: similarCases, isLoading: similarLoading } = useSimilarCases(
    id ?? "",
  );
  const deleteMutation = useDeleteCase();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Keyboard shortcut: e → edit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!id) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
        navigate(`/cases/${id}/edit`);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [id, navigate]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success(t("states.completed"));
      navigate("/cases");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [id, deleteMutation, navigate, t]);

  const copyCitation = useCallback(() => {
    if (!data?.case.citation) return;
    navigator.clipboard.writeText(data.case.citation);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  if (!id) {
    return <Navigate to="/cases" replace />;
  }

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-text">
        {t("common.loading_ellipsis")}
      </div>
    );
  }

  const c = data.case;
  const fullText = data.full_text;

  return (
    <div className="space-y-4">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between">
        <Breadcrumb
          items={[
            { label: t("cases.title"), href: "/cases" },
            { label: c.citation || c.title || t("cases.case_details") },
          ]}
        />
        <div className="flex items-center gap-2">
          {c.url && (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t("cases.url")}
            </a>
          )}
          <AddToCollectionMenu
            caseId={c.case_id}
            caseTitle={c.title || ""}
            caseCitation={c.citation || ""}
            courtCode={c.court_code}
            date={c.date || ""}
          />
          <Link
            to={`/cases/${c.case_id}/edit`}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface"
          >
            <Edit className="h-3.5 w-3.5" /> {t("common.edit")}
          </Link>
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-1 rounded-md border border-danger/30 px-3 py-1.5 text-sm text-danger hover:bg-danger/5"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <CourtBadge court={c.court_code} />
          <OutcomeBadge outcome={c.outcome} />
          <NatureBadge nature={c.case_nature} />
        </div>
        <div className="flex items-start gap-2">
          <h1 className="font-heading text-xl font-semibold text-foreground">
            {c.citation || c.title}
          </h1>
          <button
            onClick={copyCitation}
            className="mt-1 shrink-0 rounded-md p-1 text-muted-text hover:bg-surface hover:text-foreground"
            title={t("case_detail.copy_citation")}
          >
            {copied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
          <BookmarkButton
            caseId={c.case_id}
            caseTitle={c.title || c.citation || ""}
            caseCitation={c.citation || ""}
            courtCode={c.court_code}
            date={c.date || ""}
            size="md"
          />
        </div>
        {c.title && c.citation && c.title !== c.citation && (
          <p className="mt-1 text-sm text-muted-text">{c.title}</p>
        )}
      </div>

      {/* Case Information — consolidated single card */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 font-heading text-base font-semibold text-foreground">
          {t("cases.case_information")}
        </h2>
        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <MetaField label={t("cases.title")} value={c.case_id} mono />
          <MetaField label={t("cases.citation")} value={c.citation} />
          <MetaField label={t("cases.date")} value={c.date} />
          <MetaField label={t("filters.court")} value={c.court} />
          <MetaField
            label={t("cases.court_code") || "Court Code"}
            value={c.court_code}
          />
          <MetaField
            label={t("units.year")}
            value={c.year ? String(c.year) : ""}
          />
          <MetaField label={t("cases.judges")} value={c.judges} />
          <MetaField label={t("cases.source") || "Source"} value={c.source} />
          <MetaField label={t("cases.outcome")} value={c.outcome} />
          <MetaField label={t("cases.nature")} value={c.case_nature} />
          <MetaField label={t("cases.applicant")} value={c.applicant_name} />
          <MetaField label={t("cases.respondent")} value={c.respondent} />
          <MetaField
            label={t("cases.country_of_origin")}
            value={c.country_of_origin}
          />
          <MetaField
            label={t("cases.visa_type") || "Visa Type"}
            value={c.visa_type}
          />
          <MetaField
            label={t("cases.visa_subclass")}
            value={c.visa_subclass}
            mono
          />
          <MetaField
            label={t("cases.subclass_no") || "Subclass No."}
            value={c.visa_subclass_number}
            mono
          />
          <MetaField
            label={t("cases.class_code") || "Class Code"}
            value={c.visa_class_code}
            mono
          />
          <MetaField
            label={t("cases.hearing_date") || "Hearing Date"}
            value={c.hearing_date}
          />
          <MetaField
            label={t("cases.represented") || "Represented"}
            value={c.is_represented}
          />
          <MetaField
            label={t("cases.representative") || "Representative"}
            value={c.representative}
          />
          <MetaField label={t("cases.legislation")} value={c.legislation} />
        </dl>
      </div>

      {/* Catchwords */}
      {c.catchwords && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-2 font-heading text-base font-semibold">
            {t("case_detail.catchwords")}
          </h2>
          <p className="text-sm leading-relaxed text-muted-text">
            {c.catchwords}
          </p>
        </div>
      )}

      {/* Legal Concepts */}
      {c.legal_concepts && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-2 font-heading text-base font-semibold">
            {t("cases.legal_concepts")}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {c.legal_concepts.split(";").map((concept) => {
              const trimmed = concept.trim();
              if (!trimmed) return null;
              return (
                <Link
                  key={trimmed}
                  to={`/cases?keyword=${encodeURIComponent(trimmed)}`}
                  className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent-muted hover:text-accent"
                >
                  {trimmed}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Notes & Tags */}
      {(c.tags || c.user_notes) && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-2 font-heading text-base font-semibold">
            {t("case_detail.notes")} & {t("case_detail.tags")}
          </h2>
          {c.tags && (
            <div className="mb-3">
              <dt className="mb-1 text-xs font-medium text-muted-text">
                {t("case_detail.tags")}
              </dt>
              <div className="flex flex-wrap gap-1.5">
                {c.tags.split(",").map((tag) => {
                  const trimmed = tag.trim();
                  if (!trimmed) return null;
                  return (
                    <Link
                      key={trimmed}
                      to={`/cases?tag=${encodeURIComponent(trimmed)}`}
                      className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent hover:bg-accent/20"
                    >
                      {trimmed}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
          {c.user_notes && (
            <div>
              <dt className="mb-1 text-xs font-medium text-muted-text">
                {t("case_detail.notes")}
              </dt>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {c.user_notes}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Related cases */}
      {related && related.cases.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 font-heading text-base font-semibold">
            {t("cases.related_cases")}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {related.cases.map((r) => (
              <Link
                key={r.case_id}
                to={`/cases/${r.case_id}`}
                className="flex items-center gap-3 rounded-md border border-border-light px-3 py-2 text-sm transition-colors hover:border-accent hover:bg-surface"
              >
                <CourtBadge court={r.court_code} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {r.citation || r.title}
                  </span>
                  <span className="text-xs text-muted-text">{r.date}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Similar cases (pgvector semantic search) */}
      <SimilarCasesPanel
        cases={similarCases}
        isLoading={similarLoading}
        available={similarCases !== undefined || similarLoading}
      />

      {/* Full text */}
      {fullText && <CaseTextViewer text={fullText} citation={c.citation} />}

      {/* Delete modal */}
      <ConfirmModal
        open={deleteOpen}
        title={t("modals.confirm_delete")}
        message={t("modals.confirm_delete_message", {
          name: c.citation || c.title,
        })}
        confirmLabel={t("common.delete")}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

interface AddToCollectionMenuProps {
  caseId: string;
  caseTitle: string;
  caseCitation: string;
  courtCode: string;
  date: string;
}

function AddToCollectionMenu({
  caseId,
  caseTitle,
  caseCitation,
  courtCode,
  date,
}: AddToCollectionMenuProps) {
  const { t } = useTranslation();
  const { collections } = useBookmarks();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleAddToCollection(collectionId: string) {
    addCaseToCollection(collectionId, caseId);
    toast.success(t("bookmarks.add_to_collection"));
    setOpen(false);
  }

  function handleNewCollection() {
    const name = prompt(t("bookmarks.collection_name"));
    if (!name?.trim()) return;
    const col = createCollection(name.trim());
    addCaseToCollection(col.id, caseId);
    // Also add bookmark so it appears in the collection
    import("@/hooks/use-bookmarks").then(({ addBookmark }) => {
      addBookmark({
        case_id: caseId,
        case_title: caseTitle,
        case_citation: caseCitation,
        court_code: courtCode,
        date,
      });
    });
    toast.success(t("bookmarks.collection_created"));
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface"
      >
        <BookmarkPlus className="h-3.5 w-3.5" />
        {t("bookmarks.add_to_collection")}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {collections.length === 0 ? (
            <button
              onClick={handleNewCollection}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("bookmarks.new_collection")}
            </button>
          ) : (
            <>
              {collections.map((col) => (
                <button
                  key={col.id}
                  onClick={() => handleAddToCollection(col.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface"
                >
                  {col.name}
                </button>
              ))}
              <div className="border-t border-border">
                <button
                  onClick={handleNewCollection}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-text hover:bg-surface hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("bookmarks.new_collection")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MetaField({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | number;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-text">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 break-words text-sm text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
