import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StateTone = "neutral" | "error" | "warning" | "loading";
type StateAlign = "center" | "start";

interface StatePanelProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  tone?: StateTone;
  align?: StateAlign;
  contained?: boolean;
  className?: string;
  bodyClassName?: string;
}

const toneStyles: Record<StateTone, string> = {
  neutral: "border-border/80 bg-card/95 text-foreground",
  error:
    "border-danger/20 bg-danger/6 text-foreground shadow-[0_1px_3px_rgba(168,50,50,0.08)]",
  warning:
    "border-warning/25 bg-warning/8 text-foreground shadow-[0_1px_3px_rgba(125,91,7,0.08)]",
  loading: "border-border/70 bg-card/80 text-foreground",
};

const iconStyles: Record<StateTone, string> = {
  neutral: "bg-surface text-accent",
  error: "bg-danger/10 text-danger",
  warning: "bg-warning/12 text-warning",
  loading: "bg-accent-muted text-accent",
};

export function StatePanel({
  title,
  description,
  icon,
  action,
  children,
  tone = "neutral",
  align = "center",
  contained = true,
  className,
  bodyClassName,
}: StatePanelProps) {
  return (
    <div
      className={cn(
        "w-full",
        contained &&
          "rounded-2xl border px-5 py-6 shadow-sm transition-colors",
        toneStyles[tone],
        className,
      )}
    >
      <div
        className={cn(
          "flex gap-4",
          align === "center"
            ? "flex-col items-center text-center"
            : "items-start text-left",
        )}
      >
        {icon ? (
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
              iconStyles[tone],
            )}
          >
            {icon}
          </div>
        ) : null}
        <div className={cn("w-full space-y-3", bodyClassName)}>
          <div className="space-y-1.5">
            <div className="font-heading text-lg font-semibold leading-tight text-foreground">
              {title}
            </div>
            {description ? (
              <div className="mx-auto max-w-2xl text-sm leading-6 text-secondary-text">
                {description}
              </div>
            ) : null}
          </div>
          {children ? <div className="w-full">{children}</div> : null}
          {action ? (
            <div
              className={cn(
                "flex flex-wrap gap-2",
                align === "center" ? "justify-center" : "justify-start",
              )}
            >
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
