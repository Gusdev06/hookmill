"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { ClientAvatar } from "@/components/shell/logo"
import { NavIcon } from "@/components/shell/nav-icon"
import { cn } from "@/lib/utils"

/*
 * WizardRail (artifact Ads Machine WizardRail): the vertical rail of a step-by-step setup (client onboarding).
 * Done = lime circle with check + lime line; current = ink circle; todo = empty circle. Progress bar on top.
 */
export interface RailStep {
  title: React.ReactNode
  desc?: React.ReactNode
  /** reachable steps link here; without href the step is text */
  href?: string
}

export function WizardRail({
  eyebrow,
  name,
  steps,
  current,
  footer,
  className,
  "aria-label": ariaLabel,
}: {
  eyebrow: React.ReactNode
  /** client name next to its avatar */
  name: string
  steps: RailStep[]
  /** 1-based */
  current: number
  /** e.g. "About 20 minutes…" + "Save and exit" */
  footer?: React.ReactNode
  className?: string
  "aria-label": string
}) {
  const t = useTranslations("rail")
  const total = steps.length
  const cur = Math.min(total, Math.max(1, current))
  const pct = Math.round(((cur - 1) / total) * 100)

  return (
    <aside aria-label={ariaLabel} className={cn("flex flex-col gap-[18px] rounded-xl border border-line bg-card p-5", className)}>
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{eyebrow}</span>
        <div className="flex items-center gap-2.5">
          <ClientAvatar name={name} />
          <strong className="wide min-w-0 truncate text-lg">{name}</strong>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[13px] text-fg-3">{t("stepOf", { n: cur, total })}</span>
          <span className="font-mono text-xs text-fg-3">{t("pctDone", { pct })}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
          <div className="h-full rounded-full bg-fg transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ol className="m-0 flex list-none flex-col p-0">
        {steps.map((s, i) => {
          const n = i + 1
          const done = n < cur
          const isCur = n === cur
          const body = (
            <>
              <span className={cn("text-sm", isCur ? "font-bold text-fg" : done ? "font-semibold text-fg" : "font-medium text-fg-btn")}>
                {s.title}
                {done ? <span className="sr-only"> ({t("done")})</span> : null}
              </span>
              {s.desc ? <span className="text-xs text-fg-3">{s.desc}</span> : null}
            </>
          )
          const cls = "flex min-h-11 min-w-0 flex-col gap-0.5 pt-[3px] pb-4"
          return (
            <li key={n} className="flex gap-3">
              <div className="flex w-7 flex-none flex-col items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-grid size-7 place-items-center rounded-full font-mono text-xs font-semibold",
                    done && "bg-brand text-[#15171a]",
                    isCur && "bg-fg text-card",
                    !done && !isCur && "border-[1.5px] border-control text-fg-3"
                  )}
                >
                  {done ? <NavIcon name="check" size={14} strokeWidth={2.5} /> : n}
                </span>
                {n < total ? <span aria-hidden="true" className={cn("min-h-[18px] w-0.5 flex-1", done ? "bg-brand-edge" : "bg-line")} /> : null}
              </div>
              {s.href && !isCur ? (
                <Link href={s.href} className={cn(cls, "rounded-sm hover:[&>span:first-child]:text-brand-ink")}>
                  {body}
                </Link>
              ) : (
                <div className={cls} aria-current={isCur ? "step" : undefined}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {footer ? <div className="flex flex-col gap-2.5 border-t border-line-soft pt-3.5">{footer}</div> : null}
    </aside>
  )
}
