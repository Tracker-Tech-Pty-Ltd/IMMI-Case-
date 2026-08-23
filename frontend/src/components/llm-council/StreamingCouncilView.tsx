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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Bot, CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, Search, Sparkles } from "lucide-react";
import { playHaptic } from "@/lib/council-celebrations";

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
  start: (params: { message: string; case_context?: string }) => Promise<CouncilStreamState>;
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
    async (params: { message: string; case_context?: string }): Promise<CouncilStreamState> => {
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
      const watchdog = setInterval(() => {
        if (myGen !== genRef.current) {
          clearInterval(watchdog);
          return;
        }
        if (Date.now() - lastActivityAt > WATCHDOG_MS) {
          clearInterval(watchdog);
          controller.abort();
        }
      }, 5_000);

      try {
        const res = await fetch("/api/v1/llm-council/stream", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
        }

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
            update({ ...curr, council: { status: "done", data: ev.data } });
            continue;
          }
          if (ev.event === "council.error") {
            update({ ...curr, council: { status: "error", error: String(ev.data.error ?? "") } });
            continue;
          }
        }
        return curr;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") {
          return curr;
        }
        update({
          ...curr,
          council: { status: "error", error: String((err as Error).message ?? err) },
        });
        return curr;
      } finally {
        clearInterval(watchdog);
        controllerRef.current = null;
        setIsStreaming(false);
      }
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
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
}

function ExpertColumn({ providerKey, state }: ExpertColumnProps) {
  const meta = PROVIDER_META[providerKey];
  const charCount = state.text.length;

  return (
    <article
      data-testid={`stream-column-${providerKey}`}
      className="flex h-[28rem] flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm md:h-[32rem]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border bg-surface/40 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
            style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
          >
            <Bot className="h-3.5 w-3.5" />
          </div>
          <span className="truncate text-xs font-semibold text-foreground">{meta.label}</span>
        </div>
        <StatusBadge status={state.status} latencyMs={state.latencyMs} charCount={charCount} />
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {state.status === "pending" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-text">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1 w-1 rounded-full"
                  style={{
                    backgroundColor: meta.color,
                    animation: "pulse 1.4s ease-in-out infinite",
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
            <span>queued</span>
          </div>
        ) : state.status === "error" ? (
          <div className="rounded-md border border-amber-300/40 bg-amber-50/30 p-2 text-[11px] text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/15 dark:text-amber-300">
            <p className="mb-1 font-semibold">Failed</p>
            <p className="break-words">{state.error || "unknown error"}</p>
          </div>
        ) : state.text ? (
          <div className="text-xs text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={STREAM_MARKDOWN_COMPONENTS}>
              {state.text}
            </ReactMarkdown>
            {state.status === "streaming" ? (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3 w-1 animate-pulse"
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
            <span>Live sources ({state.groundedSources.length})</span>
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
}

function StatusBadge({ status, latencyMs, charCount }: StatusBadgeProps) {
  if (status === "pending") {
    return <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-text">queued</span>;
  }
  if (status === "streaming") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        streaming{typeof charCount === "number" ? ` · ${charCount}c` : ""}
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {typeof latencyMs === "number" ? `${(latencyMs / 1000).toFixed(1)}s` : "done"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      <AlertTriangle className="h-2.5 w-2.5" />
      failed
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
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - state.startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [state.startedAt]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const allExpertsFinal =
    state.openai.status !== "pending" &&
    state.openai.status !== "streaming" &&
    state.gemini_pro.status !== "pending" &&
    state.gemini_pro.status !== "streaming" &&
    state.anthropic.status !== "pending" &&
    state.anthropic.status !== "streaming";

  return (
    <div className="space-y-3" data-testid="streaming-council-view">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card px-4 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          {state.council.status === "running" || !allExpertsFinal ? (
            <div className="animate-spin">
              <Loader2 className="h-3.5 w-3.5 text-accent" />
            </div>
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="text-sm font-semibold text-foreground">
            {state.council.status === "running" || !allExpertsFinal
              ? "Council deliberating"
              : "Panel finished — synthesising"}
          </span>
        </div>
        <span className="rounded bg-surface px-2 py-0.5 font-mono text-xs tabular-nums text-foreground">
          {mm}:{ss}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["openai", "gemini_pro", "anthropic"] as const).map((key) => (
          <ExpertColumn key={key} providerKey={key} state={state[key]} />
        ))}
      </div>

      <div
        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 shadow-sm ${
          state.moderator.status === "complete"
            ? "border-emerald-300/50 bg-emerald-50/30 dark:border-emerald-700/40 dark:bg-emerald-900/15"
            : state.moderator.status === "running"
              ? "border-amber-300/50 bg-amber-50/30 dark:border-amber-700/40 dark:bg-amber-900/15"
              : "border-border/80 bg-card"
        }`}
        data-testid="streaming-moderator-status"
      >
        <Sparkles
          className={`h-4 w-4 ${
            state.moderator.status === "running"
              ? "text-amber-600 dark:text-amber-400"
              : state.moderator.status === "complete"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-text"
          }`}
        />
        <span className="text-sm font-semibold text-foreground">Council Chairman</span>
        <span className="text-xs text-muted-text">
          {state.moderator.status === "pending" && "awaiting panel"}
          {state.moderator.status === "running" && "synthesising 14-field judgment…"}
          {state.moderator.status === "complete" && "synthesis complete"}
          {state.moderator.status === "error" && (state.moderator.error || "synthesis failed")}
        </span>
        {state.moderator.status === "running" ? (
          <div className="ml-auto animate-spin">
            <Loader2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          </div>
        ) : null}
      </div>

      {/* Task C — recall-code surface. Only rendered after the council
          finishes AND the session.session event has landed (most flows
          satisfy both within ~10ms of each other; gating on retrieveCode
          alone would surface it mid-stream which is misleading). */}
      {state.council.status === "done" && state.session.retrieveCode ? (
        <RecallCodeCard code={state.session.retrieveCode} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecallCodeCard — prominent "save your code" UI shown after stream done
// ---------------------------------------------------------------------------

function RecallCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      playHaptic();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — non-fatal, code is visible on screen */
    }
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
              Save your recall code
            </div>
            <div className="text-[11px] text-muted-text">
              Enter this code on a future visit to restore this conversation.
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
            onClick={onCopy}
            data-testid="recall-code-copy"
            aria-label="Copy recall code"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10 hover:text-accent"
          >
            {copied ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
