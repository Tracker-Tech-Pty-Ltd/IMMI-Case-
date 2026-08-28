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
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent">
      <span className="text-accent/60">{label}:</span>
      {value}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${removeLabel}: ${label}: ${value}`}
        className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
