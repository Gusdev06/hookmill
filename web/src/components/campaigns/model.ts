import type { QueryClient } from "@tanstack/react-query"
import type { ApiResult } from "@/lib/api/client"
import type {
  MetaAdsMeta, MetaAdsetRow, MetaBudget, MetaCampaignAdRow, MetaCampaignDetail, MetaCampaignRow, MetaCampaignsMeta, MetaLevel, MetaMetrics, MetaObjectRef,
  MetaPeriod, MetaToggleStatus, MetaWriteResult,
} from "@/lib/api/types"

/*
 * Campaigns v1 (docs/contratos/campanhas-v1.md, spec design/campanhas-v1-2026-10-22.md): one node type for the three
 * levels so the table, the phone cards and the dialogs read the same thing. The ad row is MetaAdRow (meta-v1) with the
 * campaigns fields; its id is `metaAdId`.
 */
export type Node =
  | { level: "campaign"; row: MetaCampaignRow }
  | { level: "adset"; row: MetaAdsetRow; campaign: MetaCampaignRow | null }
  | { level: "ad"; row: MetaCampaignAdRow; campaign: MetaCampaignRow | null; adset: MetaAdsetRow | null }

export type Filters = { status: "all" | "active" | "paused" | "issues"; origin: "all" | "hookmill"; q: string }
export type SortKey = "spend" | "cpa" | "results" | "ctr" | "hookRate" | "budget" | "name"
export type MetricKey = "spend" | "results" | "cpa" | "ctr" | "hook"

export const nodeId = (n: Node) => (n.level === "ad" ? n.row.metaAdId : n.row.id)
export const statusOf = (n: Node): MetaToggleStatus =>
  n.level === "ad" ? (n.row.status ?? (n.row.effectiveStatus === "ACTIVE" ? "ACTIVE" : "PAUSED")) : n.row.status
export const windowOf = (n: Node, period: MetaPeriod): MetaMetrics => (period === "7d" ? n.row.metrics7d : n.row.metrics)
export const hmOf = (n: Node) => (n.level === "ad" ? (n.row.fromHookMill ?? !!n.row.creative) : n.row.fromHookMill)
export const isVideoAd = (n: Node) => n.level === "ad" && (n.row.canIterate ?? !!n.row.videoId)

const PAUSED = ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]
const ISSUES = ["DISAPPROVED", "WITH_ISSUES", "PENDING_REVIEW", "IN_PROCESS"]
export function matchStatus(eff: string, f: Filters["status"]) {
  return f === "all" || (f === "active" ? eff === "ACTIVE" : f === "paused" ? PAUSED.includes(eff) : ISSUES.includes(eff))
}
/** the node itself passes the filters (the API already filtered the campaigns; children are filtered here when expanding) */
export function selfOk(n: Node, f: Filters) {
  const q = f.q.trim().toLowerCase()
  return matchStatus(n.row.effectiveStatus, f.status) && (f.origin === "all" || hmOf(n)) && (!q || n.row.name.toLowerCase().includes(q))
}
export const filtering = (f: Filters) => f.status !== "all" || f.origin !== "all" || !!f.q.trim()

export type StatusTone = "on" | "off" | "held" | "bad"
/** what the status cell says (spec §2.4): rejected / in review / off / on but held by a parent / on */
export function statusInfo(n: Node): { tone: StatusTone; key: "rejected" | "inReview" | "issues" | "off" | "campOff" | "setOff" | "on" } {
  const eff = n.row.effectiveStatus
  if (eff === "DISAPPROVED") return { tone: "bad", key: "rejected" }
  if (eff === "PENDING_REVIEW" || eff === "IN_PROCESS") return { tone: "held", key: "inReview" }
  if (eff === "WITH_ISSUES") return { tone: "bad", key: "issues" }
  if (statusOf(n) === "PAUSED") return { tone: "off", key: "off" }
  if (eff === "CAMPAIGN_PAUSED") return { tone: "held", key: "campOff" }
  if (eff === "ADSET_PAUSED") return { tone: "held", key: "setOff" }
  return { tone: "on", key: "on" }
}

export type ResultKey = "purchase" | "lead" | "install" | "click" | "other"
/** "Purchases" / "Leads"… from the account's resultType (like the Home) */
export function resultKey(resultType: string | null | undefined): ResultKey {
  const r = resultType ?? ""
  if (r.includes("purchase")) return "purchase"
  if (r.includes("lead")) return "lead"
  if (r.includes("install")) return "install"
  if (r.includes("link_click") || r === "click") return "click"
  return "other"
}

export function metricValue(m: MetaMetrics, k: MetricKey): number | null {
  return k === "spend" ? m.spend : k === "results" ? m.results : k === "cpa" ? m.cpa : k === "ctr" ? (m.spend ? m.ctr : null) : m.hookRate
}
/** 7 d only (spec §2.6): % change vs the 7 days before; good = CPA down, the rest up; spend is always neutral */
export function deltaOf(n: Node, k: MetricKey): { pct: number; up: boolean; tone: "good" | "bad" | "flat" } | "none" | null {
  const x = metricValue(n.row.metrics7d, k)
  const y = metricValue(n.row.metricsPrev7d, k)
  if (x === null || y === null || !y) return "none"
  const d = ((x - y) / y) * 100
  if (Math.abs(d) < 1) return { pct: 0, up: false, tone: "flat" }
  const up = d > 0
  const better = k === "spend" ? null : k === "cpa" ? !up : up
  return { pct: Math.abs(Math.round(d)), up, tone: better === null ? "flat" : better ? "good" : "bad" }
}

/** where the budget the object spends from lives (for the "Turn on" dialog) */
export function spendBudget(n: Node): { budget: MetaBudget; where: "campaign" | "adset" } | null {
  const own = n.level === "ad" ? (n.adset?.budget ?? n.campaign?.budget ?? null) : n.row.budget
  if (!own || own.amountMinor === null) {
    if (n.level !== "campaign" && n.campaign?.budget.amountMinor != null) return { budget: n.campaign.budget, where: "campaign" }
    return null
  }
  return { budget: own, where: own.level === "adset" ? "adset" : "campaign" }
}
/** paused parents that turning this on would need (D6). Known rows first; in "Ads only", inferred from effectiveStatus. */
export function pausedParents(n: Node): MetaObjectRef[] {
  if (n.level === "campaign") return []
  const out: MetaObjectRef[] = []
  const camp = n.campaign
  if (camp ? camp.status === "PAUSED" : n.row.effectiveStatus === "CAMPAIGN_PAUSED")
    out.push({ level: "campaign", id: camp?.id ?? (n.level === "ad" ? n.row.campaign.id : n.row.campaignId), name: camp?.name ?? (n.level === "ad" ? n.row.campaign.name : "") })
  if (n.level === "ad") {
    if (n.adset ? n.adset.status === "PAUSED" : n.row.effectiveStatus === "ADSET_PAUSED") out.push({ level: "adset", id: n.adset?.id ?? n.row.adset.id, name: n.adset?.name ?? n.row.adset.name })
  }
  return out
}
/** "campaign › ad set" under the name (ads view, dialogs) */
export function pathOf(n: Node): string | null {
  if (n.level === "campaign") return null
  if (n.level === "adset") return n.campaign?.name ?? null
  return `${n.campaign?.name ?? n.row.campaign.name} › ${n.adset?.name ?? n.row.adset.name}`
}
/** any ad set of the campaign (or this ad set) learning: the budget dialog warns (spec §2.10) */
export const learningOf = (n: Node) => (n.level === "campaign" ? !!n.row.anyAdsetLearning : n.level === "adset" ? n.row.learningStage === "LEARNING" : false)

// ───────────────────────── cache patching after a write / "Update row" ─────────────────────────
type CampList = ApiResult<MetaCampaignRow[], MetaCampaignsMeta>
type AdList = ApiResult<MetaCampaignAdRow[], MetaAdsMeta>
type Paged<L> = L | { pages: L[]; pageParams: unknown[] }
/** map the rows of a cached list, paged (useInfiniteQuery) or not (Home's single page) */
function mapRows<R, L extends ApiResult<R[], unknown>>(d: Paged<L> | undefined, fn: (r: R) => R): Paged<L> | undefined {
  if (!d) return d
  if ("pages" in d) return { ...d, pages: d.pages.map((p) => ({ ...p, data: p.data.map(fn) })) }
  return Array.isArray(d.data) ? { ...d, data: d.data.map(fn) } : d
}
type Patch = { status?: MetaToggleStatus; dailyBudgetMinor?: number | null; object?: MetaWriteResult["object"] }

function patchRow<R extends { status?: MetaToggleStatus; budget?: MetaBudget }>(r: R, p: Patch, replace?: R): R {
  const base = replace ? { ...r, ...replace } : r
  const next = { ...base } as R
  if (p.status) next.status = p.status
  if (p.dailyBudgetMinor !== undefined && next.budget) next.budget = { ...next.budget, amountMinor: p.dailyBudgetMinor }
  return next
}
/** swap one object in every cached Campaigns query (list, detail, ads) */
export function patchObject(qc: QueryClient, level: MetaLevel, id: string, p: Patch) {
  if (level === "campaign") {
    qc.setQueriesData<Paged<CampList>>({ queryKey: ["meta", "campaigns"] }, (d) => mapRows<MetaCampaignRow, CampList>(d, (r) => (r.id === id ? patchRow(r, p, p.object as MetaCampaignRow | undefined) : r)))
    qc.setQueriesData<MetaCampaignDetail>({ queryKey: ["meta", "campaign", id] }, (d) => d && { ...d, campaign: patchRow(d.campaign, p, p.object as MetaCampaignRow | undefined) })
  } else if (level === "adset") {
    qc.setQueriesData<MetaCampaignDetail>({ queryKey: ["meta", "campaign"] }, (d) =>
      d && { ...d, adsets: d.adsets.map((a) => (a.id === id ? { ...patchRow(a, p, p.object ? ({ ...(p.object as MetaAdsetRow), ads: a.ads } as typeof a) : undefined), ads: a.ads } : a)) }
    )
  } else {
    const fix = (r: MetaCampaignAdRow) => (r.metaAdId === id ? patchRow(r, p, p.object as MetaCampaignAdRow | undefined) : r)
    qc.setQueriesData<MetaCampaignDetail>({ queryKey: ["meta", "campaign"] }, (d) => d && { ...d, adsets: d.adsets.map((a) => ({ ...a, ads: a.ads.map(fix) })) })
    qc.setQueriesData<Paged<AdList>>({ queryKey: ["meta", "ads"] }, (d) => mapRows<MetaCampaignAdRow, AdList>(d, fix))
  }
}
