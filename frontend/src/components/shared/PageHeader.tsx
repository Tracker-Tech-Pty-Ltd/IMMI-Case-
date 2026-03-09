import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-text">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex items-start gap-3">
            {icon ? (
              <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-muted text-accent">
                {icon}
              </div>
            ) : null}
            <div className="min-w-0 space-y-2">
              <h1 className="font-heading text-[clamp(1.875rem,3vw,2.75rem)] font-semibold leading-tight tracking-tight text-foreground">
                {title}
              </h1>
              {description ? (
                <p className="max-w-3xl text-sm leading-6 text-secondary-text">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {meta ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-text">
          {meta}
        </div>
      ) : null}
    </div>
  );
}
