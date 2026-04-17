import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { APP_NAV_GROUPS } from "@/components/layout/nav-config";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const { t } = useTranslation();
  const { savedSearches } = useSavedSearches();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-40 bg-[#111820]/65 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-label={t("common.close_menu")}
      />
      {/* Drawer */}
      <div
        className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar shadow-lg lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-nav-title"
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-accent" />
            <span id="mobile-nav-title" className="font-heading text-lg font-semibold">
              IMMI-Case
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-text hover:bg-surface"
            aria-label={t("common.close_menu")}
          >
            <X className="h-5 w-5" />
          </button>
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
      </div>
    </>
  );
}
