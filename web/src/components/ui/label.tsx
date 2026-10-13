"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Label as LabelPrimitive } from "radix-ui"

/* mockup .field label: 13px, fg-2 */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("flex flex-wrap items-center gap-2 text-[13px] text-fg-2 select-none", className)}
      {...props}
    />
  )
}

export { Label }
