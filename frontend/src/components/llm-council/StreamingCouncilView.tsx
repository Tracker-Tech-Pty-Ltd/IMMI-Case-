/**
 * frontend/src/components/llm-council/StreamingCouncilView.tsx
 *
 * 3-column live SSE streaming view for the LLM Council. Driven by
 * useCouncilStream() which POSTs to /api/v1/llm-council/stream and
 * parses the multiplexed SSE event stream.
 *
 * Column layout:
 *   md+: 3 columns side-by-side
 *   <md: stack vertically (1 column)
 *
 * Each column renders the accumulated text with react-markdown live;
 * incomplete markdown (mid-table, mid-code-block) is gracefully rendered
 * by react-markdown as raw text until the syntax closes — meeting the
 * user's "wait until block is complete" requirement automatically.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getApiAccessToken } from "@/lib/api";
import { demoRequestCredentials } from "@/lib/demo-request";
import { AlertTriangle, Bot, CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, Search, Sparkles } from "lucide-react";
import { playHaptic } from "@/lib/council-celebrations";
import { ModeratorSection } from "@/components/llm-council/TurnCard";
import type { LlmCouncilModerator } from "@/lib/api-llm-council";

const STREAM_INCOMPLETE = "council_stream_ended_early";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderKey = "openai" | "gemini_pro" | "anthropic";

export interface GroundedSource {
  url: string;
  title?: string;
}

export interface ExpertStreamState {
  text: string;
  status: "pending" | "streaming" | "done" | "error";
  error?: string;
  model?: string;
  latencyMs?: number;
  sources?: string[];
  /** Live citation chips emitted by `<provider>.source` SSE events from
   *  Anthropic web_search + Gemini google_search grounding. Inline URLs in
   *  the answer text still go in `sources` (combined for legacy callers). */
  groundedSources?: GroundedSource[];
}

export interface CouncilStreamState {
  openai: ExpertStreamState;
  gemini_pro: ExpertStreamState;
  anthropic: ExpertStreamState;
  moderator: {
    status: "pending" | "running" | "complete" | "error";
    data?: Record<string, unknown>;
    error?: string;
  };
  council: {
    status: "pending" | "running" | "done" | "error";
    data?: Record<string, unknown>;
    error?: string;
  };
  /** Task C — session identity emitted as a `council.session` SSE event
   *  right after `council.start`. Null until the event lands. */
  session: {
    sessionId: string | null;
    sessionToken: string | null;
    retrieveCode: string | null;
  };
  startedAt: number;
}

const PROVIDER_META: Record<ProviderKey, { label: string; color: string }> = {
  openai: { label: "OpenAI", color: "#10a37f" },
  gemini_pro: { label: "Gemini Pro", color: "#4285f4" },
  anthropic: { label: "Claude Sonnet", color: "#cc785c" },
};

// The stream is network data. Render only known fields with the expected
// shapes; never interpret model output as components or executable markup.
function streamModerator(data?: Record<string, unknown>): LlmCouncilModerator | null {
  if (!data || data.success !== true) return null;
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const providerSections: Record<string, string[]> = Object.create(null);
  if (data.provider_law_sections && typeof data.provider_law_sections === "object" && !Array.isArray(data.provider_law_sections)) {
    for (const [key, value] of Object.entries(data.provider_law_sections)) providerSections[key] = strings(value);
  }
  return {
    success: true, composed_answer: text(data.composed_answer), consensus: text(data.consensus),
    disagreements: text(data.disagreements), outcome_likelihood_percent: typeof data.outcome_likelihood_percent === "number" ? data.outcome_likelihood_percent : NaN,
    outcome_likelihood_label: text(data.outcome_likelihood_label), outcome_likelihood_reason: text(data.outcome_likelihood_reason),
    law_sections: strings(data.law_sections), mock_judgment: text(data.mock_judgment), follow_up_questions: strings(data.follow_up_questions),
    ranking: [], model_critiques: [], vote_summary: null, agreement_points: strings(data.agreement_points), conflict_points: strings(data.conflict_points),
    provider_law_sections: providerSections, shared_law_sections: strings(data.shared_law_sections),
    shared_law_sections_confidence_percent: typeof data.shared_law_sections_confidence_percent === "number" ? data.shared_law_sections_confidence_percent : 0,
    shared_law_sections_confidence_reason: text(data.shared_law_sections_confidence_reason), raw_text: text(data.raw_text), error: "", latency_ms: 0,
  };
}

const initialExpert = (): ExpertStreamState => ({ text: "", status: "pending" });

const initialState = (): CouncilStreamState => ({
  openai: initialExpert(),
  gemini_pro: initialExpert(),
  anthropic: initialExpert(),
  moderator: { status: "pending" },
  council: { status: "running" },
  session: { sessionId: null, sessionToken: null, retrieveCode: null },
  startedAt: Date.now(),
});

// ---------------------------------------------------------------------------
// SSE parser — reads ReadableStream<Uint8Array> body, dispatches events
// ---------------------------------------------------------------------------

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Parse a single raw event block per W3C SSE spec:
  //   - Field separator may be "field: value" OR "field:value"
  //   - Multiple `data:` lines concatenate with "\n" between them
  //   - Lines beginning with ":" are comments (e.g. ":keepalive")
  const parseEvent = (rawEvent: string): SseEvent | null => {
    let eventName = "message";
    let dataStr = "";
    for (const line of rawEvent.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1).replace(/^ /, "");
      if (field === "event") eventName = value.trim();
      else if (field === "data") {
        dataStr += (dataStr ? "\n" : "") + value;
      }
    }
    if (!dataStr) return null;
    try {
      return { event: eventName, data: JSON.parse(dataStr) };
    } catch {
      return null;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let blankIdx;
    while ((blankIdx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, blankIdx);
      buffer = buffer.slice(blankIdx + 2);
      const ev = parseEvent(rawEvent);
      if (ev) yield ev;
    }
  }

  // FIX C3 — flush trailing event without "\n\n" terminator. If the network
  // truncates or the server's final flush omits the blank-line terminator,
  // the terminal `council.done` would otherwise be lost and the UI would
  // spin forever waiting for a status transition.
  if (buffer.trim()) {
    const ev = parseEvent(buffer);
    if (ev) yield ev;
  }
}

// ---------------------------------------------------------------------------
// useCouncilStream — hook
// ---------------------------------------------------------------------------

export interface UseCouncilStreamResult {
  state: CouncilStreamState;
  isStreaming: boolean;
  /** Open the SSE connection and start streaming. */
  start: (params: {
    message: string;
    case_context?: string;
    case_id?: string;
  }) => Promise<CouncilStreamState>;
  /** Abort an in-flight stream. */
  abort: () => void;
  /** Reset state (call after consumer has persisted final result). */
  reset: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCouncilStream(): UseCouncilStreamResult {
  const [state, setState] = useState<CouncilStreamState>(initialState());
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Generation token — increments on every start() call. The for-await
  // loop in the previous start() may still hold stale closures over its
  // `update`. Gating writes on `myGen === genRef.current` prevents the
  // old run from clobbering fresh state when the user rapidly re-submits.
  const genRef = useRef(0);

  const reset = useCallback(() => {
    setState(initialState());
    setIsStreaming(false);
  }, []);

  const abort = useCallback(() => {
    genRef.current += 1; // invalidate any in-flight loop
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsStreaming(false);
  }, []);

  const start = useCallback(
    async (params: {
      message: string;
      case_context?: string;
      case_id?: string;
    }): Promise<CouncilStreamState> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const fresh = initialState();
      setState(fresh);
      setIsStreaming(true);

      const myGen = ++genRef.current;
      // Local mutable copy mirrored to React state. Guarded by myGen so
      // a previously-aborted loop's straggler updates cannot overwrite
      // a fresh stream's state.
      let curr: CouncilStreamState = fresh;
      const update = (next: CouncilStreamState) => {
        if (myGen !== genRef.current) return; // superseded
        curr = next;
        setState(next);
      };

      // Silence watchdog — once events start flowing, fetch's request
      // timeout no longer protects us. If the Worker silently dies
      // mid-stream (wall-time exceeded, panic, OOM), the SSE connection
      // sits idle and the UI spins forever. Aborting after WATCHDOG_MS
      // of no event surfaces the failure cleanly. Reset on each event.
      const WATCHDOG_MS = 90_000;
      let lastActivityAt = Date.now();
      // Only the watchdog gets an error state on abort. Track that it was
      // specifically the watchdog (not a superseding start() or unmount)
      // that fired, so the catch block below can tell the three AbortError
      // producers apart.
      let timedOut = false;
      // Whether the stream ever opened (2xx + a readable body). A failure
      // before this point never reaches LlmCouncilPage's hasStreamed gate,
      // so start() must rethrow it — see the catch block below.
      let streamOpened = false;
      const watchdog = setInterval(() => {
        if (myGen !== genRef.current) {
          clearInterval(watchdog);
          return;
        }
        if (Date.now() - lastActivityAt > WATCHDOG_MS) {
          timedOut = true;
          clearInterval(watchdog);
          controller.abort();
        }
      }, 5_000);

      try {
        const accessToken = getApiAccessToken();
        const res = await fetch("/api/v1/llm-council/stream", {
          method: "POST",
          credentials: "include",
          ...demoRequestCredentials(),
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(params),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
        }
        streamOpened = true;

        for await (const ev of parseSseStream(res.body)) {
          lastActivityAt = Date.now();
          if (ev.event === "council.start") {
            update({ ...curr, council: { status: "running" } });
            continue;
          }

          if (ev.event === "council.session") {
            // Task C — capture the pre-minted session identity. The Worker
            // persists the session+turn after the council orchestration
            // finishes (handler ctx.waitUntil), so we just need to surface
            // the retrieve_code so the user can save it.
            const sessionId = String(ev.data?.session_id || "") || null;
            const sessionToken = String(ev.data?.session_token || "") || null;
            const retrieveCode = String(ev.data?.retrieve_code || "") || null;
            // Persist token so future GET /sessions/:id flows work the same
            // way as the createSession path. Try-catch for incognito quota.
            if (sessionId && sessionToken) {
              try {
                localStorage.setItem(`llm-council-token-${sessionId}`, sessionToken);
              } catch { /* incognito / quota — non-fatal */ }
            }
            update({
              ...curr,
              session: { sessionId, sessionToken, retrieveCode },
            });
            continue;
          }

          // Provider delta/done/error events
          const providerKeys: ProviderKey[] = ["openai", "gemini_pro", "anthropic"];
          const matched = providerKeys.find((k) => ev.event.startsWith(`${k}.`));
          if (matched) {
            const sub = ev.event.slice(matched.length + 1);
            const prev = curr[matched];
            if (sub === "delta") {
              update({
                ...curr,
                [matched]: {
                  ...prev,
                  status: "streaming",
                  text: prev.text + (ev.data.text || ""),
                },
              });
            } else if (sub === "done") {
              update({
                ...curr,
                [matched]: {
                  ...prev,
                  status: "done",
                  text: ev.data.answer ?? prev.text,
                  model: ev.data.model,
                  latencyMs: ev.data.latency_ms,
                  sources: ev.data.sources ?? [],
                },
              });
            } else if (sub === "error") {
              update({
                ...curr,
                [matched]: {
                  ...prev,
                  status: "error",
                  error: ev.data.error,
                  model: ev.data.model,
                  latencyMs: ev.data.latency_ms,
                },
              });
            } else if (sub === "source") {
              // Live grounding citation from web_search / google_search.
              // Dedupe by URL so the same source emitted twice (e.g. via
              // `<provider>.source` AND `<provider>.done.grounded_sources`)
              // doesn't double up in the chip footer.
              const url = String(ev.data?.url || "").trim();
              if (!url) continue;
              const existing = prev.groundedSources || [];
              if (existing.some((s) => s.url === url)) continue;
              update({
                ...curr,
                [matched]: {
                  ...prev,
                  groundedSources: [
                    ...existing,
                    { url, title: ev.data?.title || url },
                  ],
                },
              });
            }
            continue;
          }

          if (ev.event === "moderator.start") {
            update({ ...curr, moderator: { status: "running" } });
            continue;
          }
          if (ev.event === "moderator.complete") {
            update({ ...curr, moderator: { status: "complete", data: ev.data } });
            continue;
          }
          if (ev.event === "council.done") {
            // The Worker sends a terminal done event even after an all-expert
            // failure. Preserve that error: done signals stream termination,
            // not that a usable result or saved conversation exists.
            update({ ...curr, council: curr.council.status === "error"
              ? { ...curr.council, data: ev.data }
              : { status: "done", data: ev.data } });
            continue;
          }
          if (ev.event === "council.error") {
            update({ ...curr, council: { status: "error", error: String(ev.data.error ?? "") } });
            continue;
          }
        }
        // EOF without a terminal event is an interrupted response, not a
        // still-running or successful council. Preserve terminal error/done.
        if (curr.council.status === "pending" || curr.council.status === "running") {
          update({
            ...curr,
            council: { status: "error", error: STREAM_INCOMPLETE },
          });
        }
        return curr;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") {
          // Only the watchdog gets an error state. A superseding start() and an
          // unmount both abort too, and both must stay silent — the first
          // because update() is a no-op for a superseded generation, the second
          // because the unmount effect bumps genRef before aborting.
          if (timedOut) {
            update({
              ...curr,
              council: {
                status: "error",
                error:
                  "The council stream stopped responding — no data for 90 seconds. Try sending the question again.",
              },
            });
          }
          return curr;
        }
        update({
          ...curr,
          council: { status: "error", error: String((err as Error).message ?? err) },
        });
        // Nothing ever streamed, so LlmCouncilPage's `hasStreamed` gate keeps
        // StreamingCouncilView unmounted and the state above is unreachable.
        // Rethrow so the page's existing try/catch (LlmCouncilPage.tsx:842)
        // populates submitError and renders <ApiErrorState>. Only the
        // pre-stream case rethrows: a mid-stream drop is already visible in the
        // error strip and must not also raise a second, duplicate surface.
        if (!streamOpened) throw err;
        return curr;
      } finally {
        clearInterval(watchdog);
        // Only tear down the shared ref/state if this run is still the
        // current one. A superseded run reaches here *after* start() has
        // installed the successor's controller and bumped genRef, so an
        // unguarded teardown would null the successor's AbortController and
        // clear its isStreaming flag. Every other state-touching block in
        // this hook is already gated the same way (see `update` and the
        // watchdog interval above).
        if (myGen === genRef.current) {
          controllerRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [],
  );

  // Cleanup on unmount. Bump the generation FIRST: the abort below makes the
  // in-flight fetch reject on a later microtask, and every state-touching block
  // in start() is gated on `myGen === genRef.current`.
  useEffect(() => {
    return () => {
      genRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  return { state, isStreaming, start, abort, reset };
}

// ---------------------------------------------------------------------------
// StreamingCouncilView component
// ---------------------------------------------------------------------------

type MdProps = React.HTMLAttributes<HTMLElement>;
type MdCodeProps = React.HTMLAttributes<HTMLElement> & { inline?: boolean; className?: string; children?: React.ReactNode };

// eslint-disable-next-line react-refresh/only-export-components
const STREAM_MARKDOWN_COMPONENTS: Record<string, (props: MdProps | MdCodeProps) => React.ReactNode> = {
  h1: (p: MdProps) => <h1 className="mb-1 mt-2 text-sm font-bold text-foreground" {...p} />,
  h2: (p: MdProps) => <h2 className="mb-1 mt-2 text-xs font-bold text-foreground" {...p} />,
  h3: (p: MdProps) => <h3 className="mb-1 mt-2 text-xs font-semibold text-foreground" {...p} />,
  h4: (p: MdProps) => <h4 className="mb-1 mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-text" {...p} />,
  p: (p: MdProps) => <p className="mb-1.5 text-xs leading-relaxed text-foreground" {...p} />,
  ul: (p: MdProps) => <ul className="mb-1.5 ml-3 list-disc space-y-0.5 text-xs text-foreground" {...p} />,
  ol: (p: MdProps) => <ol className="mb-1.5 ml-3 list-decimal space-y-0.5 text-xs text-foreground" {...p} />,
  li: (p: MdProps) => <li className="leading-relaxed" {...p} />,
  strong: (p: MdProps) => <strong className="font-semibold text-foreground" {...p} />,
  em: (p: MdProps) => <em className="italic" {...p} />,
  code: ({ inline, className, children, ...rest }: MdCodeProps) =>
    inline ? (
      <code className="rounded bg-surface px-1 font-mono text-[0.8em] text-accent" {...rest}>
        {children}
      </code>
    ) : (
      <code className={`block overflow-x-auto rounded-md bg-surface p-2 font-mono text-[10px] ${className || ""}`} {...rest}>
        {children}
      </code>
    ),
  table: (p: MdProps) => (
    <div className="my-1 overflow-x-auto rounded border border-border">
      <table className="w-full text-[10px]" {...p} />
    </div>
  ),
  thead: (p: MdProps) => <thead className="bg-surface/50 text-muted-text" {...p} />,
  tr: (p: MdProps) => <tr className="border-b border-border last:border-0" {...p} />,
  th: (p: MdProps) => <th className="px-1.5 py-1 text-left font-semibold" {...p} />,
  td: (p: MdProps) => <td className="px-1.5 py-1 align-top" {...p} />,
};

interface ExpertColumnProps {
  providerKey: ProviderKey;
  state: ExpertStreamState;
  stopped: boolean;
}

function ExpertColumn({ providerKey, state, stopped }: ExpertColumnProps) {
  const { t } = useTranslation();
  const meta = PROVIDER_META[providerKey];
  const charCount = state.text.length;
  const incomplete = stopped && (state.status === "pending" || state.status === "streaming");

  return (
    <article
      data-testid={`stream-column-${providerKey}`}
      className={`flex max-h-96 flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm transition-colors hover:border-accent/40 ${!incomplete && (state.status === "pending" || state.status === "streaming") ? "h-64 md:h-96" : ""}`}
    >
      <div className="h-1 shrink-0" style={{ backgroundColor: meta.color }} aria-hidden="true" />
      <header className="flex items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-surface to-card px-3 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
            style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
          >
            <Bot className="h-3.5 w-3.5" />
          </div>
          <span className="truncate text-xs font-semibold text-foreground">{meta.label}</span>
        </div>
        <StatusBadge status={state.status} latencyMs={state.latencyMs} charCount={charCount} incomplete={incomplete} />
      </header>

      {/* A scrollable region needs keyboard focus so its full text is reachable. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="flex-1 overflow-y-auto px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" tabIndex={0} role="region" aria-label={t("llm_council.stream_response_region", { defaultValue: "{{provider}} response", provider: meta.label })}>
        {state.status === "pending" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-muted-text">
            <div className="relative grid h-14 w-14 place-items-center" aria-hidden="true">
              <span className={`absolute inset-0 rounded-full border border-accent/25 ${incomplete ? "" : "motion-safe:animate-ping"}`} />
              <span className={`grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-accent ${incomplete ? "" : "motion-safe:animate-pulse"}`}>
                <Sparkles className="h-4 w-4" />
              </span>
            </div>
            <span>{incomplete ? t("llm_council.stream_incomplete", { defaultValue: "Response not completed" }) : t("llm_council.stream_queued", { defaultValue: "Queued" })}</span>
          </div>
        ) : state.status === "error" ? (
          <div className="rounded-md border border-amber-300/40 bg-amber-50/30 p-2 text-[11px] text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/15 dark:text-amber-300">
            <p className="mb-1 font-semibold">{t("llm_council.stream_failed", { defaultValue: "Failed" })}</p>
            <p className="break-words">{state.error || t("llm_council.stream_unknown_error", { defaultValue: "Unknown error" })}</p>
          </div>
        ) : state.text ? (
          <div className="text-xs text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={STREAM_MARKDOWN_COMPONENTS}>
              {state.text}
            </ReactMarkdown>
            {state.status === "streaming" && !incomplete ? (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3 w-1 motion-safe:animate-pulse"
                style={{ backgroundColor: meta.color }}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-text">…</p>
        )}
      </div>

      {state.model ? (
        <footer className="border-t border-border bg-surface/30 px-3 py-1.5 font-mono text-[10px] text-muted-text">
          {state.model}
        </footer>
      ) : null}
      {/* Grounding citation chips — surfaces real-time web_search /
          google_search source URLs. Trust signal: user sees Anthropic
          actually pulling 2025 ART Amendment Bill from aph.gov.au. */}
      {state.groundedSources && state.groundedSources.length > 0 ? (
        <div
          className="border-t border-border bg-surface/20 px-2 py-1.5"
          data-testid={`stream-sources-${providerKey}`}
        >
          <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-accent">
            <Search className="h-2.5 w-2.5" />
            <span>{t("llm_council.stream_live_sources", { defaultValue: "Live sources ({{total}})", total: state.groundedSources.length })}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {state.groundedSources.slice(0, 8).map((s) => {
              let host = s.url;
              try { host = new URL(s.url).hostname.replace(/^www\./, ""); }
              catch { /* malformed URL — fall back to raw */ }
              return (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  title={s.title || s.url}
                  className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10 hover:text-accent"
                >
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{host}</span>
                </a>
              );
            })}
            {state.groundedSources.length > 8 ? (
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted-text">
                +{state.groundedSources.length - 8}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

interface StatusBadgeProps {
  status: ExpertStreamState["status"];
  latencyMs?: number;
  charCount?: number;
  incomplete?: boolean;
}

function StatusBadge({ status, latencyMs, charCount, incomplete }: StatusBadgeProps) {
  const { t } = useTranslation();
  if (incomplete) {
    return <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted-text">{t("llm_council.stream_incomplete", { defaultValue: "Response not completed" })}</span>;
  }
  if (status === "pending") {
    return <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-text">{t("llm_council.stream_queued", { defaultValue: "Queued" })}</span>;
  }
  if (status === "streaming") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        {t("llm_council.stream_receiving", { defaultValue: "Receiving" })}{typeof charCount === "number" ? ` · ${t("llm_council.stream_characters", { defaultValue: "{{characters}} characters", characters: charCount })}` : ""}
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {typeof latencyMs === "number" ? `${(latencyMs / 1000).toFixed(1)}s` : t("llm_council.stream_done", { defaultValue: "Done" })}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      <AlertTriangle className="h-2.5 w-2.5" />
      {t("llm_council.stream_failed", { defaultValue: "Failed" })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StreamingCouncilView (exported)
// ---------------------------------------------------------------------------

export interface StreamingCouncilViewProps {
  state: CouncilStreamState;
}

export function StreamingCouncilView({ state }: StreamingCouncilViewProps) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  const isDemo = import.meta.env.DEV && import.meta.env.VITE_COUNCIL_DEMO === "true";

  useEffect(() => {
    if (state.council.status === "done" || state.council.status === "error") return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - state.startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [state.startedAt, state.council.status]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const allExpertsFinal =
    state.openai.status !== "pending" &&
    state.openai.status !== "streaming" &&
    state.gemini_pro.status !== "pending" &&
    state.gemini_pro.status !== "streaming" &&
    state.anthropic.status !== "pending" &&
    state.anthropic.status !== "streaming";

  const councilFailed = state.council.status === "error";
  const councilBusy = state.council.status === "running" || state.council.status === "pending";
  const panelIncomplete = state.council.status === "done" && !allExpertsFinal;
  const completedModerator = state.moderator.status === "complete" ? streamModerator(state.moderator.data) : null;
  const moderatorInterrupted = (state.council.status === "done" || councilFailed) && state.moderator.status === "running";
  const moderatorFailed = moderatorInterrupted || state.moderator.status === "error" ||
    (state.moderator.status === "complete" && state.moderator.data?.success !== true);
  const hasExpertAnswer = [state.openai, state.gemini_pro, state.anthropic]
    .some((expert) => expert.status === "done" && expert.text.trim().length > 0);

  return (
    <div className="space-y-3" data-testid="streaming-council-view">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card px-4 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          {councilFailed || moderatorFailed || panelIncomplete ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          ) : councilBusy ? (
            <div className="motion-safe:animate-spin">
              <Loader2 className="h-3.5 w-3.5 text-accent" />
            </div>
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
          <span role="status" className="text-sm font-semibold text-foreground">
            {councilFailed
              ? t("llm_council.stream_run_failed", { defaultValue: "Council run failed" })
              : councilBusy
                ? t("llm_council.deliberating", { defaultValue: "Council deliberating" })
                : panelIncomplete
                  ? t("llm_council.stream_panel_incomplete", { defaultValue: "Some responses were not completed" })
                : moderatorFailed
                  ? t("llm_council.stream_synthesis_failed", { defaultValue: "Synthesis unavailable" })
                  : state.moderator.status === "complete"
                    ? isDemo
                      ? t("llm_council.stream_demo_complete", { defaultValue: "Demo response complete" })
                      : t("llm_council.stream_analysis_complete", { defaultValue: "Analysis complete" })
                    : t("llm_council.stream_panel_finished", { defaultValue: "Panel responses complete" })}
          </span>
        </div>
        <span className="rounded bg-surface px-2 py-0.5 font-mono text-xs tabular-nums text-foreground">
          {mm}:{ss}
        </span>
        {councilFailed ? (
          <p
            role="alert"
            data-testid="council-stream-error"
            className="w-full break-words rounded-md border border-amber-300/40 bg-amber-50/30 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/15 dark:text-amber-300"
          >
            {state.council.error === STREAM_INCOMPLETE
              ? t("llm_council.stream_ended_early", { defaultValue: "The council stream ended before completion. Try sending the question again." })
              : state.council.error || t("llm_council.stream_unknown_error", { defaultValue: "Unknown error" })}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["openai", "gemini_pro", "anthropic"] as const).map((key) => (
          <ExpertColumn key={key} providerKey={key} state={state[key]} stopped={state.council.status === "done" || councilFailed} />
        ))}
      </div>

      <div
        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 shadow-sm ${
          moderatorFailed
            ? "border-amber-300/50 bg-amber-50/30 dark:border-amber-700/40 dark:bg-amber-900/15"
            : state.moderator.status === "complete"
            ? "border-emerald-300/50 bg-emerald-50/30 dark:border-emerald-700/40 dark:bg-emerald-900/15"
            : state.moderator.status === "running"
              ? "border-amber-300/50 bg-amber-50/30 dark:border-amber-700/40 dark:bg-amber-900/15"
              : "border-border/80 bg-card"
        }`}
        data-testid="streaming-moderator-status"
      >
        <Sparkles
          className={`h-4 w-4 ${
            moderatorFailed
              ? "text-amber-600 dark:text-amber-400"
              : state.moderator.status === "running"
              ? "text-amber-600 dark:text-amber-400"
              : state.moderator.status === "complete"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-text"
          }`}
        />
        <span className="text-sm font-semibold text-foreground">{t("llm_council.chairman_label", { defaultValue: "Council Chairman" })}</span>
        <span className="text-xs text-muted-text">
          {state.moderator.status === "pending" && ((councilFailed || state.council.status === "done")
            ? t("llm_council.stream_synthesis_not_attempted", { defaultValue: "Synthesis was not attempted" })
            : t("llm_council.awaiting_label", { defaultValue: "Awaiting panel" }))}
          {state.moderator.status === "running" && !moderatorInterrupted && t("llm_council.stream_synthesising", { defaultValue: "Combining responses…" })}
          {state.moderator.status === "complete" && !moderatorFailed && (isDemo
            ? t("llm_council.stream_demo_complete", { defaultValue: "Demo response complete" })
            : t("llm_council.stream_synthesis_complete", { defaultValue: "Synthesis complete" }))}
          {moderatorFailed && (state.moderator.error || (typeof state.moderator.data?.error === "string" ? state.moderator.data.error : "") || t("llm_council.stream_synthesis_failed", { defaultValue: "Synthesis unavailable" }))}
        </span>
        {state.moderator.status === "running" && !moderatorInterrupted ? (
          <div className="ml-auto motion-safe:animate-spin">
            <Loader2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          </div>
        ) : null}
      </div>

      {completedModerator ? (
        <ModeratorSection moderator={completedModerator} providerLabels={{ openai: "OpenAI", gemini_pro: "Gemini Pro", anthropic: "Claude Sonnet" }} />
      ) : null}

      {/* Task C — recall-code surface. Only rendered after the council
          finishes AND the session.session event has landed (most flows
          satisfy both within ~10ms of each other; gating on retrieveCode
          alone would surface it mid-stream which is misleading). */}
      {state.council.status === "done" && hasExpertAnswer && state.session.retrieveCode ? (
        <RecallCodeCard code={state.session.retrieveCode} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecallCodeCard — prominent "save your code" UI shown after stream done
// ---------------------------------------------------------------------------

function RecallCodeCard({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    try {
      // navigator.clipboard is undefined outside a secure context, and
      // writeText() *rejects* on denied permission or an unfocused document.
      // Both must be observed before claiming success: this code is the only
      // handle the user has for restoring the session.
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
      playHaptic();
    } catch {
      setCopyState("failed");
    }
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
  }, [code]);

  return (
    <div
      data-testid="recall-code-card"
      className="rounded-xl border border-accent/40 bg-gradient-to-r from-accent/5 to-accent/10 p-4 shadow-sm dark:from-accent/10 dark:to-accent/20"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">
              {t("llm_council.stream_recall_code", { defaultValue: "Your recall code" })}
            </div>
            <div className="text-[11px] text-muted-text">
              {t("llm_council.stream_recall_pending", { defaultValue: "Saving is not yet confirmed. Open the conversation to check it is available before relying on this code." })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <code
            data-testid="recall-code-value"
            className="select-all rounded-md border border-accent/40 bg-card px-3 py-1.5 font-mono text-base font-bold tracking-[0.2em] text-foreground"
          >
            {code}
          </code>
          <button
            type="button"
            onClick={() => {
              void onCopy();
            }}
            data-testid="recall-code-copy"
            aria-label={t("llm_council.stream_copy_code", { defaultValue: "Copy recall code" })}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10 hover:text-accent"
          >
            {copyState === "copied" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                {t("llm_council.stream_copied", { defaultValue: "Copied" })}
              </>
            ) : copyState === "failed" ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                {t("llm_council.stream_copy_failed", { defaultValue: "Copy failed" })}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                {t("llm_council.stream_copy", { defaultValue: "Copy" })}
              </>
            )}
          </button>
        </div>
      </div>
      {copyState === "failed" ? (
        <div
          data-testid="recall-code-copy-failed"
          className="mt-2 text-[11px] text-amber-700 dark:text-amber-400"
        >
          {t("llm_council.stream_copy_manually", { defaultValue: "Copy failed — select the code above and copy it manually." })}
        </div>
      ) : null}
    </div>
  );
}
