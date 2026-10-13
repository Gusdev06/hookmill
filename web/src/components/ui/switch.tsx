"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

/* mockup .switch: 32x18, line-2 off, blue on */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-line-strong p-0 outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-fg",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[18px] translate-x-[3px] rounded-full bg-white transition-transform duration-150 data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-brand"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
