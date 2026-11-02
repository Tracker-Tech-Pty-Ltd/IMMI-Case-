/**
 * frontend/src/pages/LlmCouncilPage.tsx
 *
 * Thread-based LLM Council UI — desktop-rebuilt 2026-05-10.
 *
 * Layout philosophy (Sprint 3 polish):
 *  - Mobile (<md): single column, compact form, full-width controls.
 *  - Desktop (md+): 12-column grid — textarea + send button (col-span-8)
 *    on the left, sidebar (col-span-4) with sample prompts gallery,
 *    panel composition explainer, and tips on the right.
 *
 * Loading state ("CouncilDeliberationViz"):
 *  - Live elapsed timer (mm:ss) so user sees progress against the 5min cap
 *  - Three expert pills with staggered thinking-dot animation
 *  - SVG flow-bars converging from experts to moderator with animated
 *    stroke-dash flow particles
 *  - Rotating tip text every 4s (4 hints cycle)
 *  - Subtle gradient shimmer on the panel border
 *
 * Routes:
 *  /llm-council                          -> new session form
 *  /llm-council/sessions/:sessionId      -> thread view
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useParams,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import "@/styles/council-hero.css";
import {
  ArrowRight,
  Bot,
  Eraser,
  KeyRound,
  Lightbulb,
  Loader2,
  Scale,
  Send,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { getSession, restoreByCode } from "@/lib/api-llm-council";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { PageLoader } from "@/components/shared/PageLoader";
import { TurnCard } from "@/components/llm-council/TurnCard";
import {
  StreamingCouncilView,
  useCouncilStream,
} from "@/components/llm-council/StreamingCouncilView";
import { AchievementsContainer } from "@/components/llm-council/AchievementToast";
import {
  useLlmCouncilSession,
  useAddTurn,
} from "@/hooks/use-llm-council-sessions";
import { useAuth } from "@/contexts/AuthContext";
import {
  fireSubmitGavelBurst,
  fireCouncilDoneCelebration,
  isSoundOn,
  toggleSound,
  playCue,
  playHaptic,
  recordCouncilRun,
  unlockRobeTheme,
  isRobeThemeUnlocked,
  getCouncilStats,
  type Achievement,
} from "@/lib/council-celebrations";

const MAX_TURNS = 15;
const MAX_MESSAGE_CHARS = 8000;

// ---------------------------------------------------------------------------
// Inline keyframes for loading animation. Defined once at module scope as a
// string and injected via a single <style> tag inside the indicator. Scoped
// names (councilThinkingDot etc.) avoid collision with global tokens.css.
// ---------------------------------------------------------------------------

const COUNCIL_KEYFRAMES = `
@keyframes councilThinkingDot {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.1); }
}
@keyframes councilFlow {
  0% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -24; }
}
@keyframes councilShimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes councilFloatIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

// ---------------------------------------------------------------------------
// Sample prompts gallery — clickable starter questions.
// ---------------------------------------------------------------------------

const SAMPLE_PROMPTS = [
  {
    title: "Visa cancellation — procedural fairness",
    body:
      "What are the strongest jurisdictional error grounds for AAT review " +
      "of a visa cancellation where the decision-maker may have breached " +
      "s 359A by failing to put adverse credibility findings to the applicant? " +
      "Cite specific Migration Act sections and recent AAT/Federal Court precedents.",
  },
  {
    title: "Protection visa — country information",
    body:
      "A Protection visa (subclass 866) was refused based on a 2018 DFAT " +
      "report that contradicts more recent UNHCR guidance. The country " +
      "information was not put to the applicant. Identify s 424A " +
      "jurisdictional error grounds and the strongest counter-arguments " +
      "the Department would raise (SZBYR limitation).",
  },
  {
    title: "Partner visa — relationship credibility",
    body:
      "Apply to the AAT for review of a Partner visa (subclass 820/801) " +
      "refusal where credibility findings about the relationship under " +
      "reg 1.15A are central. What evidence and arguments best counter " +
      "adverse credibility conclusions?",
  },
  {
    title: "Section 5J(3) — past torture credibility",
    body:
      "How does s 5J(3) Migration Act 1958 apply to credibility assessment " +
      "where the applicant alleges past torture but provides inconsistent " +
      "dates? What is the mandatory analytical framework, and what is the " +
      "consequence of failing to apply it?",
  },
] as const;

// ---------------------------------------------------------------------------
// CouncilDeliberationViz — Sprint 3 polish loading state
// ---------------------------------------------------------------------------

const RUNNING_PROVIDERS = [
  { key: "openai", label: "OpenAI", color: "#10a37f" },
  { key: "gemini", label: "Gemini Pro", color: "#4285f4" },
  { key: "anthropic", label: "Claude Sonnet", color: "#cc785c" },
] as const;

const TIPS = [
  "Heavy legal prompts can take 90s-3min. Three experts deliberate in parallel, then the moderator synthesises.",
  "Cite specific section numbers (e.g. s 5J(3), s 424A) for sharper expert analysis.",
  "The moderator extracts statute citations into a cross-reference table — look for shared overlap %.",
  "Each session supports up to 15 follow-up turns. Use them to drill into specific grounds.",
];

function CouncilDeliberationViz() {
  const { t } = useTranslation();
  const [elapsedSec, setElapsedSec] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);

  useEffect(() => {
    const tickId = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    const tipId = setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 4000);
    return () => {
      clearInterval(tickId);
      clearInterval(tipId);
    };
  }, []);

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border/80 bg-card p-5 shadow-sm"
      data-testid="council-running-indicator"
      role="status"
      aria-live="polite"
      aria-label="Council deliberating"
    >
      <style dangerouslySetInnerHTML={{ __html: COUNCIL_KEYFRAMES }} />

      {/* Top-edge shimmer to suggest live activity */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, var(--color-accent, #d4a017) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "councilShimmer 2s linear infinite",
          opacity: 0.6,
        }}
      />

      {/* Header row — status + timer */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="animate-spin">
            <Loader2 className="h-4 w-4 text-accent" />
          </div>
          <span className="text-sm font-semibold text-foreground">
            {t("llm_council.deliberating", {
              defaultValue: "Council deliberating",
            })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-text">
            {t("llm_council.elapsed", { defaultValue: "Elapsed" })}
          </span>
          <span
            className="rounded-md bg-surface px-2.5 py-1 font-mono text-sm tabular-nums text-foreground"
            data-testid="council-elapsed-timer"
          >
            {mm}:{ss}
          </span>
        </div>
      </div>

      {/* Visualization — three experts pipeline -> moderator */}
      <div className="space-y-3">
        {/* Expert row */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {RUNNING_PROVIDERS.map((p, idx) => (
            <ExpertPill
              key={p.key}
              label={p.label}
              color={p.color}
              delayMs={idx * 150}
              testId={`running-avatar-${p.key}`}
            />
          ))}
        </div>

        {/* SVG flow rails — three lines converging to moderator */}
        <svg
          viewBox="0 0 600 60"
          className="h-12 w-full"
          aria-hidden
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="flowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--color-accent, #d4a017)" stopOpacity="0.1" />
              <stop offset="100%" stopColor="var(--color-accent, #d4a017)" stopOpacity="0.7" />
            </linearGradient>
          </defs>
          {/* Three converging paths */}
          {[100, 300, 500].map((sx, i) => (
            <path
              key={i}
              d={`M ${sx} 0 Q ${sx} 30, 300 60`}
              fill="none"
              stroke="url(#flowGrad)"
              strokeWidth="1.5"
              strokeDasharray="4 8"
              style={{
                animation: `councilFlow ${1.4 + i * 0.2}s linear infinite`,
              }}
            />
          ))}
        </svg>

        {/* Moderator row */}
        <div className="flex justify-center">
          <ModeratorPill />
        </div>
      </div>

      {/* Rotating tip */}
      <div
        className="mt-5 flex items-start gap-2 rounded-md border border-dashed border-border bg-surface/40 p-3"
        key={tipIdx}
        style={{ animation: "councilFloatIn 0.4s ease-out" }}
      >
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <p className="text-xs leading-relaxed text-muted-text">
          <span className="font-semibold uppercase tracking-wide text-foreground">
            {t("llm_council.tip_label", { defaultValue: "Tip" })}:
          </span>{" "}
          {TIPS[tipIdx]}
        </p>
      </div>
    </div>
  );
}

interface ExpertPillProps {
  label: string;
  color: string;
  delayMs: number;
  testId?: string;
}

function ExpertPill({ label, color, delayMs, testId }: ExpertPillProps) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-1.5 rounded-lg border border-border/80 bg-surface/40 px-2 py-3"
    >
      <div
        className="grid h-8 w-8 place-items-center rounded-full"
        style={{ backgroundColor: `${color}1A`, color }}
      >
        <Bot className="h-4 w-4" />
      </div>
      <span className="line-clamp-1 text-[11px] font-medium text-foreground sm:text-xs">
        {label}
      </span>
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full"
            style={{
              backgroundColor: color,
              animation: "councilThinkingDot 1.2s ease-in-out infinite",
              animationDelay: `${delayMs + i * 150}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ModeratorPill() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="running-avatar-moderator"
      className="flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-50/40 px-4 py-2 dark:border-amber-700/60 dark:bg-amber-900/15"
    >
      <div
        className="grid h-7 w-7 place-items-center rounded-full bg-amber-400/25 text-amber-700 dark:text-amber-300"
        style={{
          animation: "councilThinkingDot 1.6s ease-in-out infinite",
        }}
      >
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-foreground">
          {t("llm_council.running_moderator_label", {
            defaultValue: "Moderator",
          })}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-text">
          {t("llm_council.awaiting_label", { defaultValue: "Awaiting panel" })}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PromptSidebar — desktop sidebar with samples + panel composition + tips
// ---------------------------------------------------------------------------

interface PromptSidebarProps {
  onSelectPrompt: (body: string) => void;
}

function PromptSidebar({ onSelectPrompt }: PromptSidebarProps) {
  const { t } = useTranslation();
  const prompts = [
    { title: t("llm_council.sample_1_title", { defaultValue: SAMPLE_PROMPTS[0].title }), body: t("llm_council.sample_1_body", { defaultValue: SAMPLE_PROMPTS[0].body }) },
    { title: t("llm_council.sample_2_title", { defaultValue: SAMPLE_PROMPTS[1].title }), body: t("llm_council.sample_2_body", { defaultValue: SAMPLE_PROMPTS[1].body }) },
    { title: t("llm_council.sample_3_title", { defaultValue: SAMPLE_PROMPTS[2].title }), body: t("llm_council.sample_3_body", { defaultValue: SAMPLE_PROMPTS[2].body }) },
    { title: t("llm_council.sample_4_title", { defaultValue: SAMPLE_PROMPTS[3].title }), body: t("llm_council.sample_4_body", { defaultValue: SAMPLE_PROMPTS[3].body }) },
  ];
  return (
    <aside className="space-y-4">
      {/* Sample prompts */}
      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t("llm_council.sidebar_sample_prompts", {
              defaultValue: "Sample Prompts",
            })}
          </h3>
        </div>
        <ul className="space-y-2">
          {prompts.map((p) => (
            <li key={p.title}>
              <button
                type="button"
                onClick={() => onSelectPrompt(p.body)}
                className="group block w-full rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-surface/50"
              >
                <p className="line-clamp-1 text-xs font-semibold text-foreground group-hover:text-accent">
                  {p.title}
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-text">
                  {p.body}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Panel composition */}
      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t("llm_council.sidebar_panel_title", {
              defaultValue: "Panel Composition",
            })}
          </h3>
        </div>
        <ul className="space-y-2 text-xs text-muted-text">
          {RUNNING_PROVIDERS.map((p) => (
            <li key={p.key} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-foreground">{p.label}</span>
              <span className="text-muted-text">— {t("llm_council.sidebar_role_expert", { defaultValue: "expert" })}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 border-t border-border pt-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            <span className="text-foreground">
              {t("llm_council.chairman_label", {
                defaultValue: "Council Chairman",
              })}
            </span>
            <span className="text-muted-text">— {t("llm_council.sidebar_role_synthesis", { defaultValue: "synthesis" })}</span>
          </li>
        </ul>
      </div>

      {/* Quick tips */}
      <div className="rounded-xl border border-dashed border-border bg-surface/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb className="h-3.5 w-3.5 text-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t("llm_council.sidebar_tips_title", {
              defaultValue: "Quick Tips",
            })}
          </h3>
        </div>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-text">
          <li>• {t("llm_council.sidebar_tip_citations", { defaultValue: "Cite section numbers and case names for sharper output." })}</li>
          <li>• {t("llm_council.sidebar_tip_wait", { defaultValue: "Complex questions can take 2–3 minutes." })}</li>
          <li>• {t("llm_council.sidebar_tip_turns", { defaultValue: "Up to 15 follow-up turns per session." })}</li>
          <li>• {t("llm_council.sidebar_tip_shortcut", { defaultValue: "Cmd/Ctrl+Enter submits." })}</li>
        </ul>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// iOS detection (Slice H) — the on-screen keyboard on iOS Safari/iPadOS has
// no Cmd/Ctrl key, so the Cmd+Enter submit shortcut is unreachable there.
// Physical-keyboard iPads still work fine with Cmd+Enter, but we can't tell
// "has a physical keyboard attached" from userAgent alone, so the inline
// hint is shown for the whole iOS family — worst case a physical-keyboard
// iPad user sees a redundant hint, which is harmless.
// ---------------------------------------------------------------------------

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports its userAgent as desktop Safari ("Macintosh…") but
  // is still touch-driven — maxTouchPoints > 1 distinguishes it from an
  // actual Mac.
  return ua.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1;
}

// Swipe-to-send: horizontal drag distance (px) on the send handle that
// counts as a deliberate swipe rather than an accidental touch wobble.
const SWIPE_TO_SEND_THRESHOLD_PX = 48;

// ---------------------------------------------------------------------------
// MessageInput — shared composer for new session + follow-up
// ---------------------------------------------------------------------------

interface MessageInputProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  disabled?: boolean;
  placeholder: string;
  rows?: number;
  maxChars?: number;
  /** When true, autofocus on mount (used by ThreadView follow-up). */
  autoFocus?: boolean;
}

function MessageInput({
  id,
  value,
  onChange,
  onSubmit,
  isPending,
  disabled = false,
  placeholder,
  rows = 5,
  maxChars = MAX_MESSAGE_CHARS,
  autoFocus = false,
}: MessageInputProps) {
  const { t } = useTranslation();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [isIos] = useState(() => isIosDevice());
  const swipeStartXRef = useRef<number | null>(null);
  const [swipeActive, setSwipeActive] = useState(false);

  useEffect(() => {
    if (autoFocus && taRef.current) {
      taRef.current.focus();
    }
  }, [autoFocus]);

  function canSubmit(): boolean {
    return !disabled && !isPending && value.trim().length > 0;
  }

  // Cmd/Ctrl+Enter submits — unreachable on iOS's on-screen keyboard, which
  // is why the iOS hint + swipe-to-send handle below exist as fallbacks.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSubmit()) {
        onSubmit();
      }
    }
  }

  // Swipe-to-send — roll-our-own touch tracking on a dedicated handle so
  // desktop mouse drag/selection inside the textarea itself is untouched.
  // A plain tap still submits via onClick (keeps the handle keyboard/mouse
  // accessible); the touch handlers additionally recognise a deliberate
  // rightward swipe as the same action.
  function handleSwipeTouchStart(e: React.TouchEvent<HTMLButtonElement>) {
    swipeStartXRef.current = e.touches[0]?.clientX ?? null;
    setSwipeActive(true);
  }

  function handleSwipeTouchEnd(e: React.TouchEvent<HTMLButtonElement>) {
    const startX = swipeStartXRef.current;
    swipeStartXRef.current = null;
    setSwipeActive(false);
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? startX;
    if (endX - startX >= SWIPE_TO_SEND_THRESHOLD_PX && canSubmit()) {
      onSubmit();
    }
  }

  function handleSwipeTouchCancel() {
    swipeStartXRef.current = null;
    setSwipeActive(false);
  }

  const charCount = value.length;
  const overLimit = charCount > maxChars * 0.9;
  const showSwipeToSend = value.trim().length > 5 && !isPending && !disabled;

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          id={id}
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={rows}
          maxLength={maxChars}
          disabled={disabled || isPending}
          placeholder={placeholder}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 pr-12 text-base leading-relaxed text-foreground outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        />
        {value.length > 0 && !isPending ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={t("llm_council.clear_input", { defaultValue: "Clear question" })}
            className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-md text-muted-text transition-colors hover:text-foreground"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {showSwipeToSend ? (
          <button
            type="button"
            data-testid="swipe-to-send-handle"
            aria-label={t("llm_council.swipe_to_send_label", {
              defaultValue: "Swipe right, or tap, to submit your question",
            })}
            onClick={() => canSubmit() && onSubmit()}
            onTouchStart={handleSwipeTouchStart}
            onTouchEnd={handleSwipeTouchEnd}
            onTouchCancel={handleSwipeTouchCancel}
            className={`absolute bottom-2 right-2 grid h-11 w-11 place-items-center rounded-full bg-accent text-on-solid shadow-sm transition-transform duration-150 hover:bg-accent/90 ${
              swipeActive ? "scale-110" : "scale-100"
            }`}
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-text">
          {isIos ? (
            <span data-testid="ios-send-hint">
              {t("llm_council.ios_send_hint", {
                defaultValue: "Tap Send button (no Cmd+Enter on iOS)",
              })}
            </span>
          ) : (
            <>
              <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px]">
                Cmd
              </kbd>
              <span className="mx-1">+</span>
              <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px]">
                Enter
              </kbd>
              <span className="ml-2">
                {t("llm_council.kbd_hint", { defaultValue: "to send" })}
              </span>
            </>
          )}
        </span>
        <span
          className={`text-[11px] tabular-nums ${
            overLimit ? "text-amber-600 dark:text-amber-400" : "text-muted-text"
          }`}
        >
          {charCount} / {maxChars}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RestoreByCodeRibbon — Task C UX. Lets a returning user paste a 6-char
// recall code and jump back into their saved conversation.
// ---------------------------------------------------------------------------

const RECALL_CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/;

function RestoreByCodeRibbon() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalised = code.trim().toUpperCase();
  const isValidShape = RECALL_CODE_RE.test(normalised);

  async function handleRestore(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!isValidShape) {
      setError(t("llm_council.restore_invalid_code", { defaultValue: "Code must be 6 characters (letters and digits, no 0/O/1/I/L)." }));
      return;
    }

    setBusy(true);
    try {
      const result = await restoreByCode(normalised);
      playHaptic();
      // Token already persisted by the api fetcher — navigate into the session view.
      navigate(`/llm-council/sessions/${result.session_id}`);
    } catch (err) {
      const msg = (err as Error).message || t("llm_council.restore_failed", { defaultValue: "Restore failed" });
      // 404 → "Code not found"; 400 → validation. Surface as-is.
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <form
      data-testid="restore-by-code-ribbon"
      onSubmit={handleRestore}
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-surface/30 px-4 py-3 shadow-sm"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-text">
        <KeyRound className="h-3.5 w-3.5 text-accent" />
        <span>{t("llm_council.restore_returning", { defaultValue: "Returning?" })}</span>
      </div>
      <input
        type="text"
        value={code}
        onChange={(e) => {
          // Auto-uppercase + strip whitespace so "k3q9 xm" pastes cleanly
          const next = e.target.value.replace(/\s+/g, "").toUpperCase().slice(0, 6);
          setCode(next);
          if (error) setError(null);
        }}
        placeholder="K3Q9XM"
        maxLength={6}
        autoComplete="off"
        spellCheck={false}
        aria-label={t("llm_council.restore_code_label", { defaultValue: "6-character recall code" })}
        data-testid="restore-by-code-input"
        className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-center font-mono text-sm font-bold tracking-[0.2em] uppercase text-foreground outline-none transition-colors focus:border-accent"
      />
      <button
        type="submit"
        disabled={busy || !isValidShape}
        data-testid="restore-by-code-submit"
        className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <>
            <div className="animate-spin">
              <Loader2 className="h-3 w-3" />
            </div>
            {t("llm_council.restoring", { defaultValue: "Restoring…" })}
          </>
        ) : (
          <>
            <KeyRound className="h-3 w-3" />
            {t("llm_council.restore_conversation", { defaultValue: "Restore conversation" })}
          </>
        )}
      </button>
      <span className="text-[11px] text-muted-text">
        {t("llm_council.restore_help", { defaultValue: "Have a recall code from a previous session? Enter it to continue." })}
      </span>
      {error ? (
        <span
          role="alert"
          data-testid="restore-by-code-error"
          className="w-full rounded-md border border-amber-300/50 bg-amber-50/40 px-2 py-1 text-[11px] text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300"
        >
          {error}
        </span>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// NewSessionForm — desktop two-column / mobile single-column
// ---------------------------------------------------------------------------

interface NewSessionFormProps {
  onAchievements: (list: Achievement[]) => void;
  onRunComplete: () => void;
}

function AuthRequiredNotice() {
  return (
    <section
      data-testid="llm-council-auth-required"
      className="rounded-xl border border-border/80 bg-card p-6 shadow-sm"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Sign in to run the LLM IMMI Council
          </p>
          <p className="text-sm leading-relaxed text-muted-text">
            Council sessions are saved under your tenant so follow-up turns and
            recall codes stay private.
          </p>
        </div>
        <Link
          to="/login"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <KeyRound className="h-4 w-4" />
          Sign in
        </Link>
      </div>
    </section>
  );
}

function NewSessionForm({ onAchievements, onRunComplete }: NewSessionFormProps) {
  const { t } = useTranslation();
  const localDemo = import.meta.env.DEV && import.meta.env.VITE_COUNCIL_DEMO === "true";
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [searchParams] = useSearchParams();
  // Seed from ?case_id= so a case-reader "Ask the Council about this case"
  // link (see CaseDetailPage.tsx) lands with the anchor already filled in.
  const [caseId, setCaseId] = useState(() => searchParams.get("case_id") || "");
  const [submitError, setSubmitError] = useState("");
  const stream = useCouncilStream();
  const celebratedDoneRef = useRef(false);
  const openRequestRef = useRef(0);
  const [openingSession, setOpeningSession] = useState(false);
  const [openSessionError, setOpenSessionError] = useState("");
  useEffect(() => () => { openRequestRef.current += 1; }, []);

  const hasStreamed =
    stream.isStreaming ||
    stream.state.openai.status !== "pending" ||
    stream.state.gemini_pro.status !== "pending" ||
    stream.state.anthropic.status !== "pending";
  const anyExpertOk = [stream.state.openai, stream.state.gemini_pro, stream.state.anthropic]
    .some((expert) => expert.status === "done" && expert.text.trim().length > 0);

  // Fire council-done celebration once when stream reaches done state.
  // Mirror the ThreadView contract: only celebrate when the panel actually
  // produced a useful answer. Streams can reach "done" with all 3 experts
  // errored or moderator unsuccessful — that's a failure, not a victory.
  useEffect(() => {
    if (
      stream.state.council.status === "done" &&
      !celebratedDoneRef.current
    ) {
      celebratedDoneRef.current = true;
      const moderatorOk = stream.state.moderator.status === "complete" && stream.state.moderator.data?.success === true;
      if (anyExpertOk && moderatorOk && !localDemo) {
        fireCouncilDoneCelebration();
        playCue("verdict");
        const unlocked = recordCouncilRun();
        if (unlocked.length > 0) onAchievements(unlocked);
        onRunComplete();
      }
    }
  }, [
    stream.state.council.status,
    anyExpertOk,
    stream.state.moderator.status,
    stream.state.moderator.data?.success,
    localDemo,
    onAchievements,
    onRunComplete,
  ]);

  async function handleSend() {
    const msg = message.trim();
    if (!msg) return;
    openRequestRef.current += 1;
    setOpeningSession(false);
    setOpenSessionError("");
    setSubmitError("");
    // Submit-moment gavel ritual — haptic covers every submit route (Send
    // button click, Cmd/Ctrl+Enter, swipe/tap on the mobile send handle)
    // since they all funnel through this shared handleSend.
    fireSubmitGavelBurst();
    playCue("gavel");
    playHaptic();
    celebratedDoneRef.current = false;
    try {
      await stream.start({
        message: msg,
        case_id: caseId.trim() || undefined,
      });
    } catch (err) {
      setSubmitError(
        (err as Error).message ||
          t("llm_council.request_failed", {
            defaultValue: "LLM council request failed",
          }),
      );
    }
  }

  function handleReset() {
    openRequestRef.current += 1;
    setOpeningSession(false);
    setOpenSessionError("");
    stream.reset();
    setSubmitError("");
    celebratedDoneRef.current = false;
  }

  async function handleOpenConversation() {
    const id = stream.state.session.sessionId;
    if (!id || openingSession) return;
    const request = ++openRequestRef.current;
    setOpeningSession(true);
    setOpenSessionError("");
    try {
      const saved = await getSession(id);
      if (request !== openRequestRef.current) return;
      if (!saved || saved.session?.session_id !== id || !Array.isArray(saved.turns) || saved.turns.length === 0) {
        setOpenSessionError(t("llm_council.conversation_not_ready", { defaultValue: "The conversation is not available yet. Please try again." }));
        return;
      }
      navigate(`/llm-council/sessions/${encodeURIComponent(id)}`);
    } catch {
      if (request === openRequestRef.current) {
        setOpenSessionError(t("llm_council.conversation_not_ready", { defaultValue: "The conversation is not available yet. Please try again." }));
      }
    } finally {
      if (request === openRequestRef.current) setOpeningSession(false);
    }
  }

  if (isLoading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <AuthRequiredNotice />;
  }

  return (
    <div className="grid gap-6 md:grid-cols-12">
      {/* Form column — col-span-8 on md+, col-span-12 on mobile */}
      <section className="md:col-span-8">
        {/* Task C — Restore by code ribbon. Surfaced ABOVE the form so a
            returning user sees it before starting a fresh session.
            Hidden once the user starts streaming so it doesn't compete
            with live council output. */}
        {!localDemo && !stream.isStreaming &&
        stream.state.openai.status === "pending" &&
        stream.state.gemini_pro.status === "pending" &&
        stream.state.anthropic.status === "pending" ? (
          <RestoreByCodeRibbon />
        ) : null}

        <div className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="space-y-5"
          >
            <div>
              <label htmlFor="council-question" className="mb-2 block text-sm font-semibold text-foreground">
                {t("llm_council.question_label", {
                  defaultValue: "Legal Research Question",
                })}
              </label>
              <MessageInput
                id="council-question"
                value={message}
                onChange={setMessage}
                onSubmit={handleSend}
                isPending={stream.isStreaming}
                rows={6}
                placeholder={t("llm_council.question_placeholder", {
                  defaultValue:
                    "Example: Compare strongest review grounds for visa cancellation where procedural fairness may be breached. Cite section numbers and case names for sharper output.",
                })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="council-case-id" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-text">
                  {t("llm_council.case_id_label", {
                    defaultValue: "Case ID (optional)",
                  })}
                </label>
                <input
                  id="council-case-id"
                  type="text"
                  disabled={localDemo}
                  value={caseId}
                  onChange={(e) => setCaseId(e.target.value)}
                  placeholder="12-char hex id"
                  className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-base text-foreground outline-none transition-colors focus:border-accent sm:text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-text">
                  {localDemo ? t("llm_council.local_demo_case_hint", { defaultValue: "The demonstration does not load real cases." }) : t("llm_council.case_id_help", {
                    defaultValue:
                      "If provided, the case context is auto-included in the prompt.",
                  })}
                </p>
              </div>

              <div className="flex items-end justify-end">
                <button
                  type="submit"
                  disabled={stream.isStreaming || !message.trim()}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-on-solid shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {stream.isStreaming ? (
                    <>
                      <div className="animate-spin">
                        <Loader2 className="h-4 w-4" />
                      </div>
                      {t("llm_council.running_btn", {
                        defaultValue: "Running Council...",
                      })}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t("llm_council.send_btn", { defaultValue: "Send" })}
                    </>
                  )}
                </button>
              </div>
            </div>

            {submitError ? <ApiErrorState message={submitError} /> : null}
          </form>

          {/* Live streaming viz — shown during AND after streaming so the
              user can review the final 3-column output without losing it. */}
          {hasStreamed ? (
            <div className="mt-6 space-y-3">
              <StreamingCouncilView state={stream.state} />
              {!stream.isStreaming ? (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {stream.state.council.status === "done" && anyExpertOk && stream.state.session.sessionId ? (
                    <button
                      type="button"
                      onClick={() => { void handleOpenConversation(); }}
                      disabled={openingSession}
                      className="rounded-md border border-accent bg-card px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface"
                    >
                      {openingSession ? t("llm_council.opening_conversation", { defaultValue: "Opening conversation…" }) : t("llm_council.open_conversation", { defaultValue: "Open conversation to follow up" })}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-md border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface"
                  >
                    {t("llm_council.start_new_btn", {
                      defaultValue: "Start a new session",
                    })}
                  </button>
                </div>
              ) : null}
              {openSessionError ? <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{openSessionError}</p> : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Sidebar — col-span-4 on md+ */}
      <div className="md:col-span-4">
        <PromptSidebar onSelectPrompt={(body) => setMessage(body)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThreadView — session-thread display + follow-up composer
// ---------------------------------------------------------------------------

interface ThreadViewProps {
  sessionId: string;
  onAchievements: (list: Achievement[]) => void;
  onRunComplete: () => void;
}

function ThreadView({
  sessionId,
  onAchievements,
  onRunComplete,
}: ThreadViewProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [submitError, setSubmitError] = useState("");
  const followUpRef = useRef<HTMLElement | null>(null);

  const { data, isLoading, isError, error } = useLlmCouncilSession(sessionId);
  const addTurn = useAddTurn(sessionId);

  const session = data?.session;
  const turns = data?.turns ?? [];
  const totalTurns = session?.total_turns ?? turns.length;
  const atLimit = totalTurns >= MAX_TURNS;

  async function handleSend() {
    const msg = input.trim();
    if (!msg || atLimit) return;
    setSubmitError("");
    fireSubmitGavelBurst();
    playCue("gavel");
    playHaptic();
    try {
      const result = await addTurn.mutateAsync({ message: msg });
      setInput("");
      // Only celebrate when the council actually succeeded. addTurn resolves
      // on HTTP 200 even when {moderator.success:false, opinions:[all errored]}.
      // Celebrating a failure misleads the user, fires confetti for nothing,
      // and contaminates the achievement counter. Require both: moderator
      // synthesised something AND at least one expert produced an answer.
      const moderatorOk = result?.turn?.moderator?.success === true;
      const anyExpertOk = (result?.turn?.opinions || []).some(
        (o) => o?.success === true,
      );
      if (moderatorOk && anyExpertOk && !(import.meta.env.DEV && import.meta.env.VITE_COUNCIL_DEMO === "true")) {
        fireCouncilDoneCelebration();
        playCue("verdict");
        const unlocked = recordCouncilRun();
        if (unlocked.length > 0) onAchievements(unlocked);
        onRunComplete();
      }
    } catch (err) {
      setSubmitError(
        (err as Error).message ||
          t("llm_council.request_failed", {
            defaultValue: "LLM council request failed",
          }),
      );
    }
  }

  if (isLoading) {
    return <PageLoader />;
  }

  if (isError) {
    return (
      <ApiErrorState
        message={
          (error as Error)?.message ||
          t("llm_council.session_load_failed", {
            defaultValue: "Failed to load session",
          })
        }
      />
    );
  }

  if (!data) {
    return (
      <ApiErrorState
        message={t("llm_council.session_not_found", {
          defaultValue: "Session not found",
        })}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Turn thread */}
      <div className="space-y-8">
        {turns.map((turn, idx) => (
          <TurnCard key={turn.turn_id} turn={turn} turnNumber={idx + 1}
            followUpDisabled={atLimit || addTurn.isPending}
            onSelectFollowUp={(question) => {
              const next = input.trim() ? `${input}${input.endsWith("\n") ? "" : "\n"}${question}` : question;
              if (next.length > MAX_MESSAGE_CHARS) {
                setSubmitError(t("llm_council.suggested_question_too_long", {
                  defaultValue: "There is not enough room to add this question to your draft.",
                }));
                followUpRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
                followUpRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
                return;
              }
              setSubmitError("");
              setInput(next);
              followUpRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
              followUpRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
            }} />
        ))}
      </div>

      {/* Pending indicator while addTurn is in flight */}
      {addTurn.isPending ? <CouncilDeliberationViz /> : null}

      {/* Follow-up input */}
      <section ref={followUpRef} className="rounded-xl border border-border/80 bg-card p-5 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="council-follow-up" className="text-xs font-semibold uppercase tracking-wide text-muted-text">
              {t("llm_council.follow_up_input_label", {
                defaultValue: "Follow-up question",
              })}
            </label>
            <span
              data-testid="turn-count-badge"
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                atLimit
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                  : "bg-surface text-muted-text"
              }`}
            >
              {t("llm_council.turn_count_label", { defaultValue: "Turn" })}{" "}
              {totalTurns}/{MAX_TURNS}
            </span>
          </div>

          <MessageInput
            id="council-follow-up"
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            isPending={addTurn.isPending}
            disabled={atLimit}
            rows={3}
            placeholder={
              atLimit
                ? t("llm_council.turn_limit_placeholder", {
                    defaultValue: "Turn limit reached (15/15)",
                  })
                : t("llm_council.follow_up_placeholder", {
                    defaultValue:
                      "Ask a follow-up question — drill into a specific ground, request more case citations, or test counter-arguments...",
                  })
            }
          />

          <div className="flex flex-wrap items-center justify-end gap-3">
            {atLimit ? (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                {t("llm_council.turn_limit_reached", {
                  defaultValue:
                    "You have reached the maximum of 15 turns for this session.",
                })}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={atLimit || addTurn.isPending || !input.trim()}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 py-2 text-sm font-semibold text-on-solid shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              {addTurn.isPending ? (
                <>
                  <div className="animate-spin">
                    <Loader2 className="h-4 w-4" />
                  </div>
                  {t("llm_council.running_btn", {
                    defaultValue: "Running Council...",
                  })}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {t("llm_council.send_btn", { defaultValue: "Send" })}
                </>
              )}
            </button>
          </div>

          {submitError ? <ApiErrorState message={submitError} /> : null}
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LlmCouncilPage (exported)
// ---------------------------------------------------------------------------

export function LlmCouncilPage() {
  const { t } = useTranslation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { isAuthenticated, isLoading } = useAuth();

  // Easter-egg: tap the Scale icon 5x to unlock the "robe" theme
  const [scaleTapCount, setScaleTapCount] = useState(0);
  const [robeUnlocked, setRobeUnlocked] = useState(() => isRobeThemeUnlocked());

  // Sound on/off (Web Audio cues — gavel/ding/verdict). Default OFF.
  const [soundOn, setSoundOn] = useState(() => isSoundOn());

  // Persistent stats — shown subtly in the hero subtitle
  const [stats, setStats] = useState(() => getCouncilStats());

  // Achievements toast queue
  const [achievements, setAchievements] = useState<Achievement[]>([]);

  function handleScaleTap() {
    setScaleTapCount((n) => {
      const next = n + 1;
      if (next >= 5 && !robeUnlocked) {
        unlockRobeTheme();
        setRobeUnlocked(true);
        setAchievements((prev) => [
          ...prev,
          {
            id: "robe-unlock",
            title: "The Robe Awakens",
            body: "You found the hidden chamber. Welcome, your honour.",
            emoji: "🥷",
          },
        ]);
      }
      return next;
    });
    playCue("tap");
  }

  function handleSoundToggle() {
    const next = toggleSound();
    setSoundOn(next);
    if (next) playCue("ding");
  }

  function handleDismissAchievement(id: string) {
    setAchievements((prev) => prev.filter((a) => a.id !== id));
  }

  function pushAchievements(list: Achievement[]) {
    if (list.length === 0) return;
    setAchievements((prev) => [...prev, ...list]);
  }

  function refreshStats() {
    setStats(getCouncilStats());
  }

  if (sessionId === "new") {
    return <Navigate to="/llm-council" replace />;
  }

  return (
    <div className="space-y-8">
      {import.meta.env.DEV && import.meta.env.VITE_COUNCIL_DEMO === "true" ? (
        <div role="status" className="rounded-md border border-accent bg-surface p-4 text-sm font-semibold text-foreground" data-testid="council-demo-notice">
          {t("llm_council.local_demo_notice", { defaultValue: "Local demonstration: example responses only, not real AI or legal advice. Do not enter personal information." })}
        </div>
      ) : null}
      {/* Hero — custom oversized block. Icon scales with title height
          (clamp 4-5.5rem). Subtitle drops upstream model provider names;
          panel surfaces as a unified Council Chairman + 3 experts. */}
      <section
        className="council-hero relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8"
        data-testid="llm-council-hero"
      >
        <div className="council-hero-atmosphere" aria-hidden="true">
          <div className="council-hero-orbit council-hero-orbit-outer"><span /></div>
          <div className="council-hero-orbit council-hero-orbit-inner"><span /></div>
          <div className="council-hero-core"><Scale /></div>
        </div>
        {/* Subtle accent gradient bar at the bottom edge for depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--color-accent, #d4a017) 50%, transparent)",
            opacity: 0.5,
          }}
        />
        {/* Robe-theme easter-egg overlay: subtle navy diagonal stripes */}
        {robeUnlocked ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(27,40,56,0.04), rgba(27,40,56,0.04) 8px, transparent 8px, transparent 16px)",
            }}
          />
        ) : null}

        <div className="council-hero-content relative flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleScaleTap}
            aria-label="Council emblem"
            className="group relative flex shrink-0 items-center justify-center rounded-2xl bg-accent-muted text-accent shadow-sm ring-1 ring-accent/20 transition-all hover:scale-105 hover:shadow-md hover:ring-accent/40 active:scale-95"
            style={{
              width: "clamp(4rem, 8vw, 5.5rem)",
              height: "clamp(4rem, 8vw, 5.5rem)",
            }}
            data-testid="council-emblem"
          >
            <Scale
              className="transition-transform duration-300 group-hover:rotate-[-6deg]"
              style={{
                width: "clamp(2rem, 5vw, 3rem)",
                height: "clamp(2rem, 5vw, 3rem)",
              }}
            />
            {/* Hint pulse on first 3 visits (when count is 0) — invites discovery */}
            {scaleTapCount === 0 && stats.totalRuns < 3 ? (
              <span
                aria-hidden
                className="council-emblem-pulse absolute inset-0 rounded-2xl ring-2 ring-accent/30"
              />
            ) : null}
          </button>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
                {t("llm_council.eyebrow", {
                  defaultValue: "Multi-Model Legal Research",
                })}
              </p>
              {stats.totalRuns > 0 && !(import.meta.env.DEV && import.meta.env.VITE_COUNCIL_DEMO === "true") ? (
                <span
                  className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent"
                  title={`${stats.totalRuns} council runs · ${stats.streak}-day streak`}
                >
                  {stats.totalRuns} hearing{stats.totalRuns === 1 ? "" : "s"}
                  {stats.streak >= 2 ? ` · 🔥 ${stats.streak}d` : ""}
                </span>
              ) : null}
            </div>
            <h1 className="break-words font-heading text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-tight tracking-tight text-foreground">
              {t("llm_council.title", { defaultValue: "LLM IMMI Council" })}
            </h1>
            <p className="max-w-prose text-sm leading-relaxed text-muted-text sm:text-base">
              {t("llm_council.subtitle", {
                defaultValue:
                  "Three independent legal-research experts deliberate in parallel — their opinions are then synthesised by the Council Chairman into ranked critique, statute cross-reference, and a mock judgment outline.",
              })}
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-muted-text">
              {t("llm_council.research_notice", { defaultValue: "Check important details against original sources. This is research assistance, not a court decision." })}
            </p>
          </div>

          {/* Sound toggle — top-right corner of the hero */}
          <button
            type="button"
            onClick={handleSoundToggle}
            aria-label={soundOn ? "Turn court sounds off" : "Turn court sounds on"}
            data-testid="council-sound-toggle"
            className="absolute right-0 top-0 -translate-y-1 rounded-full border border-border bg-card/80 p-2 text-muted-text shadow-sm transition-colors hover:text-accent sm:translate-y-0"
          >
            {soundOn ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </section>

      {sessionId ? (
        isLoading ? (
          <PageLoader />
        ) : !isAuthenticated ? (
          <AuthRequiredNotice />
        ) : (
        <ThreadView
          sessionId={sessionId}
          onAchievements={pushAchievements}
          onRunComplete={refreshStats}
        />
        )
      ) : (
        <>
          <section className="rounded-xl border border-dashed border-border bg-card p-5 text-sm text-muted-text shadow-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <p>
                {import.meta.env.DEV && import.meta.env.VITE_COUNCIL_DEMO === "true" ? t("llm_council.local_demo_hint", {
                  defaultValue: "Enter a sample question to see a fixed example. The response does not analyse your input.",
                }) : t("llm_council.idle_hint", {
                  defaultValue:
                    "Submit a question to start a new council session. Each session supports up to 15 turns.",
                })}
              </p>
            </div>
          </section>
          <NewSessionForm
            onAchievements={pushAchievements}
            onRunComplete={refreshStats}
          />
        </>
      )}

      {/* Achievement toasts — fixed bottom-right */}
      <AchievementsContainer
        achievements={achievements}
        onDismiss={handleDismissAchievement}
      />
    </div>
  );
}
