"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

/** Small lime % ring of the stage card (spec §4: 40 px). Counts from 0 in `ms` when `animate` (tour stop 1). */
export function MiniRing({ percent, animate, ms = 7000, onInk = true, label }: { percent: number; animate?: boolean; ms?: number; onInk?: boolean; label?: (v: number) => ReactNode }) {
  const [v, setV] = useState(() => (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : percent))
  useEffect(() => {
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      setV(Math.round(percent * k))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate, ms, percent])
  const shown = animate ? v : percent
  const C = 2 * Math.PI * 16
  const ring = (
    <span className="relative size-10 flex-none" aria-hidden="true">
      <svg viewBox="0 0 40 40" className="size-10 -rotate-90">
        <circle cx="20" cy="20" r="16" fill="none" strokeWidth={5} stroke={onInk ? "#2E3238" : "var(--line-soft)"} />
        <circle cx="20" cy="20" r="16" fill="none" strokeWidth={5} stroke="#C8F03C" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)} />
      </svg>
      <b className="absolute inset-0 grid place-items-center font-mono text-[11px] font-semibold tabular-nums">{shown}%</b>
    </span>
  )
  return label ? (
    <>
      {ring}
      {label(shown)}
    </>
  ) : (
    ring
  )
}

/** Sheet for the drawer outside the stage (List view, phone): right side on desktop, bottom 88 % under 761 px. */
export function BrainSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const t = useTranslations("brain.g.drawer")
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[84] bg-[rgba(22,24,27,.55)]" />
        <DialogPrimitive.Content
          aria-labelledby="brain-drawer-title"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed z-[85] flex flex-col overflow-hidden bg-card text-fg shadow-[0_20px_50px_rgba(0,0,0,.35)] outline-none",
            "inset-x-0 bottom-0 h-[88dvh] rounded-t-[20px]",
            "tablet:inset-y-0 tablet:right-0 tablet:left-auto tablet:h-auto tablet:w-[420px] tablet:max-w-full tablet:rounded-none tablet:pt-[env(safe-area-inset-top,0px)]"
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t("sheet")}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
