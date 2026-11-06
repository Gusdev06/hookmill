"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import type { BrandKit, ChipStatus, CreativeRow, IterateBatchRow, IterateBatchStage, MetaConnection, MetaSummary, Workspace } from "@/lib/api/types"
import { buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { Count } from "@/components/page"
import { StatusChip } from "@/components/status-chip"
import { useStatusLabel } from "@/hooks/use-status-label"
import { useMoney, useRelativeTime } from "@/hooks/use-meta"
import type { MetaGateState } from "@/components/meta/meta-gate"
import { creativeHref, iterateHref, variarHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { Reveal } from "@/components/ui/reveal"
import { SAMPLE_RECENT, SAMPLE_STEPS } from "@/lib/skeleton-samples"

/* Home v2 right column + Eddy bar + Recent strip (design/home-v2-2026-10-31.md §2.5-2.8, mockup .right/.eddybar/.recent). */

export const card = "min-w-0 rounded-[var(--r-card)] border border-line bg-card"
const hd = "flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3"

export function Tag({ tone, children, className }: { tone: "ok" | "warn" | "info" | "bad" | "neutral"; children: ReactNode; className?: string }) {
  const cls = {
    ok: "bg-ok-bg text-ok",
    warn: "bg-warn-bg text-warn",
    info: "bg-info-bg text-info",
    bad: "bg-bad-bg text-bad",
    neutral: "border border-line-soft bg-card-2 text-fg-2",
  }[tone]
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-bold whitespace-nowrap", cls, className)}>
      <i className="size-[7px] rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  )
}

// ───────────── greeting ─────────────
export function Hello({ eyebrow, title }: { eyebrow: ReactNode; title: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-0.5 py-1">
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="text-2xl leading-[1.15] font-extrabold tracking-[-.015em] [font-stretch:125%] text-balance">{title}</h1>
    </div>
  )
}

// ───────────── brand summary + goal ─────────────
export type GoalState =
  /** `numbers`: Meta is usable and the summary is on its way (reserve the full height); else one line */
  | { kind: "loading"; numbers: boolean }
  | { kind: "noMeta" }
  | { kind: "reading" }
  | { kind: "off" }
  | { kind: "data"; s: MetaSummary; stale: string | null }

export function BrandSummary({ ws, kit, percent, goal, resultNoun }: { ws: Workspace | undefined; kit: BrandKit | undefined; percent: number | null; goal: GoalState; resultNoun: string }) {
  const t = useTranslations("home")
  const target = ws?.targetCpa ?? null
  const money = useMoney(target?.currency ?? "USD")
  const colors = [...new Set([ws?.brandColor, ...(kit?.logo?.colors ?? [])].filter((c): c is string => !!c))].slice(0, 2)
  const range = target ? `${money(target.min, 0)}–${money(target.max, 0)}` : t("goal.none")
  return (
    <section className={card} aria-labelledby="bs-h">
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className={cn("grid size-11 flex-none place-items-center overflow-hidden rounded-[10px] border border-line bg-card-2", !kit?.logo && "border-dashed")}>
            {kit?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={kit.logo.file.url} alt="" className="size-full object-contain p-1" />
            ) : null}
          </span>
          <Reveal loading={!ws} id="home.brand" className="min-w-0 flex-1">
            <b id="bs-h" className="block truncate">{ws ? ws.name : "Workspace name"}</b>
            <span className="block truncate text-xs text-fg-3">{ws ? [ws.industry, ws.market].filter(Boolean).join(" · ") : "Industry · Market"}</span>
          </Reveal>
          {colors.length ? (
            <span className="flex gap-1" aria-hidden="true">
              {colors.map((c) => (
                <i key={c} className="size-3.5 rounded-[4px] border border-line-strong" style={{ background: c }} />
              ))}
            </span>
          ) : null}
        </div>

        <div id="t-kpis" className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] text-fg-3">{t("goal.label", { result: resultNoun })}</span>
            <span className="font-mono text-[13px] tabular-nums">{range}</span>
          </div>
          <GoalBody goal={goal} ws={ws} resultNoun={resultNoun} />
        </div>

        <div className="flex items-center gap-2 border-t border-line-soft pt-2.5">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0} aria-label={percent == null ? undefined : t("brainFull", { pct: percent })}>
            <i className="block h-full rounded-full bg-brand-edge" style={{ width: `${percent ?? 0}%` }} />
          </span>
          <span className="w-9 font-mono text-xs tabular-nums">{percent == null ? "" : `${percent}%`}</span>
          <Link href="/brain" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("viewBrand")}
            <Icon name="arrowr" />
          </Link>
        </div>
      </div>
    </section>
  )
}

function GoalBody({ goal, ws, resultNoun }: { goal: GoalState; ws: Workspace | undefined; resultNoun: string }) {
  const t = useTranslations("home.goal")
  const fmt = useFormatter()
  const target = ws?.targetCpa ?? null
  const s = goal.kind === "data" ? goal.s : null
  const money = useMoney(s?.currency ?? target?.currency)
  const usd = useMoney("USD")
  // fixed height in every state, so the cards under it never move (CLS)
  const box = "flex min-h-[86px] flex-col gap-1.5"
  if (goal.kind === "loading" && !goal.numbers)
    return (
      <div className="flex min-h-4 flex-col" aria-busy="true">
        <span className="sk h-3 w-56" />
      </div>
    )
  if (goal.kind === "loading")
    return (
      <div className={box} aria-busy="true">
        <span className="sk h-7 w-28" />
        <span className="sk h-5 w-full" />
        <span className="sk h-3 w-48" />
      </div>
    )
  if (goal.kind === "reading") return <div className="flex flex-col"><span className="font-mono text-[22px] font-semibold text-fg-3">{t("reading")}</span></div>
  if (goal.kind === "noMeta" || goal.kind === "off") return <div className="flex min-h-4 flex-col"><span className="text-xs text-fg-3">{t("noMeta")}</span></div>
  const sum = goal.s
  const cpa = sum.cpa
  const sameCur = !!target && (!sum.currency || sum.currency === target.currency)
  const status =
    cpa == null || !target || !sameCur ? null : cpa > target.max ? <Tag tone="warn">{t("over", { amount: money(cpa - target.max) })}</Tag> : cpa < target.min ? <Tag tone="ok">{t("under")}</Tag> : <Tag tone="ok">{t("inTarget")}</Tag>
  const cap = ws?.monthlySpendCapUsd
  const spendLine = [cap != null && sum.currency === "USD" ? t("spendCap", { spend: money(sum.spend, 0), cap: usd(cap, 0) }) : t("spend", { spend: money(sum.spend, 0) }), sum.roas != null ? t("roas", { roas: sum.roas.toFixed(1) }) : null]
    .filter(Boolean)
    .join(" · ")
  // one scale for the band and the mark: 0 → 2× the top of the range
  const top = target ? target.max * 2 : 1
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / top) * 100))}%`
  return (
    <div className={box}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[22px] font-semibold tabular-nums">{cpa == null ? "—" : money(cpa)}</span>
        {cpa == null ? <span className="text-xs text-fg-3">{t("noResults")}</span> : status}
      </div>
      {target && sameCur ? (
        <div className="relative h-[30px]" role="img" aria-label={t("meter", { result: resultNoun, cpa: cpa == null ? "—" : money(cpa), min: money(target.min, 0), max: money(target.max, 0) })}>
          <span className="absolute inset-x-0 top-[9px] h-0.5 bg-line" />
          <span className="absolute top-[3px] h-3.5 rounded-[4px] border border-ok-dot bg-ok-bg" style={{ left: pos(target.min), width: `calc(${pos(target.max)} - ${pos(target.min)})` }} />
          {cpa != null ? <span className="absolute top-px h-[18px] w-[3px] -translate-x-px rounded-[2px] bg-fg" style={{ left: pos(cpa) }} /> : null}
          <span className="absolute top-[19px] -translate-x-1/2 font-mono text-[10px] text-fg-3" style={{ left: pos(target.min) }}>{money(target.min, 0)}</span>
          <span className="absolute top-[19px] -translate-x-1/2 font-mono text-[10px] text-fg-3" style={{ left: pos(target.max) }}>{money(target.max, 0)}</span>
          <span className="absolute top-[19px] right-0 font-mono text-[10px] text-fg-3">{money(top, 0)}</span>
        </div>
      ) : target ? (
        <span className="text-xs text-fg-3">{t("otherCurrency", { target: target.currency, account: sum.currency ?? "—" })}</span>
      ) : (
        <span className="text-xs text-fg-3">{t("noTarget")}</span>
      )}
      <span className="text-xs text-fg-3">
        {spendLine}
        {goal.stale ? ` · ${t("lastData", { date: fmt.dateTime(new Date(goal.stale), { month: "short", day: "numeric" }) })}` : ""}
      </span>
    </div>
  )
}

// ───────────── next steps ─────────────
export interface NextStep {
  key: string
  icon: ReactNode
  tone: "win" | "wait" | "warn" | "info" | "neutral"
  title: string
  body: string
  cta: { label: string; href: string } | null
}

export function NextSteps({ steps, pending, lime, count }: { steps: NextStep[]; pending: boolean; lime: boolean; count: number }) {
  const t = useTranslations("home.next")
  const tl = useTranslations("skeleton")
  const [open, setOpen] = useState(false)
  const ic = {
    win: "border-brand-edge bg-brand-soft text-brand-ink",
    wait: "border-warn-dot bg-warn-bg text-warn",
    warn: "border-warn-dot bg-warn-bg text-warn",
    info: "border-status-progress-edge bg-info-bg text-info",
    neutral: "border-line bg-card-2 text-fg-3",
  }
  return (
    <section className={card} aria-labelledby="ns-h">
      <div className={hd}>
        <span className="flex items-center gap-2">
          <h2 id="ns-h" className="text-sm font-bold">{t("title")}</h2>
          {pending ? null : <Count>{count}</Count>}
        </span>
      </div>
      <Reveal data={pending ? null : steps} sample={SAMPLE_STEPS} id="home.next" label={tl("next")}>
        {(steps) => {
          const shown = open ? steps : steps.slice(0, 3)
          const more = steps.length - 3
          return steps.length ? (
        <>
          <ol className="m-0 flex list-none flex-col p-0">
            {shown.map((s, i) => (
              <li key={s.key} className="flex items-start gap-3 border-t border-line-soft px-4 py-3 first:border-t-0">
                <span className={cn("grid size-[30px] flex-none place-items-center rounded-[9px] border font-mono text-[11px] font-semibold", ic[s.tone])} aria-hidden="true">
                  {s.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <b className="text-[13.5px]">{s.title}</b>
                  <span className="text-[12.5px] text-pretty text-fg-3">{s.body}</span>
                  {s.cta ? (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Link href={s.cta.href} className={buttonVariants({ variant: lime && i === 0 ? "brand" : "outline", size: "sm" })}>
                        {s.cta.label}
                        {lime && i === 0 ? <Icon name="arrowr" /> : null}
                      </Link>
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          {more > 0 ? (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-h-[42px] w-full cursor-pointer rounded-b-[var(--r-card)] border-0 border-t border-line-soft bg-transparent text-[13px] font-semibold text-fg-2 hover:bg-card-2 hover:text-fg">
              {open ? t("less") : t("more", { count: more })}
            </button>
          ) : null}
        </>
      ) : (
        <p className="m-0 px-4 py-3.5 text-[13px] text-fg-3">{t("empty")}</p>
      )
        }}
      </Reveal>
    </section>
  )
}

// ───────────── connections ─────────────
export function Connections({ state, conn, canWrite }: { state: MetaGateState; conn: MetaConnection | null | undefined; canWrite: boolean }) {
  const t = useTranslations("home.conn")
  const rel = useRelativeTime()
  const acc = conn?.adAccount
  const line =
    state === "loading" ? t("loading")
    : state === "off" ? t("off")
    : state === "none" || state === "failed" ? t("notConnected")
    : state === "choose" ? t("choose")
    : [acc?.name, acc ? `act_••${acc.id.replace(/^act_/, "").slice(-4)}` : null, conn?.lastSyncAt ? t("synced", { ago: rel(conn.lastSyncAt) }) : null].filter(Boolean).join(" · ")
  return (
    <section className={card} aria-labelledby="cx-h">
      <div className={hd}>
        <h2 id="cx-h" className="text-sm font-bold">{t("title")}</h2>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-[30px] flex-none place-items-center rounded-lg bg-meta font-extrabold text-white" aria-hidden="true">f</span>
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px]">{t("meta")}</b>
          <span className="block truncate text-xs text-fg-3">{line}</span>
        </span>
        {state === "ready" ? <Tag tone="ok">{t("on")}</Tag> : null}
        {state === "expired" || state === "broken" ? <Tag tone="warn">{t("attention")}</Tag> : null}
        {canWrite && (state === "none" || state === "choose") ? (
          <Link href="/settings/connections" className={buttonVariants({ variant: state === "none" ? "meta" : "outline", size: "sm" })}>
            {state === "none" ? t("connect") : t("choose")}
          </Link>
        ) : null}
      </div>
    </section>
  )
}

// ───────────── Eddy bar (Soon) ─────────────
export function EddyBar() {
  const t = useTranslations("home.eddy")
  return (
    <section className={cn(card, "flex flex-col gap-2 p-2.5")} aria-label={t("label")}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 flex-none place-items-center rounded-[9px] bg-ink font-mono text-xs font-semibold text-brand" aria-hidden="true">Ed</span>
        <input
          disabled
          aria-label={t("label")}
          aria-describedby="eddy-note"
          placeholder={t("placeholder")}
          className="min-h-11 min-w-0 flex-1 cursor-not-allowed rounded-btn border border-line-soft bg-card-2 px-3 text-fg-3 placeholder:text-fg-3"
        />
        <span className="rounded-[6px] border border-line-strong px-1.5 py-0.5 font-mono text-[10.5px] tracking-[.06em] whitespace-nowrap text-fg-3 uppercase">{t("soon")}</span>
      </div>
      <p id="eddy-note" className="m-0 text-xs text-fg-3 tablet:pl-[42px]">{t("note")}</p>
    </section>
  )
}

// ───────────── Recent strip ─────────────
/** lacunas-home-eddy-v1 §5: creatives and Iterate batches (GET /iterate), merged by updatedAt by the page */
export type RecentItem = { kind: "creative"; c: CreativeRow; at: string } | { kind: "batch"; b: IterateBatchRow; at: string }

const BATCH_CHIP: Record<IterateBatchStage, ChipStatus> = {
  analyzing: "progress", planning: "progress", generating: "progress", plan_ready: "waiting", pieces_ready: "waiting", failed: "failed", done: "approved",
}

export function RecentStrip({ items, total, pending, error }: { items: RecentItem[]; total: number | null; pending: boolean; error: boolean }) {
  const t = useTranslations("home.strip")
  const tl = useTranslations("skeleton")
  const label = useStatusLabel()
  const rows = items
  return (
    <section className={card} aria-labelledby="rc-h">
      <div className={hd}>
        <span className="flex items-center gap-2">
          <h2 id="rc-h" className="text-sm font-bold">{t("title")}</h2>
          {total != null ? <Count>{total}</Count> : null}
        </span>
        <Link href="/creatives" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), !rows.length && "invisible")}>
          {t("all")}
          <Icon name="arrowr" />
        </Link>
      </div>
      <Reveal
        data={pending ? null : rows}
        sample={SAMPLE_RECENT}
        id="home.recent"
        label={tl("recent")}
        error={!pending && error && !rows.length ? <p className="m-0 px-4 py-3.5 text-[13px] text-fg-3">{t("failed")}</p> : undefined}
      >
        {(rows) => rows.length ? (
        <div className="grid auto-cols-[minmax(150px,1fr)] grid-flow-col gap-2.5 overflow-x-auto overscroll-x-contain px-4 pt-3 pb-3.5">
          {rows.map((it) => {
            if (it.kind === "batch") {
              const b = it.b
              return (
                <Link key={`b:${b.id}`} href={b.mode === "AUTO" ? iterateHref(b.id) : variarHref(b.champion.id, "hooks", b.id)} className="group flex min-w-0 flex-col gap-1.5 text-inherit no-underline">
                  <span className="relative block aspect-[16/10] overflow-hidden rounded-[10px] bg-[linear-gradient(165deg,#4c5a6e,#15171a)]">
                    {b.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.thumbnail.url} alt="" className="block size-full object-cover" loading="lazy" decoding="async" />
                    ) : null}
                  </span>
                  <b className="truncate text-[12.5px] group-hover:underline">{b.champion.name}</b>
                  <StatusChip status={BATCH_CHIP[b.stage]} className="text-xs">{label(b)}</StatusChip>
                </Link>
              )
            }
            const c = it.c
            return (
              <Link key={c.id} href={creativeHref(c)} className="group flex min-w-0 flex-col gap-1.5 text-inherit no-underline">
                <span className="relative block aspect-[16/10] overflow-hidden rounded-[10px] bg-[linear-gradient(165deg,#4c5a6e,#15171a)]">
                  {c.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnail.url} alt="" className="block size-full object-cover" loading="lazy" decoding="async" />
                  ) : null}
                  {c.status === "progress" && c.progress != null ? (
                    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.progress}>
                      <i className="block h-full bg-info transition-[width] duration-500" style={{ width: `${c.progress}%` }} />
                    </span>
                  ) : null}
                </span>
                <b className="truncate text-[12.5px] group-hover:underline">{c.name}</b>
                <StatusChip status={c.status} className="text-xs">{label(c)}</StatusChip>
              </Link>
            )
          })}
        </div>
      ) : (
        <p className="m-0 px-4 py-3.5 text-[13px] text-fg-3">{t("empty")}</p>
      )}
      </Reveal>
    </section>
  )
}
