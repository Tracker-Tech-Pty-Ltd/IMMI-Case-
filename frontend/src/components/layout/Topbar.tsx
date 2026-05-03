import { Menu, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CelestialToggle } from "./CelestialToggle";
import { TenantSwitcher } from "./TenantSwitcher";
import { useAuth } from "@/contexts/AuthContext";

interface TopbarProps {
  onMenuClick: () => void;
  onSearchClick?: () => void;
}

export function Topbar({ onMenuClick, onSearchClick }: TopbarProps) {
  const { t, i18n } = useTranslation();
  const isZhTW = i18n.language === "zh-TW";
  const { isAuthenticated } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-md p-1.5 text-muted-text hover:bg-surface hover:text-foreground lg:hidden"
          aria-label={t("common.menu", { defaultValue: "Toggle menu" })}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="whitespace-nowrap font-heading text-base font-semibold text-foreground lg:hidden">
          IMMI-Case
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Mobile search trigger */}
        <button
          onClick={onSearchClick}
          className="rounded-md p-1.5 text-muted-text hover:bg-surface hover:text-foreground sm:hidden"
          aria-label={t("common.search", { defaultValue: "Search" })}
        >
          <Search className="h-5 w-5" />
        </button>

        {/* Search trigger */}
        <button
          onClick={onSearchClick}
          className={cn(
            "hidden w-64 items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-sm text-muted-text transition-colors hover:border-accent sm:flex",
          )}
          aria-label={t("common.search", { defaultValue: "Search" })}
        >
          <Search className="h-3.5 w-3.5" />
          <span>{t("common.search_placeholder")}</span>
          <kbd className="ml-auto rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-text">
            /
          </kbd>
        </button>

        {/* Language toggle — same height as search bar (py-1.5) */}
        <button
          onClick={() => i18n.changeLanguage(isZhTW ? "en" : "zh-TW")}
          className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-text transition-colors hover:bg-surface hover:text-foreground"
          title={t("common.toggle_language")}
        >
          {isZhTW ? "EN" : "中文"}
        </button>

        {/* Tenant switcher — only renders when user has multiple tenants */}
        <TenantSwitcher />

        {/* Login link — only on mobile (sidebar handles desktop) */}
        {!isAuthenticated && (
          <Link
            to="/login"
            className="lg:hidden rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-text transition-colors hover:bg-surface hover:text-foreground"
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
