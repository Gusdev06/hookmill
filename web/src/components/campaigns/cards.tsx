"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { MetaCampaignAdRow, MetaCampaignRow, MetaCampaignsTotals } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { mk } from "@/hooks/use-meta"
import { cn } from "@/lib/utils"
import { AdThumbSmall, BudgetCell, Delta, HmChip, IterateButton, LearnChip, RowMenu, StatusSwitch, StatusText, VerdictChips, resultsText, useFormat } from "./cells"
import { filtering, isVideoAd, nodeId, selfOk, windowOf, type Node, type SortKey } from "./model"
import { Highlight, sortNodes, type TableCtx } from "./tree-table"

/*
 * Phone (≤760 px, spec §2.1 / §6): drill-down in cards. Root = campaign cards; a campaign opens its ad sets (the campaign
 * card stays on top as context, with the breadcrumb); an ad set opens its ads. "Ads only" = flat ad cards with the path.
 * Totals 2×2 above. No wide table on the phone.
 */
export type Drill = { c: string | null; a: string | null }

function Card({ n, ctx, head, path, onDrill }: { n: Node; ctx: TableCtx; head?: boolean; path?: string; onDrill?: () => void }) {
  const t = useTranslations("campaigns")
  const f = useFormat(ctx.currency)
  const w = windowOf(n, ctx.period)
  const has = !!w.spend
  const video = isVideoAd(n)
  const lastK = n.level === "ad" && video ? "hook" : "ctr"
  const kids = n.level === "campaign" ? n.row.counts.adsets : n.level === "adset" ? n.row.counts.ads : 0
  const reason = ctx.lockedReason ?? (n.row.effectiveStatus === "DISAPPROVED" ? t("state.rejected") : n.row.canToggle === false ? t("viewOnly") : null)
  const win = n.level === "ad" && n.row.verdict === "WINNER"
  return (
    <article data-flash={ctx.flash === nodeId(n) || undefined} className={cn("flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-line bg-card p-3.5 data-[flash]:animate-[row-flash_1.6s_ease-out]", win && "border-brand-edge bg-brand-soft")}>
      <div className="flex items-start gap-2.5">
        <AdThumbSmall n={n} big />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-[0.06em] text-fg-3 uppercase">{t(`level.${n.level}`)}</span>
          <span className="line-clamp-2 text-[15px] font-bold text-pretty">
            <Highlight text={n.row.name} q={ctx.filters.q} />
          </span>
          {path ? <span className="text-xs text-pretty text-fg-3">{path}</span> : null}
        </span>
        {ctx.canWrite ? <span className="mt-0.5"><StatusSwitch n={n} size="lg" disabledReason={reason} onToggle={() => ctx.onToggle(n)} /></span> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <StatusText n={n} />
        <HmChip n={n} />
        <LearnChip n={n} />
        <VerdictChips n={n} />
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-line-soft pt-2">
        {(
          [
            ["spend", t("col.spend"), f.money0(w.spend)],
            ["results", t(`resultShort.${ctx.resultKey}`), resultsText(w)],
            ["cpa", t("costShort"), f.money2(w.cpa)],
            [lastK, lastK === "hook" ? t("col.hook") : t("col.ctr"), lastK === "hook" ? f.pct(w.hookRate, 1) : has ? f.pct(w.ctr) : "—"],
          ] as const
        ).map(([k, label, v]) => (
          <div key={k} className="flex min-w-0 flex-col">
            <small className="truncate text-[11px] text-fg-3">{label}</small>
            <span className="font-mono text-sm font-semibold tabular-nums">{v}</span>
            {has ? <Delta n={n} k={k} period={ctx.period} /> : null}
          </div>
        ))}
      </div>
      {n.level === "ad" ? (
        <div className="flex flex-wrap items-center gap-2">
          {ctx.isClient ? <span className="flex-1" /> : <IterateButton n={n} full className="flex-1" />}
          <RowMenu n={n} canIterate={!ctx.isClient} onHistory={() => ctx.onHistory(n)} outline />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">
            <BudgetCell n={n} canEdit={ctx.canWrite && !ctx.lockedReason} onEdit={() => ctx.onBudget(n)} currency={ctx.currency} card />
          </span>
          <RowMenu n={n} canIterate={!ctx.isClient} onHistory={() => ctx.onHistory(n)} />
        </div>
      )}
      {onDrill && !head && kids ? (
        <button type="button" onClick={onDrill} className="flex min-h-11 w-full items-center justify-between border-t border-line-soft pt-2 text-left font-bold">
          {n.level === "campaign" ? t("viewAdsets", { count: kids }) : t("viewAds", { count: kids })}
          <Icon name="chev" />
        </button>
      ) : null}
    </article>
  )
}

export function Totals({ totals, ctx }: { totals: MetaCampaignsTotals; ctx: TableCtx }) {
  const t = useTranslations("campaigns")
  const f = useFormat(ctx.currency)
  const cells: [string, string][] = [
    [t("col.spend"), f.money0(totals.spend)],
    [t(`result.${ctx.resultKey}`), totals.spend || totals.results ? String(totals.results) : "—"],
    [t(`cost.${ctx.resultKey}`), f.money2(totals.cpa)],
    [t("col.ctr"), f.pct(totals.ctr)],
  ]
  return (
    <div className="grid grid-cols-2 gap-2 tablet:hidden">
      {cells.map(([k, v]) => (
        <div key={k} className="flex flex-col rounded-md border border-line bg-card px-3 py-2.5">
          <small className="text-[11px] text-fg-3">{k}</small>
          <span className="font-mono text-base font-semibold tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  )
}

function Crumb({ items, onRoot, onCampaign }: { items: { id: string; name: string }[]; onRoot: () => void; onCampaign: (id: string) => void }) {
  const t = useTranslations("campaigns")
  return (
    <nav aria-label={t("crumb")} className="flex flex-wrap items-center gap-1.5 text-[13px] text-fg-3">
      <button type="button" onClick={onRoot} className="inline-flex min-h-9 items-center gap-1 font-semibold text-fg-2">
        <Icon name="left" className="size-3.5" />
        {t("back")}
      </button>
      {items.map((it, i) => (
        <span key={it.id} className="inline-flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true">/</span>
          {i === items.length - 1 ? (
            <b className="text-fg" aria-current="page">{it.name}</b>
          ) : (
            <button type="button" onClick={() => onCampaign(it.id)} className="min-h-9 font-semibold text-fg-2">
              {it.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}

function DrillLevel({ campaign, drill, setDrill, ctx, sort, dir, empty }: { campaign: MetaCampaignRow; drill: Drill; setDrill: (d: Drill) => void; ctx: TableCtx; sort: SortKey; dir: "asc" | "desc"; empty: React.ReactNode }) {
  const t = useTranslations("campaigns")
  const detail = useQuery({
    queryKey: mk.campaign(campaign.id, ctx.period),
    queryFn: ({ signal }) => api.meta.campaign(campaign.id, { period: ctx.period }, { signal }),
    staleTime: 30_000,
  })
  const root = () => {
    setDrill({ c: null, a: null })
    window.scrollTo(0, 0)
  }
  const d = detail.data
  const camp = d?.campaign ?? campaign
  const adset = drill.a ? d?.adsets.find((a) => a.id === drill.a) ?? null : null
  const crumbs = [{ id: camp.id, name: camp.name }, ...(adset ? [{ id: adset.id, name: adset.name }] : [])]
  let list: React.ReactNode
  if (detail.isPending) list = [0, 1].map((i) => <span key={i} className="sk block h-40 rounded-[14px]" />)
  else if (detail.isError || !d)
    list = (
      <div className="flex flex-col items-start gap-2 rounded-[14px] border border-line bg-card p-3.5">
        <b>{t("detailFailed")}</b>
        <Button size="sm" variant="outline" onClick={() => detail.refetch()}>
          {t("retry")}
        </Button>
      </div>
    )
  else if (adset) {
    let ads = adset.ads.map((ad) => ({ level: "ad", row: ad as MetaCampaignAdRow, campaign: camp, adset }) as Extract<Node, { level: "ad" }>)
    if (filtering(ctx.filters)) {
      const hit = ads.filter((x) => selfOk(x, ctx.filters))
      if (hit.length) ads = hit
    }
    list = sortNodes(ads, sort, dir, ctx.period).map((n) => <Card key={n.row.metaAdId} n={n} ctx={ctx} />)
  } else {
    let sets = d.adsets.map((a) => ({ level: "adset", row: a, campaign: camp }) as Extract<Node, { level: "adset" }>)
    if (filtering(ctx.filters)) {
      const hit = sets.filter((x, i) => selfOk(x, ctx.filters) || d.adsets[i].ads.some((ad) => selfOk({ level: "ad", row: ad, campaign: camp, adset: x.row }, ctx.filters)))
      if (hit.length) sets = hit
    }
    list = sortNodes(sets, sort, dir, ctx.period).map((n) => <Card key={n.row.id} n={n} ctx={ctx} onDrill={() => { setDrill({ c: camp.id, a: n.row.id }); window.scrollTo(0, 0) }} />)
  }
  return (
    <>
      <Crumb items={crumbs} onRoot={root} onCampaign={(id) => setDrill({ c: id, a: null })} />
      {adset ? <Card n={{ level: "adset", row: adset, campaign: camp }} ctx={ctx} head /> : <Card n={{ level: "campaign", row: camp }} ctx={ctx} head />}
      {list}
      {Array.isArray(list) && !list.length ? empty : null}
    </>
  )
}

export function PhoneList({
  mode, campaigns, ads, totals, ctx, sort, dir, drill, setDrill, empty,
}: {
  mode: "tree" | "ads"
  campaigns: MetaCampaignRow[]
  ads: Extract<Node, { level: "ad" }>[]
  totals: MetaCampaignsTotals
  ctx: TableCtx
  sort: SortKey
  dir: "asc" | "desc"
  drill: Drill
  setDrill: (d: Drill) => void
  empty: React.ReactNode
}) {
  const drilled = mode === "tree" && drill.c ? campaigns.find((c) => c.id === drill.c) ?? null : null
  let body: React.ReactNode
  if (mode === "ads") body = ads.length ? ads.map((n) => <Card key={n.row.metaAdId} n={n} ctx={ctx} path={`${n.row.campaign.name} › ${n.row.adset.name}`} />) : empty
  else if (drilled) body = <DrillLevel campaign={drilled} drill={drill} setDrill={setDrill} ctx={ctx} sort={sort} dir={dir} empty={empty} />
  else
    body = campaigns.length
      ? campaigns.map((c) => <Card key={c.id} n={{ level: "campaign", row: c }} ctx={ctx} onDrill={() => { setDrill({ c: c.id, a: null }); window.scrollTo(0, 0) }} />)
      : empty
  return (
    <>
      <Totals totals={totals} ctx={ctx} />
      <div className="flex flex-col gap-2.5 tablet:hidden">{body}</div>
    </>
  )
}

export function CardsSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 tablet:hidden" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-card p-3.5">
          <span className="sk block h-2.5 w-[70%] rounded-[6px]" />
          <span className="sk block h-2.5 w-[40%] rounded-[6px]" />
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((j) => (
              <span key={j} className="sk block h-2.5 w-12 rounded-[6px]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
