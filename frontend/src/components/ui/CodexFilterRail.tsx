import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** Shared selection background adapted from ibelick/animated-tabs on 21st.dev. */
export function CodexFilterRail({ activeKey, className, children, ...props }: ComponentPropsWithoutRef<"div"> & { activeKey: string }) {
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const previous = useRef(activeKey);
  const geometry = useRef("");

  useLayoutEffect(() => {
    const host = root.current;
    const light = indicator.current;
    if (!host || !light) return;
    const sync = (animate: boolean) => {
      const active = host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!active) return;
      const container = host.getBoundingClientRect();
      const bounds = active.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const next = [bounds.left - container.left, bounds.top - container.top, bounds.width, bounds.height].join(",");
      if (geometry.current === next) return;
      geometry.current = next;
      light.style.transition = animate ? "" : "none";
      light.style.width = `${bounds.width}px`;
      light.style.height = `${bounds.height}px`;
      light.style.transform = `translate(${bounds.left - container.left}px, ${bounds.top - container.top}px)`;
      host.dataset.railReady = "true";
    };
    sync(previous.current !== activeKey);
    previous.current = activeKey;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => sync(false));
    observer?.observe(host);
    host.querySelectorAll("button").forEach((button) => observer?.observe(button));
    let mounted = true;
    document.fonts?.ready.then(() => { if (mounted) sync(false); });
    return () => {
      mounted = false;
      observer?.disconnect();
    };
  }, [activeKey]);

  return <div {...props} ref={root} role="group" className={cn("codex-filter-rail", className)}>
    <span ref={indicator} aria-hidden="true" className="codex-filter-indicator" />
    {children}
  </div>;
}
