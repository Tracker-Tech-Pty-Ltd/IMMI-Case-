import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { CodexSticker } from "@/components/shared/CodexSticker";
import type { CodexStickerId } from "@/lib/codex-stickers";

/** Native disclosure adapted from 21st/shadcnspace/accordion-09. */
export function CodexDisclosure({ title, sticker, children, id }: {
  title: string;
  sticker: CodexStickerId;
  children: ReactNode;
  id?: string;
}) {
  return <details id={id} className="codex-disclosure" open>
    <summary>
      <CodexSticker id={sticker} />
      <h2>{title}</h2>
      <span aria-hidden="true" className="codex-disclosure-toggle">
        <Plus className="codex-disclosure-plus" />
        <Minus className="codex-disclosure-minus" />
      </span>
    </summary>
    <div className="codex-disclosure-content">{children}</div>
  </details>;
}
