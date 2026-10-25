import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

interface TagInputModalProps {
  open: boolean;
  count: number;
  onConfirm: (tag: string) => void;
  onCancel: () => void;
}

export function TagInputModal({
  open,
  count,
  onConfirm,
  onCancel,
}: TagInputModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();
  const nearLimit = value.length >= 40;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="codex-overlay fixed inset-0 z-50 bg-overlay/65" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="codex-modal codex-dialog fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg focus:outline-none"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-accent/10 p-2">
              <Tag className="h-5 w-5 text-accent" />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold text-foreground">
                {t("modals.tag_input_title")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-text">
                {t("modals.tag_input_message", { count })}
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-4">
            <input
              ref={inputRef}
              type="text"
              aria-label={t("modals.tag_input_title", { defaultValue: "Add a tag" })}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && trimmed) {
                  onConfirm(trimmed);
                  setValue("");
                }
              }}
              placeholder={t("modals.tag_input_placeholder")}
              maxLength={50}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {nearLimit && (
              <p className="mt-1 text-right text-xs text-muted-text">
                {value.length}/50
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => {
                if (!trimmed) return;
                onConfirm(trimmed);
                setValue("");
              }}
              disabled={!trimmed}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-solid hover:bg-accent-hover disabled:opacity-50"
            >
              {t("modals.tag_input_confirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
