import { cn } from "@/lib/utils";
import "@/styles/news-codex.css";
import type { CodexStickerId } from "@/lib/codex-stickers";

/** Decorative twins; the adjacent real text always supplies the accessible name. */
export function CodexSticker({ id, className }: { id: CodexStickerId; className?: string }) {
  const base = `${import.meta.env.BASE_URL}assets/legal-codex-stickers/${id === "document" ? "document-v2" : id}`;
  return <span aria-hidden="true" data-codex-sticker={id} className={cn("codex-sticker", className)}>
    <img src={`${base}-light.webp`} alt="" width="256" height="256" loading="lazy" decoding="async" className="codex-sticker-light" />
    <img src={`${base}-dark.webp`} alt="" width="256" height="256" loading="lazy" decoding="async" className="codex-sticker-dark" />
  </span>;
}
