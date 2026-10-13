import type { ChipStatus } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/** Badge "StatusChip": dot + text (spec §4). progress = pulsing blue dot. */
export function StatusChip({ status, children, className }: { status: ChipStatus; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[13px] whitespace-nowrap text-fg", className)}>
      <i className="dot" data-status={status} aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  )
}
