import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  ChevronUp,
  ChevronDown,
  Download,
  Printer,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

interface CaseTextViewerProps {
  text: string;
  citation?: string;
}

interface TocSection {
  id: string;
  title: string;
}

const SECTION_HEADINGS =
  /^(CATCHWORDS?|THE DECISION|DECISION RECORD?|DECISION|REASONS FOR DECISION|STATEMENT OF DECISION AND REASONS|REASONS|ORDERS?|THE FACTS?|LEGISLATION|RELEVANT LAW|RELEVANT LEGISLATION|BACKGROUND|FINDINGS AND REASONS|FINDINGS|CONSIDERATION OF CLAIMS AND EVIDENCE|CONSIDERATION OF CLAIMS|CONSIDERATION|CONCLUSIONS?|APPEARANCES|REPRESENTATION|ISSUES|SUBMISSIONS|ANALYSIS|EVIDENCE|INTRODUCTION|MATERIALS BEFORE THE TRIBUNAL|JURISDICTION|APPENDIX [A-Z]:?|ANNEXURE [A-Z]:?)/m;

// Line classification patterns
type LineType =
  | "separator"
  | "metadata"
  | "major-heading"
  | "dialogue"
  | "footnote"
  | "blank"
  | "body";

const METADATA_LINE =
  /^(Title|Citation|Court|Date|URL|Division|Applicant|Representative|Case Number)\s*:/;
const DIALOGUE_LINE =
  /^(Member|Applicant|HH|Counsel|Senior Member|Presiding Member|Tribunal)(\s+\w+)?\s*:/;
const FOOTNOTE_LINE = /^\[\d+\]/;
const SEPARATOR_LINE = /^={5,}$/;

function classifyLine(line: string): LineType {
  const trimmed = line.trim();
  if (SEPARATOR_LINE.test(trimmed)) return "separator";
  if (METADATA_LINE.test(trimmed)) return "metadata";
  if (SECTION_HEADINGS.test(trimmed)) return "major-heading";
  if (DIALOGUE_LINE.test(trimmed)) return "dialogue";
  if (FOOTNOTE_LINE.test(trimmed)) return "footnote";
  if (!trimmed) return "blank";
  return "body";
}

/** Upper bound on highlighted hits, so a 1-letter term cannot blow up the tree. */
const MAX_HIGHLIGHTED_MATCHES = 500;

// Smart line rendering function for reading mode
function renderSmartLines(text: string): React.ReactNode {
  const lines = text.split("\n");
  const usedIds = new Set<string>();
  const result: React.ReactNode[] = [];
  let consecutiveBlanks = 0;

  lines.forEach((line, i) => {
    const type = classifyLine(line);
    const trimmed = line.trim();

    // Compress consecutive blank lines (max 2)
    if (type === "blank") {
      consecutiveBlanks++;
      if (consecutiveBlanks <= 2) {
        result.push(<div key={i} className="h-2" />);
      }
      return;
    }
    consecutiveBlanks = 0;

    switch (type) {
      case "separator":
        result.push(<div key={i} className="my-4 border-t border-border" />);
        break;

      case "metadata":
        result.push(
          <div key={i} className="font-mono text-[10px] text-muted-text pb-0.5">
            {line}
          </div>,
        );
        break;

      case "major-heading": {
        const baseId = `toc-${trimmed
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 50)}`;
        let id = baseId;
        let counter = 1;
        while (usedIds.has(id)) id = `${baseId}-${++counter}`;
        usedIds.add(id);
        result.push(
          <div key={i} className="mt-6 pt-4 border-t-2 border-accent/20">
            <strong
              id={id}
              className="block font-sans text-sm font-bold text-accent tracking-wide uppercase"
            >
              {trimmed}
            </strong>
          </div>,
        );
        break;
      }

      case "dialogue":
        result.push(
          <div
            key={i}
            className="my-0.5 border border-border/50 bg-surface/60 px-3 py-1 rounded font-sans text-xs text-foreground whitespace-pre-wrap"
          >
            {line}
          </div>,
        );
        break;

      case "footnote":
        result.push(
          <div
            key={i}
            className="font-mono text-[10px] text-muted-text leading-loose whitespace-pre-wrap"
          >
            {line}
          </div>,
        );
        break;

      default: // body
        result.push(
          <div
            key={i}
            className="font-mono text-xs text-foreground whitespace-pre-wrap leading-relaxed min-h-[1rem]"
          >
            {line}
          </div>,
        );
    }
  });

  return result;
}

// Parse sections from full text
function parseSections(text: string): TocSection[] {
  const lines = text.split("\n");
  const sections: TocSection[] = [];
  const usedIds = new Set<string>();
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (SECTION_HEADINGS.test(trimmed)) {
      const baseId = `toc-${trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 50)}`;
      let id = baseId;
      let counter = 1;
      while (usedIds.has(id)) id = `${baseId}-${++counter}`;
      usedIds.add(id);
      sections.push({ id, title: trimmed });
    }
  });
  return sections;
}

// Format sections with ID attributes for TOC navigation
function formatSectionsWithIds(text: string): React.ReactNode {
  const lines = text.split("\n");
  const usedIds = new Set<string>();
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (SECTION_HEADINGS.test(trimmed)) {
      const baseId = `toc-${trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 50)}`;
      let id = baseId;
      let counter = 1;
      while (usedIds.has(id)) id = `${baseId}-${++counter}`;
      usedIds.add(id);
      return (
        <span key={i}>
          {i > 0 && "\n"}
          <strong id={id} className="text-sm text-accent">
            {line}
          </strong>
        </span>
      );
    }
    return (
      <span key={i}>
        {i > 0 ? "\n" : ""}
        {line}
      </span>
    );
  });
}

export function CaseTextViewer({ text, citation }: CaseTextViewerProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Parse sections for TOC
  const sections = useMemo(() => parseSections(text), [text]);

  const debouncedSearchTerm = useDebouncedValue(searchTerm, 200);

  // Find matches, capped so a pathological term cannot blow up the tree.
  const { matches, totalMatches } = useMemo(() => {
    if (!debouncedSearchTerm || debouncedSearchTerm.length < 2) {
      return { matches: [] as number[], totalMatches: 0 };
    }
    const results: number[] = [];
    const lower = text.toLowerCase();
    const term = debouncedSearchTerm.toLowerCase();
    let idx = lower.indexOf(term);
    let total = 0;
    while (idx !== -1) {
      total += 1;
      if (results.length < MAX_HIGHLIGHTED_MATCHES) results.push(idx);
      idx = lower.indexOf(term, idx + 1);
    }
    return { matches: results, totalMatches: total };
  }, [text, debouncedSearchTerm]);
  const activeMatch = matches.length
    ? Math.min(activeMatchIdx, matches.length - 1)
    : 0;

  // Scroll active match into view
  useEffect(() => {
    if (matches.length === 0) return;
    const el = containerRef.current?.querySelector(".active-match");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatch, matches.length]);

  // Track active section via IntersectionObserver
  useEffect(() => {
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        root: containerRef.current,
        rootMargin: "0px 0px -75% 0px",
        threshold: 0,
      },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections, expanded]);

  // Ctrl+F intercept
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
        setSearchTerm("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showSearch]);

  const goToMatch = useCallback(
    (dir: 1 | -1) => {
      if (matches.length === 0) return;
      setActiveMatchIdx(
        (prev) => (prev + dir + matches.length) % matches.length,
      );
    },
    [matches.length],
  );

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleDownload = useCallback(() => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${citation ?? "case"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [text, citation]);

  const handlePrint = useCallback(() => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>${citation ?? "Case"}</title>
      <style>body{font-family:monospace;font-size:12px;white-space:pre-wrap;padding:2em;line-height:1.6}</style>
      </head><body>${text.replace(/</g, "&lt;")}</body></html>`);
    w.document.close();
    w.print();
  }, [text, citation]);

  // Reading-mode tree depends on `text` alone: typing must not rebuild it.
  const readingModeNodes = useMemo(
    () => (text ? renderSmartLines(text) : null),
    [text],
  );

  // Render text with search highlights and section formatting
  const rendered = useMemo(() => {
    if (!text) return null;

    // Search mode: preserve existing whitespace-pre-wrap + span rendering
    if (debouncedSearchTerm && debouncedSearchTerm.length >= 2 && matches.length > 0) {
      const parts: Array<{ text: string; isMatch: boolean; matchIdx: number }> =
        [];
      let lastEnd = 0;
      matches.forEach((start, i) => {
        if (start > lastEnd) {
          parts.push({
            text: text.slice(lastEnd, start),
            isMatch: false,
            matchIdx: -1,
          });
        }
        parts.push({
          text: text.slice(start, start + debouncedSearchTerm.length),
          isMatch: true,
          matchIdx: i,
        });
        lastEnd = start + debouncedSearchTerm.length;
      });
      if (lastEnd < text.length) {
        parts.push({ text: text.slice(lastEnd), isMatch: false, matchIdx: -1 });
      }

      return parts.map((part, i) =>
        part.isMatch ? (
          <mark
            key={i}
            className={
              part.matchIdx === activeMatch
                ? "active-match bg-warning text-foreground rounded-sm px-0.5"
                : "bg-warning/30 rounded-sm px-0.5"
            }
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{formatSectionsWithIds(part.text)}</span>
        ),
      );
    }

    // Reading mode: use smart line classification rendering
    return readingModeNodes;
  }, [text, debouncedSearchTerm, matches, activeMatch, readingModeNodes]);

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          {t("components.case_text_viewer.full_text")}
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          {showSearch ? (
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1">
              <Search className="h-3.5 w-3.5 text-muted-text" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setActiveMatchIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goToMatch(e.shiftKey ? -1 : 1);
                }}
                placeholder={t("components.case_text_viewer.search_in_text")}
                className="w-40 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-text"
              />
              {matches.length > 0 && (
                <span className="text-xs text-muted-text whitespace-nowrap">
                  {activeMatch + 1}/{matches.length}
                  {totalMatches > matches.length
                    ? ` ${t("components.case_text_viewer.match_cap_note", {
                        defaultValue: `(first ${MAX_HIGHLIGHTED_MATCHES} of ${totalMatches})`,
                        shown: MAX_HIGHLIGHTED_MATCHES,
                        total: totalMatches,
                      })}`
                    : ""}
                </span>
              )}
              <button
                onClick={() => goToMatch(-1)}
                className="p-0.5 text-muted-text hover:text-foreground"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => goToMatch(1)}
                className="p-0.5 text-muted-text hover:text-foreground"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearchTerm("");
                  setActiveMatchIdx(0);
                }}
                className="p-0.5 text-muted-text hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setShowSearch(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              className="rounded-md p-1.5 text-muted-text hover:bg-surface hover:text-foreground"
              title={t("components.case_text_viewer.search_tooltip")}
            >
              <Search className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={handleDownload}
            className="rounded-md p-1.5 text-muted-text hover:bg-surface hover:text-foreground"
            title={t("components.case_text_viewer.download_tooltip")}
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={handlePrint}
            className="rounded-md p-1.5 text-muted-text hover:bg-surface hover:text-foreground"
            title={t("components.case_text_viewer.print_tooltip")}
          >
            <Printer className="h-4 w-4" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-md p-1.5 text-muted-text hover:bg-surface hover:text-foreground"
            title={
              expanded
                ? t("components.case_text_viewer.collapse_tooltip")
                : t("components.case_text_viewer.expand_tooltip")
            }
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Body — TOC + Text side by side */}
      <div className="flex">
        {/* TOC Sidebar */}
        {sections.length > 0 && (
          <div
            className={`w-44 flex-shrink-0 border-r border-border overflow-y-auto ${
              expanded ? "max-h-none" : "max-h-[600px]"
            }`}
          >
            <p className="sticky top-0 bg-card px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
              {t("components.case_text_viewer.table_of_contents")}
            </p>
            <nav className="pb-3">
              {sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  className={cn(
                    "w-full border-l-2 px-3 py-1 text-left text-[11px] leading-snug transition-colors",
                    activeId === s.id
                      ? "border-accent bg-accent/5 font-medium text-accent"
                      : "border-transparent text-muted-text hover:bg-surface hover:text-foreground",
                  )}
                >
                  {s.title}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Text Content */}
        <div
          ref={containerRef}
          className={cn(
            "flex-1 overflow-auto p-4 leading-relaxed text-foreground",
            // Search mode needs whitespace-pre-wrap font-mono, reading mode doesn't
            searchTerm && searchTerm.length >= 2 && matches.length > 0
              ? "whitespace-pre-wrap font-mono text-xs"
              : "",
            expanded ? "max-h-none" : "max-h-[600px]",
          )}
        >
          {rendered}
        </div>
      </div>
    </div>
  );
}
