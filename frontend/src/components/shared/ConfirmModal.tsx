import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const isDanger = variant === "danger";

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#111820]/65 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const cancelBtn = (
              e.currentTarget as HTMLElement
            ).querySelector<HTMLButtonElement>(
              '[data-testid="confirm-modal-cancel-btn"]',
            );
            cancelBtn?.focus();
          }}
        >
          <div className="flex items-start gap-3">
            {isDanger && (
              <div
                className="rounded-full bg-danger/10 p-2"
                aria-hidden="true"
              >
                <AlertTriangle className="h-5 w-5 text-danger" />
              </div>
            )}
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold text-foreground">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-text">
                {message}
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              data-testid="confirm-modal-cancel-btn"
              onClick={onCancel}
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              data-testid="confirm-modal-confirm-btn"
              onClick={onConfirm}
              className={
                isDanger
                  ? "rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2"
                  : "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              }
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
