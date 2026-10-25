"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import type { OnboardingStepInfo } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/*
 * SetupProgress (spec §4, mockup .prog): replaces the 280 px WizardRail inside the onboarding. Big % (mono 22) +
 * "Step N of 6 · name"; desktop: the 6 steps as a ruler of buttons (reached steps link, future ones disabled);
 * phone: only the ruler segments. `role="group"`, `aria-current="step"` on the current one.
 */
export function SetupProgress({
  steps,
  current,
  percent,
  hrefFor,
  allClickable,
}: {
  /** enabled steps only (5 when META_MODE=off) */
  steps: OnboardingStepInfo[]
  /** 1..6 (the contract's step number, not the position) */
  current: number
  percent: number
  hrefFor: (step: number) => string
  /** edit mode after LIVE: every step is reachable */
  allClickable?: boolean
}) {
  const t = useTranslations("onboarding")
  const total = steps.length
  const pos = Math.max(0, steps.findIndex((s) => s.step === current))
  const name = steps[pos] ? t(`rail.${steps[pos].key}.title`) : ""
  const reached = (i: number) => allClickable || i <= pos || steps[i].state === "done" || steps[i].state === "skipped"
  const seg = (i: number) => (i < pos ? "bg-fg" : i === pos ? "bg-brand outline outline-1 outline-brand-edge" : "bg-line")

  return (
    <div role="group" aria-label={t("railLabel")} className="flex flex-col gap-2.5 rounded-xl border border-line bg-card px-[18px] py-3.5">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-mono text-[22px] font-semibold tabular-nums">{percent}%</span>
          <span className="text-fg-3">{t("setUp")}</span>
        </span>
        <span className="min-w-0 truncate text-[13px] text-fg-3">{t("stepOfNamed", { n: pos + 1, total, title: name })}</span>
      </div>
      {/* desktop ruler with names */}
      <ol className="m-0 hidden list-none gap-1.5 p-0 tablet:grid" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const label = t(`rail.${s.key}.title`)
          const cls = cn("flex min-w-0 flex-col gap-1.5 text-left text-xs", i === pos ? "font-bold text-fg" : "text-fg-3")
          const bar = <i aria-hidden="true" className={cn("block h-1.5 rounded-full", seg(i))} />
          return (
            <li key={s.key} className="min-w-0">
              {i !== pos && reached(i) ? (
                <Link href={hrefFor(s.step)} className={cn(cls, "rounded-sm hover:text-fg")}>
                  {bar}
                  <span className="truncate">{label}</span>
                </Link>
              ) : (
                <span className={cls} aria-current={i === pos ? "step" : undefined} aria-disabled={i !== pos || undefined}>
                  {bar}
                  <span className="truncate">
                    {label}
                    {s.state === "done" && i !== pos ? <span className="sr-only"> ({t("stepDone")})</span> : null}
                  </span>
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {/* phone: segments only */}
      <div className="grid gap-[3px] tablet:hidden" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }} aria-hidden="true">
        {steps.map((s, i) => (
          <i key={s.key} className={cn("block h-[5px] rounded-full", seg(i))} />
        ))}
      </div>
    </div>
  )
}
