"use client"

import Link from "next/link"
import { Fragment } from "react"
import { useTranslations } from "next-intl"
import { NavIcon } from "@/components/shell/nav-icon"
import { SoonBadge } from "@/components/soon"
import { cn } from "@/lib/utils"

/*
 * FlowBar (fase2-telas-novas §2.1–2.3): both make-ads flows grouped in phases Plan → Make → Ship.
 * The current phase opens its steps; done phases collapse into a pill with a check ("Plan · 3 done",
 * clickable to go back); future phases show their name and steps as text. Soon steps (Concepts) have a
 * dashed circle and stay out of the "Step N of M" count. ≤760 px: one line + a segment ruler + Exit.
 */
export type FlowKind = "concepts" | "iterate"
export type FlowStep =
  | "know" | "concepts" | "scripts" | "face" | "engine" | "generate" | "edit" | "review" | "send"
  | "analyze" | "download"
type Phase = "plan" | "make" | "ship"

export const FLOWS: Record<FlowKind, { phase: Phase; steps: { id: FlowStep; soon?: boolean }[] }[]> = {
  concepts: [
    { phase: "plan", steps: [{ id: "know" }, { id: "concepts", soon: true }, { id: "scripts" }] },
    { phase: "make", steps: [{ id: "face" }, { id: "engine" }, { id: "generate" }, { id: "edit" }] },
    { phase: "ship", steps: [{ id: "review" }, { id: "send" }] },
  ],
  // variacao-auto-v1 (13/10): caminho 1 goes from 6 steps to 3 (Analyze → Generate → Download, one route)
  iterate: [
    { phase: "plan", steps: [{ id: "analyze" }] },
    { phase: "make", steps: [{ id: "generate" }] },
    { phase: "ship", steps: [{ id: "download" }] },
  ],
}

function Circ({ state, n, running }: { state: "done" | "current" | "todo" | "soon"; n?: number; running?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-grid size-6 flex-none place-items-center rounded-full border-[1.5px] border-control font-mono text-[11px] font-semibold text-fg",
        (state === "done" || state === "current") && "border-brand bg-brand text-[#15171a]",
        state === "soon" && "border-dashed text-fg-3",
        state === "current" && running && "circ-run"
      )}
    >
      {state === "done" ? <NavIcon name="check" size={12} strokeWidth={3} /> : state === "soon" ? "–" : n}
    </span>
  )
}

export function FlowBar({
  flow,
  current,
  running,
  hrefs = {},
  exitHref = "/",
  client,
  className,
}: {
  flow: FlowKind
  current: FlowStep
  /** the current step is working (Generate): spinning ring on its circle */
  running?: boolean
  /** where each reachable step lives; done steps without href render as text */
  hrefs?: Partial<Record<FlowStep, string>>
  exitHref?: string
  /** client (workspace) name shown above the flow name */
  client?: string
  className?: string
}) {
  const t = useTranslations("flow")
  const phases = FLOWS[flow]
  const all = phases.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.phase })))
  const active = all.filter((s) => !s.soon)
  const ci = active.findIndex((s) => s.id === current)
  const curPhase = all.find((s) => s.id === current)?.phase ?? "plan"
  const pi = phases.findIndex((p) => p.phase === curPhase)
  const numOf = (id: FlowStep) => active.findIndex((s) => s.id === id) + 1
  const name = t(`names.${flow}`)

  const step = (s: { id: FlowStep; soon?: boolean }) => {
    const label = t(`steps.${s.id}`)
    if (s.soon) {
      return (
        <span key={s.id} title={t("soonStep")} className="inline-flex min-h-[38px] cursor-help items-center gap-[7px] rounded-full pr-3 pl-1.5 font-semibold whitespace-nowrap text-fg-3">
          <Circ state="soon" />
          {label}
          <SoonBadge className="px-1.5 py-px text-[9px] [&_svg]:hidden" />
        </span>
      )
    }
    const i = active.findIndex((a) => a.id === s.id)
    const state = i < ci ? "done" : i === ci ? "current" : "todo"
    const cls = cn(
      "inline-flex min-h-[38px] items-center gap-[7px] rounded-full pr-3 pl-1.5 font-semibold whitespace-nowrap text-fg-btn",
      state === "done" && "text-fg",
      state === "current" && "bg-fg font-bold text-card"
    )
    const inner = (
      <>
        <Circ state={state} n={i + 1} running={state === "current" && running} />
        {label}
        {state === "current" && running ? <span className="sr-only">({t("running")})</span> : null}
      </>
    )
    const href = hrefs[s.id]
    if (state === "done" && href) {
      return (
        <Link key={s.id} href={href} className={cn(cls, "hover:bg-card")}>
          {inner}
        </Link>
      )
    }
    return (
      <span key={s.id} className={cls} aria-current={state === "current" ? "step" : undefined}>
        {inner}
      </span>
    )
  }

  return (
    <>
      {/* desktop */}
      <nav
        aria-label={t("aria", { name })}
        className={cn("hidden flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-lg border border-line bg-card py-2 pr-2.5 pl-[18px] min-[1100px]:flex", className)}
      >
        <div className="flex flex-col">
          {client ? <span className="eyebrow">{client}</span> : null}
          <b className="wide text-[15px]">{name}</b>
        </div>
        <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
          {phases.map((p, idx) => {
            const sep = idx > 0 ? (
              <li aria-hidden="true" className="text-sep">
                <NavIcon name="chev" size={16} strokeWidth={2} />
              </li>
            ) : null
            const real = p.steps.filter((s) => !s.soon)
            let body: React.ReactNode
            if (idx < pi) {
              const back = [...real].reverse().map((s) => hrefs[s.id]).find(Boolean)
              const content = (
                <>
                  <Circ state="done" />
                  {t(`phases.${p.phase}`)}
                  <small className="font-mono text-[11px] font-medium text-fg-3">{real.length === 1 ? t("stepDone", { step: t(`steps.${real[0].id}`) }) : t("phaseDone", { count: real.length })}</small>
                </>
              )
              const cls = "inline-flex min-h-11 items-center gap-2 rounded-full pr-3 pl-2 font-semibold text-fg"
              body = back ? (
                <Link href={back} className={cn(cls, "hover:bg-card-2")}>
                  {content}
                </Link>
              ) : (
                <span className={cls}>{content}</span>
              )
            } else if (idx > pi) {
              body = (
                <span className="inline-flex min-h-11 items-center gap-2 rounded-full pr-3 pl-2 font-semibold text-fg-btn">
                  <Circ state="todo" n={idx + 1} />
                  {t(`phases.${p.phase}`)}
                  <small className="font-mono text-[11px] font-medium text-fg-3">{p.steps.map((s) => t(`steps.${s.id}`)).join(" · ")}</small>
                </span>
              )
            } else {
              body = (
                <div className="flex flex-wrap items-center gap-1 rounded-full border border-line-soft bg-card-2 py-[3px] pr-1 pl-2.5">
                  <span className="pr-1 font-mono text-[10px] tracking-[0.08em] text-fg-3 uppercase">{t(`phases.${p.phase}`)}</span>
                  {p.steps.map(step)}
                </div>
              )
            }
            return (
              <Fragment key={p.phase}>
                {sep}
                <li>{body}</li>
              </Fragment>
            )
          })}
        </ol>
        <Link
          href={exitHref}
          className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-btn px-3 font-semibold text-fg-btn hover:bg-card-2 hover:text-fg"
        >
          <NavIcon name="x" size={16} strokeWidth={2} />
          {t("exit")}
        </Link>
      </nav>

      {/* ≤760 px */}
      <nav aria-label={t("aria", { name })} className={cn("flex flex-col gap-2 rounded-[14px] border border-line bg-card px-3 py-2.5 min-[1100px]:hidden", className)}>
        <div className="flex items-center gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            {/* QA layout 29/10 #11/#20: the compact bar up to 1100 px (the full one wrapped into 3 lines at 768); the eyebrow wraps instead of "…" */}
            <span className="eyebrow [overflow-wrap:anywhere]">
              {name} · {t(`phases.${curPhase}`)}
            </span>
            <b className="wide truncate text-[15px]" aria-current="step">
              {t(`steps.${current}`)}
            </b>
          </div>
          <span className="font-mono text-[13px] whitespace-nowrap text-fg-3 tabular-nums">{t("stepOf", { n: ci + 1, total: active.length })}</span>
          <Link
            href={exitHref}
            aria-label={t("exit")}
            className="grid size-11 flex-none place-items-center rounded-md border border-line text-fg hover:border-fg"
          >
            <NavIcon name="x" size={18} strokeWidth={2} />
          </Link>
        </div>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${all.length}, minmax(0, 1fr))` }} aria-hidden="true">
          {all.map((s) => {
            if (s.soon) return <i key={s.id} className="h-[5px] rounded-full border border-dashed border-control" />
            const n = numOf(s.id) - 1
            return (
              <i
                key={s.id}
                className={cn("h-[5px] rounded-full bg-line", n < ci && "bg-fg", n === ci && "bg-brand outline outline-1 outline-brand-edge")}
              />
            )
          })}
        </div>
      </nav>
    </>
  )
}
