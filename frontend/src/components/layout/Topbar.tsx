import { Menu, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CelestialToggle } from "./CelestialToggle";
import { TenantSwitcher } from "./TenantSwitcher";
import { useAuth } from "@/contexts/AuthContext";

interface TopbarProps {
  onMenuClick: () => void;
  menuOpen?: boolean;
  onSearchClick?: () => void;
}

export function Topbar({ onMenuClick, onSearchClick, menuOpen = false }: TopbarProps) {
  const { t, i18n } = useTranslation();
  const isZhTW = i18n.language === "zh-TW";
  const { isAuthenticated } = useAuth();

  return (
    <header className="codex-topbar sticky top-0 z-20 border-b border-border-light bg-card px-4">
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <button
          onClick={onMenuClick}
          data-mobile-menu-trigger
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? "codex-mobile-navigation" : undefined}
          className="codex-icon-button rounded-md text-muted-text hover:bg-surface hover:text-foreground"
          aria-label={t("common.menu", { defaultValue: "Toggle menu" })}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="whitespace-nowrap font-heading text-base font-semibold text-foreground lg:hidden">
          IMMI-Case
        </span>
      </div>

      <div className="codex-topbar-actions flex min-w-0 items-center gap-2 font-data">
        {/* Search trigger */}
        <button
          onClick={onSearchClick}
          data-global-search-trigger
          className={cn(
            "codex-search-trigger flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted-text transition-colors hover:border-accent",
          )}
          aria-label={t("common.search", { defaultValue: "Search" })}
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden truncate sm:inline">{t("common.search_placeholder", { defaultValue: "Search cases…" })}</span>
          <kbd className="ml-auto hidden rounded bg-card px-1.5 py-0.5 font-mono text-xs text-muted-text md:inline">
            /
          </kbd>
        </button>

        {/* Language toggle — same height as search bar (py-1.5) */}
        <button
          onClick={() => i18n.changeLanguage(isZhTW ? "en" : "zh-TW")}
          className="codex-control shrink-0 rounded-md border border-border px-3 text-sm font-medium text-muted-text transition-colors hover:bg-surface hover:text-foreground"
          title={t("common.toggle_language")}
          aria-label={t("common.toggle_language", { defaultValue: "Toggle language" })}
        >
          {isZhTW ? "EN" : "中文"}
        </button>

        {/* Tenant switcher — only renders when user has multiple tenants */}
        <TenantSwitcher />

        {/* Login link — only on mobile (sidebar handles desktop) */}
        {!isAuthenticated && (
          <Link
            to="/login"
            className="codex-control flex shrink-0 items-center rounded-md border border-border px-3 text-sm font-medium text-muted-text transition-colors hover:bg-surface hover:text-foreground lg:hidden"
          >
            {t("auth.sign_in", "Sign in")}
          </Link>
        )}

        {/* Celestial theme toggle */}
        <CelestialToggle />
      </div>
    </header>
  );
}
