import { ChevronRight } from "lucide-react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"

interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbProps {
  items: BreadcrumbItem[]
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t("common.breadcrumb", { defaultValue: "Breadcrumb" })} className="flex min-w-0 flex-wrap items-center gap-1 font-data text-sm text-muted-text">
      {items.map((item, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1 break-words">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {item.href ? (
            <Link to={item.href} className="hover:text-foreground transition-colors">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="font-medium text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
