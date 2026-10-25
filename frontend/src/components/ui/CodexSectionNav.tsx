import { useEffect, useState } from "react";
import { ArrowDownRight } from "lucide-react";
import { CodexSticker } from "@/components/shared/CodexSticker";
import type { CodexStickerId } from "@/lib/codex-stickers";

export interface CodexSectionLink { id: string; label: string; sticker: CodexStickerId }

/** Secondary selection pattern from 21st/shugar/tabs-1, using real page links. */
export function CodexSectionNav({ label, sections }: { label: string; sections: CodexSectionLink[] }) {
  const [current, setCurrent] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const sync = () => setCurrent(window.location.hash.slice(1));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  return <nav className="codex-section-nav" aria-label={label}>
    {sections.map(({ id, label: title, sticker }, index) => <a
      key={id}
      href={`#${id}`}
      aria-current={current === id ? "location" : undefined}
      onClick={() => {
        setCurrent(id);
        requestAnimationFrame(() => {
          const target = document.getElementById(id);
          target?.focus({ preventScroll: true });
          target?.scrollIntoView({ block: "start", behavior: "instant" });
        });
      }}
    >
      <span aria-hidden="true" className="codex-section-number">{String(index + 1).padStart(2, "0")}</span>
      <CodexSticker id={sticker} />
      <span>{title}</span>
      <ArrowDownRight aria-hidden="true" />
    </a>)}
  </nav>;
}
