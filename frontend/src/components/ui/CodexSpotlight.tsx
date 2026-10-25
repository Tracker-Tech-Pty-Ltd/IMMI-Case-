import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** Adapted from kevingirelli/spotlight on 21st.dev; see docs/21st-motion-20261017.md. */
export function CodexSpotlight({ children, className, onPointerMove, ...props }: ComponentPropsWithoutRef<"article">) {
  const frame = useRef<number | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  return <article
    {...props}
    className={cn("codex-spotlight", className)}
    onPointerMove={(event) => {
      onPointerMove?.(event);
      if (event.pointerType === "touch" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const target = event.currentTarget;
      const { clientX, clientY } = event;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const bounds = target.getBoundingClientRect();
        target.style.setProperty("--codex-spotlight-x", `${clientX - bounds.left}px`);
        target.style.setProperty("--codex-spotlight-y", `${clientY - bounds.top}px`);
        frame.current = null;
      });
    }}
  >
    <span className="codex-spotlight-wash" aria-hidden="true" />
    <span className="codex-spotlight-ring" aria-hidden="true" />
    {children}
  </article>;
}
