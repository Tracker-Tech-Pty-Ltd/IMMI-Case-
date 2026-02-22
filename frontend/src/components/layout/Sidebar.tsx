import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FileText,
  CloudDownload,
  Workflow,
  Activity,
  BookOpen,
  BookMarked,
  Palette,
  TrendingUp,
  Users,
  Tags,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/prefetch";

interface NavItem {
  readonly to: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly description?: string;
}

interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { t } = useTranslation();

  const navGroups: readonly NavGroup[] = [
    {
      title: t("nav.browse"),
      items: [
        { to: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
        { to: "/analytics", icon: TrendingUp, label: t("nav.analytics") },
        { to: "/judge-profiles", icon: Users, label: t("nav.judge_profiles") },
        { to: "/cases", icon: FileText, label: t("nav.cases") },
      ],
    },
    {
      title: t("nav.search"),
      items: [
        {
          to: "/taxonomy",
          icon: Tags,
          label: t("nav.search_taxonomy"),
        },
        {
          to: "/guided-search",
          icon: Search,
          label: t("nav.guided_search"),
        },
      ],
    },
    {
      title: t("nav.data_tools"),
      items: [
        {
          to: "/download",
          icon: CloudDownload,
          label: t("pipeline.download_title"),
          description: t("pipeline.download_description"),
        },
        {
          to: "/pipeline",
          icon: Workflow,
          label: t("pipeline.crawl_title"),
          description: t("pipeline.crawl_description"),
        },
        {
          to: "/jobs",
          icon: Activity,
          label: t("nav.jobs"),
        },
      ],
    },
    {
      title: t("nav.reference"),
      items: [
        {
          to: "/legislations",
          icon: BookMarked,
          label: t("nav.legislations", "Legislations"),
        },
        {
          to: "/data-dictionary",
          icon: BookOpen,
          label: t("nav.data_dictionary"),
        },
        { to: "/design-tokens", icon: Palette, label: t("nav.design_tokens") },
      ],
    },
  ];

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
        {navGroups.map((group, gi) => (
          <div key={group.title} className={cn(gi > 0 && "mt-4")}>
            {!collapsed && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
                {group.title}
              </p>
            )}
            {collapsed && gi > 0 && (
              <div className="mx-3 mb-2 border-t border-border-light" />
            )}
            {group.items.map(({ to, icon: Icon, label, description }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                title={description ?? label}
                onMouseEnter={() => prefetchRoute(to)}
                onFocus={() => prefetchRoute(to)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent-muted text-accent"
                      : "text-secondary-text hover:bg-surface hover:text-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        {!collapsed && (
          <p className="text-xs text-muted-text">{t("dashboard.subtitle")}</p>
        )}
      </div>
    </aside>
  );
}
