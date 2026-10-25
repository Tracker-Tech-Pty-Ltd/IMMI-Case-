import { X } from "lucide-react"
import { useTranslation } from "react-i18next"

interface FilterPillProps {
  label: string
  value: string
  onRemove: () => void
}

export function FilterPill({ label, value, onRemove }: FilterPillProps) {
  const { t } = useTranslation()
  const removeLabel = t("filters.remove_filter", {
    defaultValue: "Remove filter",
  })

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-muted px-3 font-data text-xs font-medium text-accent">
      <span className="text-accent">{label}:</span>
      <span className="min-w-0 break-words">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${removeLabel}: ${label}: ${value}`}
        className="codex-icon-button shrink-0 rounded-full hover:bg-accent/20 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
