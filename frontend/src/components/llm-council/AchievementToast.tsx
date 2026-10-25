/**
 * frontend/src/components/llm-council/AchievementToast.tsx
 *
 * Achievement-unlock toast — slides in bottom-right with the courtroom
 * Legal-Codex palette (amber + navy + cream). Auto-dismisses after 5s.
 * Multiple toasts stack vertically; oldest at bottom.
 *
 * Used by LlmCouncilPage to surface achievements returned from
 * recordCouncilRun() in council-celebrations.ts.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Achievement } from "@/lib/council-celebrations";

interface AchievementToastProps {
  achievement: Achievement;
  onDismiss: (id: string) => void;
}

export function AchievementToast({
  achievement,
  onDismiss,
}: AchievementToastProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setExiting(true), 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => onDismiss(achievement.id), 350);
    return () => clearTimeout(t);
  }, [exiting, achievement.id, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`achievement-toast-${achievement.id}`}
      className={`codex-achievement pointer-events-auto flex items-start gap-3 rounded-xl border border-accent bg-card px-4 py-3 shadow-lg transition-[transform,opacity] duration-300 ${
        exiting
          ? "translate-x-full opacity-0"
          : "animate-[councilToastIn_0.4s_ease-out_both]"
      }`}
      style={{
        background:
          "linear-gradient(135deg, var(--color-card, #fff) 0%, color-mix(in oklch, var(--color-accent, #d4a017) 8%, transparent) 100%)",
        minWidth: "260px",
        maxWidth: "340px",
      }}
    >
      <style>
        {`@keyframes councilToastIn {
          0% { opacity: 0; transform: translateY(20px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }`}
      </style>
      <div
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/20 text-2xl"
        aria-hidden
      >
        {achievement.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
          Achievement Unlocked
        </p>
        <p className="mt-0.5 text-sm font-semibold text-foreground">
          {achievement.title}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-text">
          {achievement.body}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setExiting(true)}
        aria-label="Dismiss achievement"
        className="shrink-0 rounded p-1 text-muted-text transition-colors hover:bg-surface hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface AchievementsContainerProps {
  achievements: Achievement[];
  onDismiss: (id: string) => void;
}

export function AchievementsContainer({
  achievements,
  onDismiss,
}: AchievementsContainerProps) {
  if (achievements.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2"
      data-testid="achievements-container"
    >
      {achievements.map((a) => (
        <AchievementToast
          key={a.id}
          achievement={a}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
