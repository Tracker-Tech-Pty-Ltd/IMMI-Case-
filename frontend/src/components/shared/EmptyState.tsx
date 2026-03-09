import type { ReactNode } from "react"
import { StatePanel } from "@/components/shared/StatePanel"

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
  contained?: boolean
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  contained = true,
}: EmptyStateProps) {
  return (
    <StatePanel
      title={title}
      description={description}
      icon={icon}
      action={action}
      contained={contained}
      className={className}
    />
  )
}
