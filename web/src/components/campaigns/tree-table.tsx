"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { MetaCampaignAdRow, MetaCampaignRow, MetaCampaignsTotals, MetaPeriod } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { mk } from "@/hooks/use-meta"
import { cn } from "@/lib/utils"
import { AdThumbSmall, BudgetCell, Delta, HmChip, IterateButton, LearnChip, RowMenu, StatusSwitch, StatusText, VerdictChips, resultsText, useFormat } from "./cells"
import { filtering, nodeId, selfOk, statusInfo, windowOf, type Filters, type MetricKey, type Node, type ResultKey, type SortKey } from "./model"

/*
 * Desktop: one tree table (spec §2.1, §4): campaign → ad set → ad, rows expand in place (treegrid, aria-level,
 * aria-expanded). Expanding a campaign reads GET /meta/campaigns/:id once (React Query keeps it). The total row comes
 * first. ≤760 px this table is hidden and the drill-down cards take over (cards.tsx).
 */
export type RowActions = {
  canWrite: boolean
  isClient: boolean
  /** why the switch / pencil is off for everyone (account unusable, token expired); null = on */
  lockedReason: string | null
  onToggle: (n: Node) => void
  onBudget: (n: Node) => void
  onHistory: (n: Node) => void
}
export type TableCtx = RowActions & {
  period: MetaPeriod
  filters: Filters
  currency: string | null
  resultKey: ResultKey
  flash: string | null
}

export function Highlight({ text, q }: { text: string; q: string }) {
  const s = q.trim()
  const i = s ? text.toLowerCase().indexOf(s.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-brand px-px text-fg">{text.slice(i, i + s.length)}</mark>
      {text.slice(i + s.length)}
    </>
  )
}

/** the sort the API and the cards use, mirrored for children (the detail has no `sort`) */
export function sortNodes<T extends Node>(list: T[], sort: SortKey, dir: "asc" | "desc", period: MetaPeriod): T[] {
  const d = dir === "asc" ? 1 : -1
  const val = (n: Node): number | null => {
    const w = windowOf(n, period)
    if (sort === "budget") return n.level === "ad" ? null : n.row.budget.amountMinor
    return sort === "cpa" ? w.cpa : sort === "results" ? w.results : sort === "ctr" ? (w.spend ? w.ctr : null) : sort === "hookRate" ? w.hookRate : w.spend
  }
  return [...list].sort((a, b) => {
    if (sort === "name") return d * a.row.name.localeCompare(b.row.name)
    const x = val(a), y = val(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return d * (x - y)
  })
}

const switchReason = (n: Node, ctx: RowActions, t: (k: string) => string) =>
  ctx.lockedReason ?? (n.row.effectiveStatus === "DISAPPROVED" ? t("state.rejected") : n.row.canToggle === false ? t("viewOnly") : null)

export function StatusCell({ n, ctx }: { n: Node; ctx: RowActions }) {
  const t = useTranslations("campaigns")
  if (!ctx.canWrite) return <StatusText n={n} className="max-w-[120px]" />
  const s = statusInfo(n)
  return (
    <div className="flex max-w-[120px] items-center gap-2">
      <StatusSwitch n={n} disabledReason={switchReason(n, ctx, t as (k: string) => string)} onToggle={() => ctx.onToggle(n)} />
      {s.tone === "on" ? null : <StatusText n={n} />}
    </div>
  )
}

function MetricTd({ n, k, ctx, depth }: { n: Node; k: MetricKey; ctx: TableCtx; depth: 0 | 1 | 2 }) {
  const f = useFormat(ctx.currency)
  const w = windowOf(n, ctx.period)
  const zero = !w.spend
  const v =
    k === "spend" ? f.money0(w.spend) : k === "results" ? resultsText(w) : k === "cpa" ? f.money2(w.cpa) : k === "ctr" ? (zero ? "—" : f.pct(w.ctr)) : n.level === "ad" && !n.row.videoId ? "—" : f.pct(w.hookRate, 1)
  return (
    <td className={cn("border-b border-line-soft px-2 py-2 text-right align-middle whitespace-nowrap", LV_BG[depth])}>
      <span className={cn("font-mono font-medium tabular-nums", zero && "text-fg-3")}>{v}</span>
      {zero ? null : <Delta n={n} k={k} period={ctx.period} />}
    </td>
  )
}

const LV_BG = ["bg-card", "bg-[var(--row-l1)]", "bg-[var(--row-l2)]"]

function Row({ n, depth, ctx, expandable, open, onExpand, extraSub }: { n: Node; depth: 0 | 1 | 2; ctx: TableCtx; expandable: boolean; open?: boolean; onExpand?: () => void; extraSub?: React.ReactNode }) {
  const t = useTranslations("campaigns")
  const id = nodeId(n)
  const sub =
    n.level === "campaign" ? (
      <>
        <span className="font-mono text-[10px] tracking-[0.06em] uppercase">{t("level.campaign")}</span>·<span>{t("countAdsets", { count: n.row.counts.adsets })}</span>·<span>{t("countAds", { count: n.row.counts.ads })}</span>
      </>
    ) : n.level === "adset" ? (
      <>
        <span className="font-mono text-[10px] tracking-[0.06em] uppercase">{t("level.adset")}</span>·<span>{t("countAds", { count: n.row.counts.ads })}</span>
      </>
    ) : (
      <>
        <span className="font-mono text-[10px] tracking-[0.06em] uppercase">{t("level.ad")}</span>·<span>{n.row.videoId ? t("video") : t("image")}</span>
        {extraSub}
      </>
    )
  return (
    <tr
      aria-level={depth + 1}
      aria-expanded={expandable ? !!open : undefined}
      data-flash={ctx.flash === id || undefined}
      className="hover:[&>td]:bg-[var(--row-hover)] data-[flash]:[&>td]:animate-[row-flash_1.6s_ease-out]"
    >
      <td className={cn("border-b border-line-soft px-2 py-2 text-left align-middle", LV_BG[depth])}>
        <StatusCell n={n} ctx={ctx} />
      </td>
      <td className={cn("border-b border-line-soft px-2 py-2 text-left align-middle", LV_BG[depth])}>
        {/* The name is the column that gives way (QA 23/10, Achado C). Its <th> asks for 248 px of content; the text box has
            w-0 + flex-1 so its min-content is ~0 and the column can narrow down to 168 px. Every other column is nowrap, so
            when the table is tighter than its content (1440 + Iterate + "3 winners") the name truncates instead of the table
            overflowing and the sticky actions column covering Verdict. */}
        <div className="flex w-full min-w-[168px] items-center gap-2">
          <span className="flex-none" style={{ width: depth * 22 }} />
          {expandable ? (
            <button
              type="button"
              onClick={onExpand}
              aria-expanded={!!open}
              aria-label={open ? t("collapse", { name: n.row.name }) : t("expand", { name: n.row.name })}
              className="grid size-[26px] flex-none place-items-center rounded-[7px] text-fg-3 hover:bg-card-2 hover:text-fg"
            >
              <Icon name="chev" className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
            </button>
          ) : (
            <span className="size-[26px] flex-none" />
          )}
          <AdThumbSmall n={n} />
          <span className="flex w-0 min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn("truncate", depth === 0 ? "font-bold" : "font-semibold")} title={n.row.name}>
              <Highlight text={n.row.name} q={ctx.filters.q} />
            </span>
            <span className="flex items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-fg-3">
              {sub} <HmChip n={n} /> <LearnChip n={n} />
            </span>
          </span>
        </div>
      </td>
      <td className={cn("border-b border-line-soft px-2 py-2 text-right align-middle whitespace-nowrap", LV_BG[depth])}>
        <BudgetCell n={n} canEdit={ctx.canWrite && !ctx.lockedReason} onEdit={() => ctx.onBudget(n)} currency={ctx.currency} />
      </td>
      {(["spend", "results", "cpa", "ctr", "hook"] as const).map((k) => (
        <MetricTd key={k} n={n} k={k} ctx={ctx} depth={depth} />
      ))}
      <td className={cn("border-b border-line-soft px-2 py-2 text-left align-middle", LV_BG[depth])}>
        <VerdictChips n={n} className="max-w-[124px] flex-wrap" />
      </td>
      <td className={cn("sticky right-0 border-b border-line-soft px-2 py-2 text-right align-middle whitespace-nowrap shadow-[-8px_0_8px_-8px_rgba(21,23,26,.12)]", LV_BG[depth])}>
        <span className="inline-flex items-center justify-end gap-1.5">
          {n.level === "ad" && !ctx.isClient ? <IterateButton n={n} /> : null}
          <RowMenu n={n} canIterate={!ctx.isClient} onHistory={() => ctx.onHistory(n)} />
        </span>
      </td>
    </tr>
  )
}

function StateRow({ depth, children }: { depth: 1 | 2; children: React.ReactNode }) {
  return (
    <tr aria-level={depth + 1}>
      <td colSpan={10} className={cn("border-b border-line-soft px-2 py-2.5 text-left text-[13px] text-fg-3", LV_BG[depth])}>
        <div style={{ paddingLeft: depth * 22 + 34 }}>{children}</div>
      </td>
    </tr>
  )
}

/** a campaign row + (when open) its ad sets and ads from the detail */
function CampaignBranch({ row, ctx, open, toggle, sort, dir }: { row: MetaCampaignRow; ctx: TableCtx; open: Set<string>; toggle: (id: string) => void; sort: SortKey; dir: "asc" | "desc" }) {
  const t = useTranslations("campaigns")
  const f = ctx.filters
  const camp: Node = { level: "campaign", row }
  // filtering: open the campaign by itself when a child matched (matchedIn) or when it's only here because of a child
  const auto = filtering(f) && ((row.matchedIn?.length ?? 0) > 0 || !selfOk(camp, f))
  // mockup: open by the person OR by the filter (a filter never collapses what the person opened)
  const isOpen = open.has(row.id) || auto
  const detail = useQuery({
    queryKey: mk.campaign(row.id, ctx.period),
    queryFn: ({ signal }) => api.meta.campaign(row.id, { period: ctx.period }, { signal }),
    enabled: isOpen,
    staleTime: 30_000,
  })
  const d = detail.data
  let body: React.ReactNode = null
  if (isOpen) {
    if (detail.isPending)
      body = (
        <StateRow depth={1}>
          <span className="inline-flex items-center gap-2">
            <span className="spin-ring size-3.5" aria-hidden="true" />
            {t("loading")}
          </span>
        </StateRow>
      )
    else if (detail.isError || !d)
      body = (
        <StateRow depth={1}>
          <span className="inline-flex flex-wrap items-center gap-2 text-bad">
            {t("detailFailed")}
            <Button size="sm" variant="outline" onClick={() => detail.refetch()}>
              {t("retry")}
            </Button>
          </span>
        </StateRow>
      )
    else {
      const campRow = d.campaign
      let sets = d.adsets.map((a) => ({ n: { level: "adset", row: a, campaign: campRow } as Extract<Node, { level: "adset" }>, ads: a.ads }))
      if (filtering(f)) {
        const hit = sets.filter((s) => selfOk(s.n, f) || s.ads.some((ad) => selfOk({ level: "ad", row: ad, campaign: campRow, adset: s.n.row }, f)))
        if (hit.length) sets = hit
      }
      body = sortNodes(sets.map((s) => s.n), sort, dir, ctx.period).map((an) => {
        const s = sets.find((x) => x.n.row.id === an.row.id)!
        let ads = s.ads.map((ad) => ({ level: "ad", row: ad as MetaCampaignAdRow, campaign: campRow, adset: an.row }) as Extract<Node, { level: "ad" }>)
        const adHits = filtering(f) ? ads.filter((x) => selfOk(x, f)) : []
        if (adHits.length) ads = adHits
        const setAuto = filtering(f) && adHits.length > 0 && !selfOk(an, f)
        const setOpen = open.has(an.row.id) || setAuto || (filtering(f) && adHits.length > 0 && !!f.q.trim())
        return (
          <Fragment key={an.row.id}>
            <Row n={an} depth={1} ctx={ctx} expandable={s.ads.length > 0} open={setOpen} onExpand={() => toggle(an.row.id)} />
            {setOpen ? sortNodes(ads, sort, dir, ctx.period).map((ad) => <Row key={ad.row.metaAdId} n={ad} depth={2} ctx={ctx} expandable={false} />) : null}
          </Fragment>
        )
      })
    }
  }
  return (
    <>
      <Row n={camp} depth={0} ctx={ctx} expandable open={isOpen} onExpand={() => toggle(row.id)} />
      {body}
    </>
  )
}

function SortTh({ k, label, sort, dir, onSort, left, className }: { k: SortKey; label: string; sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; left?: boolean; className?: string }) {
  const on = sort === k
  return (
    <th scope="col" aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : undefined} className={cn(thCls, left ? "text-left" : "text-right", className)}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 py-0.5 hover:text-fg", on && "font-bold text-fg")}>
        {label}
        {on ? <Icon name={dir === "asc" ? "sortu" : "sortd"} className="size-3" /> : null}
      </button>
    </th>
  )
}
const thCls = "sticky top-0 border-b border-line bg-card px-2 py-2.5 text-xs font-semibold whitespace-nowrap text-fg-3"

function Head({ sort, dir, onSort, resultKey }: { sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; resultKey: ResultKey }) {
  const t = useTranslations("campaigns")
  return (
    <thead>
      <tr>
        <th scope="col" className={cn(thCls, "w-[140px] min-w-[140px] text-left")}>
          {t("col.status")}
        </th>
        <SortTh k="name" label={t("col.name")} sort={sort} dir={dir} onSort={onSort} left className="w-[264px]" />
        <SortTh k="budget" label={t("col.budget")} sort={sort} dir={dir} onSort={onSort} />
        <SortTh k="spend" label={t("col.spend")} sort={sort} dir={dir} onSort={onSort} />
        <SortTh k="results" label={t(`result.${resultKey}`)} sort={sort} dir={dir} onSort={onSort} />
        <SortTh k="cpa" label={t(`cost.${resultKey}`)} sort={sort} dir={dir} onSort={onSort} />
        <SortTh k="ctr" label={t("col.ctr")} sort={sort} dir={dir} onSort={onSort} />
        <SortTh k="hookRate" label={t("col.hook")} sort={sort} dir={dir} onSort={onSort} />
        <th scope="col" className={cn(thCls, "text-left")}>
          {t("col.verdict")}
        </th>
        <th scope="col" className={cn(thCls, "right-0 z-[1]")}>
          <span className="sr-only">{t("col.actions")}</span>
        </th>
      </tr>
    </thead>
  )
}

export function TotalRow({ totals, what, ctx }: { totals: MetaCampaignsTotals; what: string; ctx: TableCtx }) {
  const t = useTranslations("campaigns")
  const f = useFormat(ctx.currency)
  const td = "border-b border-line bg-card-2 px-2 py-2 text-right font-mono font-bold tabular-nums whitespace-nowrap"
  return (
    <tr>
      <td colSpan={2} className="border-b border-line bg-card-2 px-2 py-2 text-left font-bold">
        {t("total", { what, period: t(`period.${ctx.period}`) })}
      </td>
      <td className={td} />
      <td className={td}>{f.money0(totals.spend)}</td>
      <td className={td}>{totals.spend || totals.results ? totals.results : "—"}</td>
      <td className={td}>{f.money2(totals.cpa)}</td>
      <td className={td}>{f.pct(totals.ctr)}</td>
      <td className={td} />
      <td className={td} />
      <td className={cn(td, "sticky right-0")} />
    </tr>
  )
}

export function TreeTable({
  mode, campaigns, ads, totals, ctx, sort, dir, onSort, open, toggle, empty,
}: {
  mode: "tree" | "ads"
  campaigns: MetaCampaignRow[]
  ads: Extract<Node, { level: "ad" }>[]
  totals: MetaCampaignsTotals
  ctx: TableCtx
  sort: SortKey
  dir: "asc" | "desc"
  onSort: (k: SortKey) => void
  open: Set<string>
  toggle: (id: string) => void
  empty: React.ReactNode
}) {
  const t = useTranslations("campaigns")
  const count = mode === "tree" ? campaigns.length : ads.length
  // the "Total · N" label counts the whole filtered set when the server says how many (totals.count, §11), else what is loaded
  const totalCount = totals.count ?? count
  return (
    <ScrollX>
      <table role="treegrid" aria-label={t("title")} className="w-full min-w-[1060px] border-separate border-spacing-0 text-[13px]">
        <Head sort={sort} dir={dir} onSort={onSort} resultKey={ctx.resultKey} />
        {count ? (
          <tbody>
            <TotalRow totals={totals} what={mode === "tree" ? t("totalCampaigns", { count: totalCount }) : t("totalAds", { count: totalCount })} ctx={ctx} />
            {mode === "tree"
              ? campaigns.map((c) => <CampaignBranch key={c.id} row={c} ctx={ctx} open={open} toggle={toggle} sort={sort} dir={dir} />)
              : ads.map((n) => (
                  <Row
                    key={n.row.metaAdId}
                    n={n}
                    depth={0}
                    ctx={ctx}
                    expandable={false}
                    extraSub={
                      <>
                        ·<span className="truncate">
                          {n.row.campaign.name} › {n.row.adset.name}
                        </span>
                      </>
                    }
                  />
                ))}
          </tbody>
        ) : null}
      </table>
      {count ? null : empty}
    </ScrollX>
  )
}

export function TableSkeleton() {
  const t = useTranslations("campaigns")
  const sk = (w: number, h = 10) => <span className="sk inline-block rounded-[6px]" style={{ width: w, height: h }} />
  return (
    <ScrollX aria-busy="true">
      <table className="w-full min-w-[1060px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {[t("col.status"), t("col.name"), t("col.budget"), t("col.spend"), t("result.other"), t("cost.other"), t("col.ctr"), t("col.hook"), t("col.verdict"), ""].map((h, i) => (
              <th key={i} className={cn(thCls, i < 2 || i === 8 ? "text-left" : "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[260, 220, 280, 200].map((w) => (
            <tr key={w}>
              <td className="border-b border-line-soft px-2.5 py-3">{sk(36, 18)}</td>
              <td className="border-b border-line-soft px-2.5 py-3">{sk(w)}</td>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <td key={i} className="border-b border-line-soft px-2.5 py-3 text-right">
                  {sk(56)}
                </td>
              ))}
              <td className="border-b border-line-soft px-2.5 py-3">{sk(60)}</td>
              <td className="border-b border-line-soft" />
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  )
}

/**
 * QA layout 29/10 #6: the table is wider than the content column up to ~1340 px; a soft shade on the right edge says there
 * is more to scroll (gone at the end). Below 1100 px the cards take its place.
 */
function ScrollX({ children, ...rest }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    check()
    el.addEventListener("scroll", check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener("scroll", check)
      ro.disconnect()
    }
  }, [])
  return (
    <div className="relative min-w-0 max-[1099px]:hidden">
      <div ref={ref} className="min-w-0 overflow-x-auto rounded-lg border border-line bg-card" {...rest}>
        {children}
      </div>
      {more ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-px right-px w-12 rounded-r-lg bg-gradient-to-l from-[rgba(21,23,26,0.12)] to-transparent" /> : null}
    </div>
  )
}
