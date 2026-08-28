import { cn } from "@/lib/utils"

const courtColorMap: Record<string, string> = {
  AATA: "bg-court-aata",
  ARTA: "bg-court-arta",
  FCA: "bg-court-fca",
  FCCA: "bg-court-fcca",
  FedCFamC2G: "bg-court-fedc",
  HCA: "bg-court-hca",
  RRTA: "bg-court-rrta",
  MRTA: "bg-court-mrta",
  FMCA: "bg-court-fmca",
}

const courtNameMap: Record<string, string> = {
  AATA: "Administrative Appeals Tribunal",
  ARTA: "Administrative Review Tribunal",
  FCA: "Federal Court of Australia",
  FCCA: "Federal Circuit Court of Australia",
  FedCFamC2G: "Federal Circuit and Family Court of Australia (Division 2)",
  HCA: "High Court of Australia",
  RRTA: "Refugee Review Tribunal",
  MRTA: "Migration Review Tribunal",
  FMCA: "Federal Magistrates Court of Australia",
}

interface CourtBadgeProps {
  court: string
  className?: string
}

export function CourtBadge({ court, className }: CourtBadgeProps) {
  const bg = courtColorMap[court] ?? "bg-primary-lighter"
  const fullName = courtNameMap[court]

  return (
    <>
      <span
        title={fullName}
        className={cn(
          "inline-flex shrink-0 cursor-default items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-medium text-white",
          bg,
          className
        )}
      >
        {court}
      </span>
      {fullName ? <span className="sr-only">{fullName}</span> : null}
    </>
  )
}
