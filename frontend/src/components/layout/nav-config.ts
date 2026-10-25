import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FileText,
  Activity,
  BookOpen,
  BookMarked,
  TrendingUp,
  Users,
  Network,
  Bookmark,
  BookmarkCheck,
  Tags,
  Search,
  Scale,
  ShieldCheck,
  Zap,
  Newspaper,
} from "lucide-react";

export interface AppNavItem {
  readonly to: string;
  readonly icon: LucideIcon;
  readonly labelKey: string;
  readonly descriptionKey?: string;
  readonly showSavedSearchBadge?: boolean;
  readonly adminOnly?: boolean;
}

export interface AppNavGroup {
  readonly titleKey: string;
  readonly items: readonly AppNavItem[];
}

export const APP_NAV_GROUPS: readonly AppNavGroup[] = [
  {
    titleKey: "nav.browse",
    items: [
      { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
      { to: "/cases", icon: FileText, labelKey: "nav.cases" },
      { to: "/analytics", icon: TrendingUp, labelKey: "nav.analytics" },
      { to: "/judge-profiles", icon: Users, labelKey: "nav.judge_profiles" },
      { to: "/news", icon: Newspaper, labelKey: "nav.news", descriptionKey: "nav_descriptions.news" },
    ],
  },
  {
    titleKey: "nav.workspace",
    items: [
      {
        to: "/collections",
        icon: BookmarkCheck,
        labelKey: "nav.collections",
      },
      {
        to: "/saved-searches",
        icon: Bookmark,
        labelKey: "nav.saved_searches",
        showSavedSearchBadge: true,
      },
    ],
  },
  {
    titleKey: "nav.search",
    items: [
      { to: "/taxonomy", icon: Tags, labelKey: "nav.search_taxonomy" },
      { to: "/guided-search", icon: Search, labelKey: "nav.guided_search" },
      { to: "/search/semantic", icon: Zap, labelKey: "nav.semantic_search" },
      { to: "/llm-council", icon: Scale, labelKey: "nav.llm_council" },
    ],
  },
  {
    titleKey: "nav.data_tools",
    items: [
      {
        to: "/data-tools",
        icon: Activity,
        labelKey: "nav.data_tools",
        descriptionKey: "nav_descriptions.data_tools",
      },
      {
        to: "/admin/pipeline-runs",
        icon: ShieldCheck,
        labelKey: "nav.pipeline_runs",
        descriptionKey: "nav_descriptions.pipeline_runs",
        adminOnly: true,
      },
    ],
  },
  {
    titleKey: "nav.reference",
    items: [
      { to: "/court-lineage", icon: Network, labelKey: "nav.court_lineage" },
      {
        to: "/legislations",
        icon: BookMarked,
        labelKey: "nav.legislations",
      },
      {
        to: "/data-dictionary",
        icon: BookOpen,
        labelKey: "nav.data_dictionary",
      },
    ],
  },
];
