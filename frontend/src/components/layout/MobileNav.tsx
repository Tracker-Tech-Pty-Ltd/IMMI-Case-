import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { APP_NAV_GROUPS } from "@/components/layout/nav-config";

/** Tailwind `lg`. Above this width AppLayout renders the desktop Sidebar. */
const DESKTOP_QUERY = "(min-width: 1024px)";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const { t } = useTranslation();
  const { savedSearches } = useSavedSearches();

  // A Radix dialog keeps its focus trap and pointer blocking even while
  // `lg:hidden` hides it, so an open drawer that survives a resize to desktop
  // becomes an invisible modal over the desktop layout. Close it instead.
  // `mobileOpen` is owned by AppLayout (out of scope), so this component asks
  // to be closed rather than closing itself.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    if (mql.matches) {
      onClose();
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) onClose();
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [open, onClose]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--color-overlay)]/65 backdrop-blur-sm lg:hidden" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar shadow-lg lg:hidden"
          aria-describedby={undefined}
        >
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2">
              <FileText className="h-6 w-6 text-accent" />
              <Dialog.Title asChild>
                <span className="font-heading text-lg font-semibold">
                  IMMI-Case
                </span>
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-text hover:bg-surface"
                aria-label={t("common.close_menu")}
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <nav className="flex-1 overflow-y-auto p-2">
            {APP_NAV_GROUPS.map((group, gi) => (
              <div key={group.titleKey} className={cn(gi > 0 && "mt-3")}>
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
                  {t(group.titleKey)}
                </p>
                {group.items.map(
                  ({ to, icon: Icon, labelKey, descriptionKey, showSavedSearchBadge }) => {
                    const label = t(labelKey);
                    const description = descriptionKey
                      ? t(descriptionKey)
                      : undefined;
                    return (
                      <NavLink
                        key={`${to}-${labelKey}`}
                        to={to}
                        end={to === "/"}
                        onClick={onClose}
                        title={description ?? label}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                            isActive
                              ? "bg-accent-muted text-accent"
                              : "text-muted-text hover:bg-surface hover:text-foreground",
                          )
                        }
                      >
                        <Icon className="h-4 w-4" />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {showSavedSearchBadge && savedSearches.length > 0 && (
                          <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-semibold text-accent">
                            {savedSearches.length}
                          </span>
                        )}
                      </NavLink>
                    );
                  },
                )}
              </div>
            ))}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
