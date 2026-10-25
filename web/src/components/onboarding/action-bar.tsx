"use client"

import { useEffect } from "react"
import { cn } from "@/lib/utils"

/*
 * Action bar of the minimal shell (spec §4, mockup .actionbar): hint on the left, Back + (Skip outline) + the one lime
 * action on the right. Desktop: sticky card at the bottom of the column. Phone (≤760 px): fixed full width with the safe
 * area; 2 buttons = `auto 1fr`, 3 buttons = `auto 1fr 1fr`.
 */
export function ActionBar({
  hint,
  hintWarn,
  back,
  secondary,
  primary,
  className,
}: {
  hint?: React.ReactNode
  /** validation hint: amber */
  hintWarn?: boolean
  back?: React.ReactNode
  secondary?: React.ReactNode
  primary: React.ReactNode
  className?: string
}) {
  useEffect(() => {
    document.documentElement.style.setProperty("--toast-bottom", "120px")
    return () => {
      document.documentElement.style.removeProperty("--toast-bottom")
    }
  }, [])
  const cols = back && secondary ? "grid-cols-[auto_1fr_1fr]" : back ? "grid-cols-[auto_1fr]" : secondary ? "grid-cols-2" : "grid-cols-1"
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-2.5 border-t border-line bg-card px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] shadow-[0_-6px_24px_rgba(21,23,26,0.06)] tablet:sticky tablet:mt-1 tablet:rounded-lg tablet:border tablet:py-2.5 tablet:pr-2.5 tablet:pl-[18px]",
        className
      )}
    >
      {hint ? <span className={cn("min-w-0 flex-[1_1_100%] text-[13px] tablet:flex-[1_1_220px]", hintWarn ? "text-status-waiting" : "text-fg-2")}>{hint}</span> : null}
      <div className={cn("grid w-full gap-2 tablet:ml-auto tablet:flex tablet:w-auto tablet:flex-wrap [&>*]:w-full tablet:[&>*]:w-auto", cols)}>
        {back}
        {secondary}
        {primary}
      </div>
    </div>
  )
}
