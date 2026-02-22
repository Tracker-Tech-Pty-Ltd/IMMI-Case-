/**
 * LegislationTextViewer
 *
 * Renders Australian statute text with intelligent line classification,
 * Part/Division TOC sidebar with active-section tracking, full-text
 * search with highlight navigation, and expand/collapse toggle.
 *
 * Line types detected:
 *   subsection  — (1) (2) (3) …
 *   paragraph   — (a) (b) (c) …
 *   subpara     — (i) (ii) (iii) …
 *   note        — Note: / Note 1:
 *   penalty     — Penalty:
 *   example     — Example: / Example 1:
 *   definition  — line ending in "means …"
 *   heading     — ALL CAPS short line (section/schedule headings)
 *   body        — everything else
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search,
  ChevronUp,
  ChevronDown,
  X,
  Maximize2,
  Minimize2,
  ChevronRight,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LegislationSection } from "@/lib/api";

// ── AustLII header stripping ───────────────────────────────────────────────

/**
 * AustLII section text arrives with its header duplicated:
 *   Line 0: "MIGRATION ACT 1958 - SECT 1"   ← AustLII URL-page header
 *   Line 1: "Short title"                    ← section title (1st copy)
 *   Line 2: "MIGRATION ACT 1958 - SECT 1"   ← duplicate header
 *   Line 3: "Short title"                    ← section title (2nd copy)
 *   Line 4: "This Act may be cited as …"    ← actual body
 *
 * Both the header and title are already shown in the section card header,
 * so we strip the leading duplicate block (lines 0-3 in the typical case)
 * plus any trailing blank lines before the real content starts.
 *
 * Pattern also covers "REG 1.03" style regulation references.
 */
const AUSTLII_HDR_RE = /^.{4,}\s+-\s+(?:SECT|REG)\s+\S/i;

function stripAustliiHeader(text: string): string {
  const lines = text.split("\n");
  let start = 0;

  // First line must be an AustLII header to trigger stripping at all
  if (!lines[0] || !AUSTLII_HDR_RE.test(lines[0].trim())) {
    return text;
  }

  // Skip the first header line
  start = 1;
  // Skip optional title line (non-empty, non-header)
  if (
    start < lines.length &&
    lines[start].trim() &&
    !AUSTLII_HDR_RE.test(lines[start].trim())
  ) {
    start++;
  }
  // Skip duplicate header line if present (the double-copy AustLII pattern)
  if (start < lines.length && AUSTLII_HDR_RE.test(lines[start].trim())) {
    start++;
    // Skip duplicate title line
    if (
      start < lines.length &&
      lines[start].trim() &&
      !AUSTLII_HDR_RE.test(lines[start].trim())
    ) {
      start++;
    }
  }
  // Skip leading blank lines before the actual body
  while (start < lines.length && !lines[start].trim()) start++;

  return lines.slice(start).join("\n").trimStart();
}

// ── Line classification ────────────────────────────────────────────────────

type LineType =
  | "subsection"
  | "paragraph"
  | "subpara"
  | "note"
  | "penalty"
  | "example"
  | "heading"
  | "blank"
  | "body";

const SUBSECTION_RE = /^\s*\((\d+[A-Z]?)\)\s/; // (1)  (2A)
const PARAGRAPH_RE = /^\s*\(([a-z]{1,2})\)\s/; // (a)  (ba)
const SUBPARA_RE = /^\s*\((i{1,3}|iv|v{1,3}|vi{1,3}|ix|x{1,2})\)\s/i; // (i) (iv)
const NOTE_RE = /^\s*Note\s*\d*\s*:/i;
const PENALTY_RE = /^\s*Penalty\s*:/i;
const EXAMPLE_RE = /^\s*Example\s*\d*\s*:/i;
// Short ALL-CAPS lines (section title echoes or division headings from scraper)
const HEADING_RE = /^[A-Z][A-Z\s\d—–-]{4,80}$/;

function classifyLine(line: string): LineType {
  if (!line.trim()) return "blank";
  if (NOTE_RE.test(line)) return "note";
  if (PENALTY_RE.test(line)) return "penalty";
  if (EXAMPLE_RE.test(line)) return "example";
  if (SUBPARA_RE.test(line)) return "subpara";
  if (PARAGRAPH_RE.test(line)) return "paragraph";
  if (SUBSECTION_RE.test(line)) return "subsection";
  if (HEADING_RE.test(line.trim())) return "heading";
  return "body";
}

// ── Cross-reference linkification ─────────────────────────────────────────

/** Map from section number string (e.g. "501", "501A") → DOM element id */
type SectionMap = Map<string, string>;

/**
 * Build a lookup from section number → section element id.
 * Handles edge cases like "501A", "1.03", "503A" etc.
 */
function buildSectionMap(sections: LegislationSection[]): SectionMap {
  const map: SectionMap = new Map();
  for (const s of sections) {
    if (s.number) map.set(s.number.trim().toLowerCase(), s.id);
  }
  return map;
}

/**
 * Pattern that matches common Australian statute cross-references:
 *   section 501        sections 501 and 501A
 *   subsection (1)     s. 501          s 501A
 *   paragraph (a)
 *
 * Group 1 = the keyword ("section"/"subsection"/"paragraph"/"s.")
 * Group 2 = the reference identifier (number or letter)
 */
const XREF_RE =
  /\b(sections?\s+|subsections?\s+|paragraphs?\s+|s\.\s*)([A-Za-z]?\d[\d.A-Za-z]*(?:\([^)]*\))?)/g;

/**
 * Split `text` into alternating string/JSX segments.
 * References that exist in `sectionMap` are rendered as clickable buttons.
 * Unknown references remain as plain text (no broken links).
 */
function linkifyText(
  text: string,
  sectionMap: SectionMap,
  onJump: (id: string) => void,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  XREF_RE.lastIndex = 0; // reset stateful global regex

  while ((match = XREF_RE.exec(text)) !== null) {
    const [full, keyword, ref] = match;
    const start = match.index;

    // Push preceding plain text
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));

    const refLower = ref.trim().toLowerCase();
    const sectionId = sectionMap.get(refLower);

    if (sectionId) {
      // Render as clickable link
      parts.push(
        <button
          key={start}
          onClick={() => onJump(sectionId)}
          className="inline-flex items-center gap-0.5 rounded px-0.5 font-mono text-accent underline decoration-dotted underline-offset-2 hover:bg-accent/10 hover:decoration-solid"
          title={`Jump to section ${ref}`}
        >
          <Link2 className="inline h-2.5 w-2.5 shrink-0 opacity-60" />
          {keyword}
          <span className="font-semibold">{ref}</span>
        </button>,
      );
    } else {
      // Unknown section — keep as plain text to avoid dead links
      parts.push(full);
    }

    lastIndex = start + full.length;
  }

  // Remaining text after last match
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return parts.length === 0 ? text : <>{parts}</>;
}

// ── Smart rendering (reading mode) ────────────────────────────────────────

function renderStatuteLine(
  line: string,
  type: LineType,
  key: number,
  sectionMap: SectionMap,
  onJump: (id: string) => void,
): React.ReactNode {
  switch (type) {
    case "blank":
      return <div key={key} className="h-1.5" />;

    case "heading":
      return (
        <p
          key={key}
          className="mt-4 mb-1 text-xs font-bold uppercase tracking-widest text-accent/80"
        >
          {line.trim()}
        </p>
      );

    case "subsection": {
      const rest = line.replace(SUBSECTION_RE, "").trimStart();
      return (
        <p key={key} className="mt-2 text-sm leading-relaxed text-foreground">
          {rest ? (
            <>
              <span className="mr-2 font-mono text-xs font-bold text-accent">
                {line.match(SUBSECTION_RE)?.[0].trim()}
              </span>
              {linkifyText(rest, sectionMap, onJump)}
            </>
          ) : (
            <span className="font-mono text-xs font-bold text-accent">
              {line}
            </span>
          )}
        </p>
      );
    }

    case "paragraph": {
      const rest = line.replace(PARAGRAPH_RE, "").trimStart();
      return (
        <p key={key} className="ml-6 text-sm leading-relaxed text-foreground">
          <span className="mr-1.5 font-mono text-xs font-semibold text-secondary-text">
            {line.match(PARAGRAPH_RE)?.[0].trim()}
          </span>
          {linkifyText(rest, sectionMap, onJump)}
        </p>
      );
    }

    case "subpara": {
      const rest = line.replace(SUBPARA_RE, "").trimStart();
      return (
        <p
          key={key}
          className="ml-12 text-sm leading-relaxed text-secondary-text"
        >
          <span className="mr-1 font-mono text-xs text-muted-text">
            {line.match(SUBPARA_RE)?.[0].trim()}
          </span>
          {linkifyText(rest, sectionMap, onJump)}
        </p>
      );
    }

    case "note":
      return (
        <div
          key={key}
          className="my-2 ml-4 rounded-r border-l-2 border-info/40 bg-info/5 px-3 py-2 text-sm italic text-secondary-text"
        >
          {linkifyText(line, sectionMap, onJump)}
        </div>
      );

    case "penalty":
      return (
        <div
          key={key}
          className="my-2 ml-4 rounded-r border-l-2 border-warning/50 bg-warning/5 px-3 py-2 text-sm font-semibold text-warning"
        >
          {linkifyText(line, sectionMap, onJump)}
        </div>
      );

    case "example":
      return (
        <div
          key={key}
          className="my-2 ml-4 rounded-r border-l-2 border-success/40 bg-success/5 px-3 py-2 text-sm text-secondary-text"
        >
          {linkifyText(line, sectionMap, onJump)}
        </div>
      );

    default: // body
      return (
        <p key={key} className="text-sm leading-relaxed text-foreground">
          {linkifyText(line, sectionMap, onJump)}
        </p>
      );
  }
}

/**
 * Merge contiguous "body" lines that AustLII broke mid-sentence.
 *
 * AustLII text uses `\n` for visual line wrapping, not logical breaks.
 * E.g. "Section\n9 of the\nWar Precautions Act" should be one sentence.
 *
 * Strategy:
 *  - Keep structural lines (subsection, paragraph, note, etc.) separate.
 *  - Join consecutive body lines with a space.
 *  - Also append a trailing body line onto a preceding structural line
 *    (e.g. "(1)\nThe Acts…" becomes "(1) The Acts…" so it matches the
 *    subsection regex correctly).
 *  - Preserve blank lines as paragraph separators.
 */
function mergeContiguousBodyLines(text: string): string {
  const lines = text.split("\n");
  const merged: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Blank lines are preserved as separators
    if (!trimmed) {
      merged.push("");
      continue;
    }

    const type = classifyLine(trimmed);

    // Structural lines always start fresh
    if (type !== "body") {
      merged.push(trimmed);
      continue;
    }

    // Body line — try to merge with the previous non-blank line
    const prevIdx = merged.length - 1;
    if (prevIdx >= 0 && merged[prevIdx].trim()) {
      // Append to previous line (works for both body+body and structural+body)
      merged[prevIdx] = merged[prevIdx] + " " + trimmed;
      continue;
    }

    merged.push(trimmed);
  }

  return merged.join("\n");
}

function renderStatuteText(
  text: string,
  sectionMap: SectionMap,
  onJump: (id: string) => void,
): React.ReactNode[] {
  // text is already merged by SectionCard's cleanText memo
  return text
    .split("\n")
    .map((line, i) =>
      renderStatuteLine(line, classifyLine(line), i, sectionMap, onJump),
    );
}

// ── Search highlight rendering ─────────────────────────────────────────────

function renderWithHighlight(
  text: string,
  term: string,
  activeIdx: number,
  baseMatchOffset: number,
): React.ReactNode {
  if (!term || term.length < 2) {
    return (
      <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {text}
      </pre>
    );
  }
  const lower = text.toLowerCase();
  const termLower = term.toLowerCase();
  const parts: React.ReactNode[] = [];
  let pos = 0;
  let localIdx = 0;
  let idx = lower.indexOf(termLower);
  while (idx !== -1) {
    if (idx > pos) parts.push(text.slice(pos, idx));
    const globalIdx = baseMatchOffset + localIdx;
    parts.push(
      <mark
        key={`m-${idx}`}
        className={
          globalIdx === activeIdx
            ? "active-match rounded-sm bg-warning px-0.5 text-foreground"
            : "rounded-sm bg-warning/30 px-0.5"
        }
      >
        {text.slice(idx, idx + term.length)}
      </mark>,
    );
    pos = idx + term.length;
    localIdx++;
    idx = lower.indexOf(termLower, pos);
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return (
    <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {parts}
    </pre>
  );
}

// ── TOC sidebar ────────────────────────────────────────────────────────────

interface TocEntry {
  part: string;
  divisions: Map<string, LegislationSection[]>;
}

function buildToc(sections: LegislationSection[]): TocEntry[] {
  const parts: TocEntry[] = [];
  const partMap = new Map<string, TocEntry>();

  for (const s of sections) {
    const partKey = s.part || "General Provisions";
    const divKey = s.division || "";
    if (!partMap.has(partKey)) {
      const entry: TocEntry = {
        part: partKey,
        divisions: new Map<string, LegislationSection[]>(),
      };
      partMap.set(partKey, entry);
      parts.push(entry);
    }
    const entry = partMap.get(partKey)!;
    if (!entry.divisions.has(divKey)) entry.divisions.set(divKey, []);
    entry.divisions.get(divKey)!.push(s);
  }
  return parts;
}

interface TocSidebarProps {
  sections: LegislationSection[];
  activeId: string | null;
  onJump: (id: string) => void;
  expanded: boolean;
}

function TocSidebar({ sections, activeId, onJump, expanded }: TocSidebarProps) {
  const toc = useMemo(() => buildToc(sections), [sections]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const togglePart = useCallback((part: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  }, []);

  return (
    <nav
      className={cn(
        "overflow-y-auto border-r border-border bg-card",
        expanded ? "max-h-none" : "max-h-[calc(100vh-12rem)]",
      )}
    >
      <p className="sticky top-0 z-10 bg-card px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
        Contents
      </p>
      <div className="pb-3">
        {toc.map(({ part, divisions }) => {
          const isCollapsed = collapsed.has(part);
          return (
            <div key={part}>
              {/* Part heading */}
              <button
                onClick={() => togglePart(part)}
                className="flex w-full items-start gap-1 px-3 py-1.5 text-left hover:bg-surface"
              >
                <ChevronRight
                  className={cn(
                    "mt-0.5 h-3 w-3 shrink-0 text-muted-text transition-transform",
                    !isCollapsed && "rotate-90",
                  )}
                />
                <span className="text-[11px] font-semibold leading-tight text-secondary-text">
                  {part}
                </span>
              </button>

              {/* Divisions + sections */}
              {!isCollapsed &&
                Array.from(divisions.entries()).map(([div, secs]) => (
                  <div key={div || "__nodiv"}>
                    {div && (
                      <p className="ml-5 px-2 py-1 text-[10px] font-medium italic text-muted-text">
                        {div}
                      </p>
                    )}
                    {secs.map((s) => {
                      const isActive = activeId === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => onJump(s.id)}
                          className={cn(
                            "w-full border-l-2 py-1 pr-2 pl-6 text-left text-[11px] leading-snug transition-colors",
                            isActive
                              ? "border-accent bg-accent/5 font-medium text-accent"
                              : "border-transparent text-muted-text hover:bg-surface hover:text-foreground",
                          )}
                        >
                          <span className="font-mono text-[10px] font-bold">
                            {s.number}
                          </span>
                          {s.title ? (
                            <span className="ml-1.5 text-[10px] leading-tight opacity-80 line-clamp-2">
                              {s.title}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

// ── Section card ───────────────────────────────────────────────────────────

interface SectionCardProps {
  section: LegislationSection;
  searchTerm: string;
  activeMatchIdx: number;
  matchOffsetBefore: number; // how many global matches come before this section
  searching: boolean;
  sectionMap: SectionMap;
  onJump: (id: string) => void;
}

function SectionCard({
  section,
  searchTerm,
  activeMatchIdx,
  matchOffsetBefore,
  searching,
  sectionMap,
  onJump,
}: SectionCardProps) {
  // Strip the AustLII duplicate header, then merge mid-sentence line breaks
  const cleanText = useMemo(
    () => mergeContiguousBodyLines(stripAustliiHeader(section.text)),
    [section.text],
  );

  return (
    <div
      id={section.id}
      className="scroll-mt-4 rounded-lg border border-border bg-card"
    >
      {/* Section header */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2.5">
        <span className="font-mono text-sm font-bold text-accent">
          s {section.number}
        </span>
        {section.title && (
          <span className="font-heading text-sm font-semibold text-foreground">
            {section.title}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {section.division && (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {section.division.length > 28
                ? `${section.division.slice(0, 28)}…`
                : section.division}
            </span>
          )}
          {section.part && (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-text">
              {section.part.length > 20
                ? `${section.part.slice(0, 20)}…`
                : section.part}
            </span>
          )}
        </div>
      </div>

      {/* Section body */}
      <div className="px-4 py-3">
        {searching && searchTerm.length >= 2
          ? renderWithHighlight(
              cleanText,
              searchTerm,
              activeMatchIdx,
              matchOffsetBefore,
            )
          : renderStatuteText(cleanText, sectionMap, onJump)}
      </div>
    </div>
  );
}

// ── Main viewer ────────────────────────────────────────────────────────────

interface LegislationTextViewerProps {
  sections: LegislationSection[];
}

export function LegislationTextViewer({
  sections,
}: LegislationTextViewerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null,
  );

  // Build section number → id map for cross-reference links (memoised per sections list)
  const sectionMap = useMemo(() => buildSectionMap(sections), [sections]);

  const contentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Precompute cleaned text per section (same as SectionCard's cleanText)
  const cleanedTexts = useMemo(
    () =>
      sections.map((s) => mergeContiguousBodyLines(stripAustliiHeader(s.text))),
    [sections],
  );

  // ── Per-section match counts (for offset calculation) ─────────────────
  const sectionMatchCounts = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return sections.map(() => 0);
    const lower = searchTerm.toLowerCase();
    return cleanedTexts.map((cleaned) => {
      const text = cleaned.toLowerCase();
      let count = 0;
      let idx = text.indexOf(lower);
      while (idx !== -1) {
        count++;
        idx = text.indexOf(lower, idx + 1);
      }
      return count;
    });
  }, [searchTerm, cleanedTexts, sections]);

  const totalMatches = useMemo(
    () => sectionMatchCounts.reduce((a, b) => a + b, 0),
    [sectionMatchCounts],
  );

  const matchOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const c of sectionMatchCounts) {
      offsets.push(acc);
      acc += c;
    }
    return offsets;
  }, [sectionMatchCounts]);

  // Reset on search change
  useEffect(() => {
    setActiveMatchIdx(0);
  }, [totalMatches]);

  // Scroll active match into view
  useEffect(() => {
    if (totalMatches === 0) return;
    const el = contentRef.current?.querySelector(".active-match");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIdx, totalMatches]);

  // IntersectionObserver for active section
  useEffect(() => {
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      {
        root: contentRef.current,
        rootMargin: "0px 0px -70% 0px",
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
      if (totalMatches === 0) return;
      setActiveMatchIdx((prev) => (prev + dir + totalMatches) % totalMatches);
    },
    [totalMatches],
  );

  const jumpToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  }, []);

  const searching = showSearch && searchTerm.length >= 2;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Sections
        </h2>
        <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs text-muted-text">
          {sections.length}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Search field */}
          {showSearch ? (
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1">
              <Search className="h-3.5 w-3.5 text-muted-text" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goToMatch(e.shiftKey ? -1 : 1);
                }}
                placeholder="Search sections…"
                className="w-44 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-text"
              />
              {searching && totalMatches > 0 && (
                <span className="whitespace-nowrap text-xs text-muted-text">
                  {activeMatchIdx + 1}/{totalMatches}
                </span>
              )}
              {searching && totalMatches === 0 && searchTerm.length >= 2 && (
                <span className="whitespace-nowrap text-xs text-danger">
                  No results
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
              title="Search sections (⌘F)"
            >
              <Search className="h-4 w-4" />
            </button>
          )}

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-md p-1.5 text-muted-text hover:bg-surface hover:text-foreground"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* ── Body: TOC + Sections ─────────────────────────────────────── */}
      <div className="flex">
        {/* TOC sidebar */}
        <div className="w-56 flex-shrink-0">
          <TocSidebar
            sections={sections}
            activeId={activeId}
            onJump={jumpToSection}
            expanded={expanded}
          />
        </div>

        {/* Section content */}
        <div
          ref={contentRef}
          className={cn(
            "flex-1 overflow-auto border-l border-border",
            expanded ? "max-h-none" : "max-h-[calc(100vh-12rem)]",
          )}
        >
          <div className="space-y-3 p-4">
            {sections.map((section, idx) => (
              <SectionCard
                key={section.id}
                section={section}
                searchTerm={searchTerm}
                activeMatchIdx={activeMatchIdx}
                matchOffsetBefore={matchOffsets[idx] ?? 0}
                searching={searching}
                sectionMap={sectionMap}
                onJump={jumpToSection}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
