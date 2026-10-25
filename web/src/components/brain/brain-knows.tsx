"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import type { BrainCompleteness, BrainSection, Offer, Workspace } from "@/lib/api/types"
import { buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { BRAIN_SECTIONS, brainCompleteness } from "@/lib/brain"
import { BRAIN_ITEM_STEP, onboardingHref } from "@/components/onboarding/shared"
import { cn } from "@/lib/utils"

/*
 * "What the Brain knows" (spec decision 10, mockup .ring + .bsec): the 2D ring with the real % and the 5 sections
 * (check lime · partial amber · empty). With `animate` (tour stop 1) the ring counts from 0 to the real % in ≈ 2 s while
 * the sections light up in order; `prefers-reduced-motion` skips the count.
 */
export const SECTION_ORDER: BrainSection[] = ["business_offer", "audience", "proof", "custom_instructions", "goals"]
const R = 40
const C = 2 * Math.PI * R

export function BrainKnows({ ws, offers, animate, fillLinks = true, className }: { ws: Workspace; offers: Offer[]; animate?: boolean; fillLinks?: boolean; className?: string }) {
  const brain = brainCompleteness(ws, offers)
  return (
    <div className={cn("flex flex-wrap items-start gap-[18px]", className)}>
      <BrainRing percent={brain.percent} animate={animate} />
      <SectionList brain={brain} animate={animate} fillLinks={fillLinks} />
    </div>
  )
}

/**
 * The value shown: counts from 0 to the real % when `animate` (≈ 2 s; instant with prefers-reduced-motion), else the real one.
 * The parent remounts the component when `animate` flips (key), so the count starts at mount.
 */
function useCounted(target: number, animate?: boolean) {
  const [v, setV] = useState(() => (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : target))
  useEffect(() => {
    if (!animate) return
    const id = setInterval(() => {
      setV((cur) => {
        const next = Math.min(target, cur + 2)
        if (next >= target) clearInterval(id)
        return next
      })
    }, 38)
    return () => clearInterval(id)
  }, [target, animate])
  return animate ? Math.min(v, target) : target
}

export function BrainRing({ percent, animate, size = 96 }: { percent: number; animate?: boolean; size?: number }) {
  const t = useTranslations("brain")
  const v = useCounted(percent, animate)
  return (
    <div className="relative flex-none" style={{ width: size, height: size }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("ringLabel")}>
      <svg viewBox="0 0 96 96" width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx="48" cy="48" r={R} fill="none" strokeWidth={9} className="stroke-line-soft" />
        <circle cx="48" cy="48" r={R} fill="none" strokeWidth={9} strokeLinecap="round" className="stroke-brand-edge transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none" strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-xl font-semibold tabular-nums">{v}%</span>
    </div>
  )
}

function SectionList({ brain, animate, fillLinks }: { brain: BrainCompleteness; animate?: boolean; fillLinks: boolean }) {
  const tb = useTranslations("onboarding.brain")
  const t = useTranslations("brain")
  const v = useCounted(brain.percent, animate)
  const lit = animate ? Math.floor((v / Math.max(1, brain.percent)) * SECTION_ORDER.length) : SECTION_ORDER.length
  return (
    <ul className="m-0 flex min-w-0 flex-[1_1_260px] list-none flex-col p-0">
      {SECTION_ORDER.map((s, i) => {
        const st = i < lit ? brain.sections[s] : null
        const missing = BRAIN_SECTIONS[s].filter((x) => brain.missing.includes(x))
        return (
          <li key={s} className="flex items-start gap-2.5 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0">
            <span
              aria-hidden="true"
              className={cn(
                "inline-grid size-6 flex-none place-items-center rounded-full border-[1.5px] transition-[background-color,border-color] duration-250",
                st === "ok" ? "border-brand bg-brand text-[#15171a]" : st === "partial" ? "border-status-waiting-bg bg-status-waiting-bg text-status-waiting" : "border-control text-fg-3"
              )}
            >
              {st === "ok" ? <Icon name="check" /> : st === "partial" ? <Icon name="minus" /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b>{tb(`section.${s}`)}</b>
              <small className="text-[13px] text-fg-3">
                {st === "ok" ? tb("sectionOk") : st === null ? "…" : tb("sectionMissing", { items: missing.map((x) => tb(`item.${x}`)).join(", ") })}
              </small>
            </span>
            {fillLinks && st !== null && st !== "ok" ? (
              <Link href={onboardingHref(BRAIN_ITEM_STEP[missing[0] ?? "offer"])} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                {t("fill")}
              </Link>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
