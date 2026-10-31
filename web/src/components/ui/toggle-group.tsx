"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

/* Segmented control (mockup .seg): spec §4 "ToggleGroup type single, variant outline". Long groups scroll inside. */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  // design validation F2: fade the right edge while part of the group is hidden (internal scroll)
  const ref = React.useRef<HTMLDivElement>(null)
  const [fade, setFade] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    el.addEventListener("scroll", check, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener("scroll", check)
    }
  }, [])
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      data-slot="toggle-group"
      data-fade={fade || undefined}
      className={cn(
        "no-scrollbar inline-flex max-w-full min-w-0 gap-0.5 overflow-x-auto rounded-[12px] border border-line-soft bg-card-2 p-[3px] data-[fade]:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]",
        className
      )}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex min-h-10 min-w-10 items-center justify-center rounded-[9px] border-0 bg-transparent px-3 py-1.5 tablet:min-h-0 tablet:min-w-0 text-[13px] font-semibold whitespace-nowrap text-fg-btn outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring data-[state=on]:bg-card data-[state=on]:text-fg data-[state=on]:shadow-[0_0_0_1px_var(--line)]",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
