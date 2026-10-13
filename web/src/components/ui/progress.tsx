"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

/* blue while running, green when complete (spec §4) */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const v = value ?? 0
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={v}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-line-soft", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("h-full transition-[width] duration-600 ease-out", v >= 100 ? "bg-status-approved" : "bg-status-progress")}
        style={{ width: `${v}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
