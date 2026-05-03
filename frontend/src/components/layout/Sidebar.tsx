import { NavLink, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText, Bookmark, BookmarkCheck, LogOut, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/prefetch";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { APP_NAV_GROUPS } from "@/components/layout/nav-config";
import { useAuth } from "@/contexts/AuthContext";

function RecentBookmarksPanel() {
  const { t } = useTranslation();
  const { recentBookmarks } = useBookmarks();
  const navigate = useNavigate();

  if (recentBookmarks.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
        {t("bookmarks.recent", "Recent Bookmarks")}
      </p>
      {recentBookmarks.map((b) => (
        <button
          key={b.case_id}
          onClick={() => navigate(`/cases/${b.case_id}`)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-muted-text hover:bg-surface hover:text-foreground transition-colors"
          title={b.case_citation || b.case_title}
        >
          <Bookmark className="h-3 w-3 shrink-0 text-accent" />
          <span className="truncate">{b.case_citation || b.case_title}</span>
        </button>
      ))}
      <NavLink
        to="/collections"
        className="mt-1 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-text hover:bg-surface hover:text-foreground transition-colors"
      >
        <BookmarkCheck className="h-3 w-3 shrink-0" />
        {t("bookmarks.view_all_collections", "All Collections")}
      </NavLink>
    </div>
  );
}

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { t } = useTranslation();
  const { savedSearches } = useSavedSearches();
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-border bg-sidebar transition-all duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <FileText className="h-6 w-6 shrink-0 text-accent" />
        {!collapsed && (
          <span className="font-heading text-lg font-semibold text-foreground">
            IMMI-Case
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {APP_NAV_GROUPS.map((group, gi) => (
          <div key={group.titleKey} className={cn(gi > 0 && "mt-4")}>
            {!collapsed && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
                {t(group.titleKey)}
              </p>
            )}
            {collapsed && gi > 0 && (
              <div className="mx-3 mb-2 border-t border-border-light" />
            )}
            {group.items.map(({ to, icon: Icon, labelKey, showSavedSearchBadge }) => {
              const label = t(labelKey);
              return (
                <NavLink
                  key={`${to}-${labelKey}`}
                  to={to}
                  end={to === "/"}
                  title={label}
                  onMouseEnter={() => prefetchRoute(to)}
                  onFocus={() => prefetchRoute(to)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent-muted text-accent"
                        : "text-muted-text hover:bg-surface hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {showSavedSearchBadge && savedSearches.length > 0 && (
                        <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-semibold text-accent shrink-0">
                          {savedSearches.length}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
        {!collapsed && <RecentBookmarksPanel />}
      </nav>

      {/* Footer — auth state */}
      <div className="border-t border-border p-3">
        {isAuthenticated && user ? (
          <div className="flex items-center gap-2">
            {user.photo_url ? (
              <img
                src={user.photo_url}
                alt={user.first_name ?? "User"}
                className="h-7 w-7 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="h-7 w-7 rounded-full bg-accent-muted flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-accent">
                  {(user.first_name?.[0] ?? "U").toUpperCase()}
                </span>
              </div>
            )}
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {user.first_name ?? user.username ?? "User"}
                </span>
                <button
                  onClick={logout}
                  title={t("auth.logout", "Sign out")}
                  className="rounded p-1 text-muted-text hover:bg-surface hover:text-foreground transition-colors"
                  aria-label={t("auth.logout", "Sign out")}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ) : (
          !collapsed && (
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-text hover:bg-surface hover:text-foreground transition-colors"
            >
              <LogIn className="h-4 w-4 shrink-0" />
              <span>{t("auth.sign_in", "Sign in")}</span>
            </Link>
          )
        )}
      </div>
    </aside>
  );
}
