/**
 * MSW model of Campaigns v1 (docs/contratos/campanhas-v1.md §4-§6). Mirrors the structure of the API mock
 * (api/src/integracoes/meta/PORTA.md § Campaigns v1): mock_cmp_cbo (CBO $50/day, 2 ad sets, one LEARNING),
 * mock_cmp_abo (ABO: $20/day set, a PAUSED set with an active ad inside, the [mock:stale] set), mock_cmp_life (CBO
 * lifetime) + one HookMill publication (paused). Ads = the 6 Home videos (same ids, so Iterate pre-selects them) +
 * 2 videos + 2 images. Writes change the snapshot for real (the toggle flips), and every write lands in History.
 *
 * Triggers (same as the API mock): turning on ad_5 (inside the paused set) without includeParents → META_PARENT_PAUSED ·
 * any write on the [mock:stale] set → META_OBJECT_CHANGED (until you send what Meta has now) · turning on ad_7
 * (DISAPPROVED) → META_POLICY · budget on a CBO ad set or on the lifetime campaign → META_BUDGET_NOT_EDITABLE ·
 * < $5 → META_BUDGET_TOO_LOW · > 2× → META_BUDGET_STEP_TOO_LARGE · [mock:meta-rate] / [mock:meta-token] in the name →
 * 503 rate_limited / META_TOKEN_INVALID (logged FAILED) · 21st write in a minute → 429 RATE_LIMITED.
 * Page states: ?metamock=stale|failed|unusable|trunc|nocamp|expired|off · role: ?mockrole=member|client.
 */
import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type {
  MetaAdsetRow, MetaBudget, MetaBudgetBody, MetaCampaignAdRow, MetaCampaignRow, MetaChangeRow, MetaLearningStage, MetaLevel, MetaMetrics,
  MetaObjectRef, MetaPeriod, MetaStatusBody, MetaStatusCounts, MetaToggleStatus, MetaWriteResult, UserRef,
} from "@/lib/api/types"
import { db } from "./db"
import { mockWorkspaceOf } from "./auth"
import { ME } from "./fixtures"
import { metaOf, selectedOf, settle } from "./handlers-meta"
import { accountOf, ADS, adRows, metaFlag, metrics, summaryOf, syncState, type MetaState } from "./v2"

const u = (p: string) => API_URL + p
const ok = <D, M>(data: D, meta?: M, status = 200) => HttpResponse.json({ success: true, data, ...(meta ? { meta } : {}) }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })
const iso = (t: number) => new Date(t).toISOString()
const MIN_MINOR = 500
const STEP = 2
const WRITES_PER_MIN = 20

// ───────────────────────── state (localStorage, per workspace) ─────────────────────────
interface MC { id: string; name: string; status: MetaToggleStatus; objective: string; cbo: boolean; kind: "daily" | "lifetime" | null; budget: number | null; remaining: number | null; hm: boolean; days: number }
interface MA { id: string; campaignId: string; name: string; status: MetaToggleStatus; learning: MetaLearningStage | null; budget: number | null; hm: boolean; live?: { status: MetaToggleStatus; budget: number | null } }
interface MD {
  id: string; adsetId: string; name: string; status: MetaToggleStatus; disapproved?: boolean; format: "video" | "image"; hm: boolean; creativeId: string | null; thumb: string
  /** extra ads (not the Home 6): [spend, results, imp] for 30 d, 7 d, previous 7 d + verdict/trend */
  seed?: { m: [number, number, number]; m7: [number, number, number]; p7: [number, number, number]; verdict: MetaCampaignAdRow["verdict"]; trend: MetaCampaignAdRow["trend"]; days: number }
}
interface CState { campaigns: MC[]; adsets: MA[]; ads: MD[]; changes: (Omit<MetaChangeRow, "alsoChangedRefs">)[]; writes: number[] }

const KEY = "mock:campaigns"
let store: Record<string, CState> | null = null
function load(): Record<string, CState> {
  if (store) return store
  if (typeof window === "undefined") return (store = {})
  if (new URLSearchParams(window.location.search).get("mock") === "reset") localStorage.removeItem(KEY)
  try {
    store = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, CState>
  } catch {
    store = {}
  }
  return store
}
const persist = () => typeof window !== "undefined" && localStorage.setItem(KEY, JSON.stringify(load()))

const GUSTA: UserRef = { id: ME.id, name: ME.name, initials: "G" }
const TORDAN: UserRef = { id: "u_tordan", name: "Tordan", initials: "T" }

function seed(): CState {
  const now = Date.now()
  const creativeId = (db.creatives as { id: string }[] | undefined)?.[0]?.id ?? null
  const campaigns: MC[] = [
    { id: "mock_cmp_cbo", name: "MC | Sleep mask | Purchases", status: "ACTIVE", objective: "OUTCOME_SALES", cbo: true, kind: "daily", budget: 5000, remaining: null, hm: false, days: 64 },
    { id: "mock_cmp_abo", name: "MC | Founder story | ABO tests", status: "ACTIVE", objective: "OUTCOME_SALES", cbo: false, kind: null, budget: null, remaining: null, hm: false, days: 30 },
    { id: "mock_cmp_life", name: "MC | Evergreen | Lifetime", status: "ACTIVE", objective: "OUTCOME_SALES", cbo: true, kind: "lifetime", budget: 30000, remaining: 11400, hm: false, days: 90 },
    { id: "mock_cmp_hm", name: "HookMill · Weighted mask · Oct 18", status: "PAUSED", objective: "OUTCOME_SALES", cbo: true, kind: "daily", budget: 4000, remaining: null, hm: true, days: 4 },
  ]
  const adsets: MA[] = [
    { id: "mock_adset_cbo_1", campaignId: "mock_cmp_cbo", name: "Broad · US · 30–55", status: "ACTIVE", learning: "SUCCESS", budget: null, hm: false },
    { id: "mock_adset_cbo_2", campaignId: "mock_cmp_cbo", name: "Lookalike 1% · buyers", status: "ACTIVE", learning: "LEARNING", budget: null, hm: false },
    { id: "mock_adset_abo_1", campaignId: "mock_cmp_abo", name: "Interests · sleep & wellness", status: "ACTIVE", learning: "SUCCESS", budget: 2000, hm: false },
    { id: "mock_adset_abo_paused", campaignId: "mock_cmp_abo", name: "Retarget · visitors 30d", status: "PAUSED", learning: null, budget: 4000, hm: false },
    { id: "mock_adset_abo_stale", campaignId: "mock_cmp_abo", name: "Women 35+ · US [mock:stale]", status: "ACTIVE", learning: "FAIL", budget: 5000, hm: false, live: { status: "PAUSED", budget: 5700 } },
    { id: "mock_adset_life_1", campaignId: "mock_cmp_life", name: "Broad · worldwide EN", status: "ACTIVE", learning: "SUCCESS", budget: null, hm: false },
    { id: "mock_adset_hm_1", campaignId: "mock_cmp_hm", name: "HookMill · Broad · US", status: "ACTIVE", learning: null, budget: null, hm: true },
  ]
  const v = (id: string, adsetId: string, thumb: string, extra: Partial<MD> = {}): MD => ({ id, adsetId, name: ADS.find((a) => a.id === id)?.name ?? id, status: "ACTIVE", format: "video", hm: false, creativeId: null, thumb, ...extra })
  const ads: MD[] = [
    v("ad_1", "mock_adset_cbo_1", "/mock/art-0-1.svg"),
    v("ad_3", "mock_adset_cbo_1", "/mock/art-2-2.svg"),
    { id: "mock_ad_img_1", adsetId: "mock_adset_cbo_1", name: "Mask flatlay · still [mock:meta-rate]", status: "ACTIVE", format: "image", hm: false, creativeId: null, thumb: "/mock/art-3-0.svg", seed: { m: [380, 15, 41_000], m7: [110, 5, 11_000], p7: [70, 1, 8_000], verdict: "WINNER", trend: null, days: 22 } },
    v("ad_2", "mock_adset_cbo_2", "/mock/art-1-3.svg"),
    v("ad_6", "mock_adset_cbo_2", "/mock/art-0-0.svg", { hm: true, creativeId }),
    v("ad_4", "mock_adset_abo_1", "/mock/art-3-2.svg"),
    { id: "mock_ad_8", adsetId: "mock_adset_abo_1", name: "Unboxing in 9 seconds", status: "ACTIVE", format: "video", hm: false, creativeId: null, thumb: "/mock/art-1-1.svg", seed: { m: [440, 12, 48_000], m7: [120, 3, 13_000], p7: [120, 4, 13_000], verdict: "OK", trend: "STEADY", days: 19 } },
    v("ad_5", "mock_adset_abo_paused", "/mock/art-2-0.svg"),
    { id: "mock_ad_img_2", adsetId: "mock_adset_abo_paused", name: "Review stack [mock:meta-token]", status: "PAUSED", format: "image", hm: false, creativeId: null, thumb: "/mock/art-1-0.svg", seed: { m: [250, 6, 30_000], m7: [0, 0, 0], p7: [40, 1, 5_000], verdict: "LOW_DATA", trend: null, days: 40 } },
    { id: "mock_ad_9", adsetId: "mock_adset_abo_stale", name: "Pillow talk", status: "ACTIVE", format: "video", hm: false, creativeId: null, thumb: "/mock/art-0-2.svg", seed: { m: [600, 12, 70_000], m7: [220, 4, 21_000], p7: [160, 4, 16_000], verdict: "OK", trend: "TIRING", days: 26 } },
    { id: "ad_7", adsetId: "mock_adset_abo_stale", name: "Sleep like a baby (old)", status: "PAUSED", disapproved: true, format: "video", hm: false, creativeId: null, thumb: "/mock/art-3-1.svg", seed: { m: [0, 0, 0], m7: [0, 0, 0], p7: [0, 0, 0], verdict: "LOW_DATA", trend: null, days: 50 } },
    { id: "mock_ad_10", adsetId: "mock_adset_life_1", name: "Sleep test · 7 nights", status: "ACTIVE", format: "video", hm: false, creativeId: null, thumb: "/mock/art-2-1.svg", seed: { m: [1720, 58, 160_000], m7: [410, 13, 40_000], p7: [420, 15, 41_000], verdict: "OK", trend: "STEADY", days: 88 } },
    { id: "mock_ad_hm_1", adsetId: "mock_adset_hm_1", name: "HookMill · Weighted mask A", status: "ACTIVE", format: "video", hm: true, creativeId, thumb: "/mock/art-1-2.svg", seed: { m: [0, 0, 0], m7: [0, 0, 0], p7: [0, 0, 0], verdict: "LOW_DATA", trend: null, days: 4 } },
  ]
  const ch = (id: string, by: UserRef, level: MetaLevel, objectId: string, objectName: string, field: MetaChangeRow["field"], from: string, to: string, ago: number, extra: Partial<MetaChangeRow> = {}) =>
    ({ id, level, objectId, objectName, field, from, to, alsoChanged: [], result: "APPLIED" as const, errorCode: null, source: "CAMPAIGNS" as const, by, at: iso(now - ago), ...extra })
  const changes = [
    ch("chg_5", GUSTA, "adset", "mock_adset_abo_1", "Interests · sleep & wellness", "DAILY_BUDGET", "1500", "2000", 2 * 3_600_000),
    ch("chg_4", TORDAN, "adset", "mock_adset_abo_paused", "Retarget · visitors 30d", "STATUS", "ACTIVE", "PAUSED", 26 * 3_600_000),
    ch("chg_3", TORDAN, "ad", "ad_7", "Sleep like a baby (old)", "STATUS", "PAUSED", "ACTIVE", 3 * 864e5, { result: "FAILED", errorCode: "META_POLICY" }),
    ch("chg_2", GUSTA, "campaign", "mock_cmp_hm", "HookMill · Weighted mask · Oct 18", "STATUS", "ACTIVE", "PAUSED", 4 * 864e5, { source: "PUBLISH" }),
    ch("chg_1", TORDAN, "campaign", "mock_cmp_cbo", "MC | Sleep mask | Purchases", "DAILY_BUDGET", "4000", "5000", 5 * 864e5),
  ]
  return { campaigns, adsets, ads, changes, writes: [] }
}
function stateOf(req: Request): CState {
  const id = mockWorkspaceOf(req.headers.get("Authorization")).id
  const s = load()
  if (!s[id]) {
    s[id] = seed()
    persist()
  }
  return s[id]
}

// ───────────────────────── views ─────────────────────────
type Win = [number, number, number]
const ZERO: MetaMetrics = { spend: 0, impressions: 0, clicks: 0, ctr: 0, results: 0, resultType: "omni_purchase", cpa: null, roas: null, plays2s: null, hookRate: null, thruplays: null, frequency: null, reach: 0 }
function adWindows(d: MD, m: MetaState): { m: MetaMetrics; m7: MetaMetrics; p7: MetaMetrics; verdict: MetaCampaignAdRow["verdict"]; trend: MetaCampaignAdRow["trend"]; days: number } {
  const home = ADS.find((a) => a.id === d.id)
  const img = d.format === "image"
  const mk = ([s, r, imp]: Win, roas: number | null, freq: number | null): MetaMetrics => {
    if (!s) return { ...ZERO }
    const x = metrics(s, r, roas, imp, freq)
    return img ? { ...x, plays2s: null, hookRate: null, thruplays: null } : x
  }
  if (home) {
    const row = adRows(m, new Set()).find((r) => r.metaAdId === d.id)!
    return { m: row.metrics, m7: row.metrics7d, p7: row.metricsPrev7d, verdict: row.verdict, trend: row.trend, days: home.days }
  }
  const sd = d.seed!
  return { m: mk(sd.m, 2.2, null), m7: mk(sd.m7, 2.2, 2.0), p7: mk(sd.p7, 2.0, 1.8), verdict: sd.verdict, trend: sd.trend, days: sd.days }
}
function sum(list: MetaMetrics[], freq: number | null): MetaMetrics {
  const spend = list.reduce((n, x) => n + x.spend, 0)
  if (!spend) return { ...ZERO, frequency: freq === null ? null : 0 }
  const imp = list.reduce((n, x) => n + x.impressions, 0)
  const clicks = list.reduce((n, x) => n + x.clicks, 0)
  const results = list.reduce((n, x) => n + x.results, 0)
  const vids = list.filter((x) => x.hookRate !== null && x.impressions)
  const vImp = vids.reduce((n, x) => n + x.impressions, 0)
  const roasW = list.filter((x) => x.roas !== null)
  return {
    spend: +spend.toFixed(2), impressions: imp, clicks, ctr: imp ? +((clicks / imp) * 100).toFixed(2) : 0, results, resultType: "omni_purchase",
    cpa: results ? +(spend / results).toFixed(2) : null, roas: roasW.length ? +(roasW.reduce((n, x) => n + (x.roas ?? 0) * x.spend, 0) / spend).toFixed(2) : null,
    plays2s: vids.reduce((n, x) => n + (x.plays2s ?? 0), 0) || null, hookRate: vImp ? +(vids.reduce((n, x) => n + (x.hookRate ?? 0) * x.impressions, 0) / vImp).toFixed(1) : null,
    thruplays: vids.reduce((n, x) => n + (x.thruplays ?? 0), 0) || null, frequency: freq, reach: Math.round(imp / (freq ?? 1.9)),
  }
}
const actNum = (m: MetaState) => (m.adAccountId ?? "act_0").replace(/^act_/, "")
const amUrl = (m: MetaState, level: MetaLevel, id: string) =>
  `https://adsmanager.facebook.com/adsmanager/manage/${level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads"}?act=${actNum(m)}&selected_${level}_ids=${id}`
const writer = (req: Request) => {
  const role = (typeof window !== "undefined" && sessionStorage.getItem("mock:role")) || mockWorkspaceOf(req.headers.get("Authorization")).role
  return role === "OWNER" || role === "ADMIN"
}
const unusable = () => metaFlag() === "unusable"

function effAd(s: CState, d: MD): string {
  if (d.disapproved) return "DISAPPROVED"
  if (d.status === "PAUSED") return "PAUSED"
  const a = s.adsets.find((x) => x.id === d.adsetId)!
  const c = s.campaigns.find((x) => x.id === a.campaignId)!
  return c.status === "PAUSED" ? "CAMPAIGN_PAUSED" : a.status === "PAUSED" ? "ADSET_PAUSED" : "ACTIVE"
}
function effSet(s: CState, a: MA): string {
  if (a.status === "PAUSED") return "PAUSED"
  return s.campaigns.find((x) => x.id === a.campaignId)!.status === "PAUSED" ? "CAMPAIGN_PAUSED" : "ACTIVE"
}

function adView(s: CState, m: MetaState, d: MD, canWrite: boolean): MetaCampaignAdRow {
  const a = s.adsets.find((x) => x.id === d.adsetId)!
  const c = s.campaigns.find((x) => x.id === a.campaignId)!
  const w = adWindows(d, m)
  return {
    metaAdId: d.id, name: d.name, effectiveStatus: effAd(s, d), campaign: { id: c.id, name: c.name }, adset: { id: a.id, name: a.name },
    thumbnailUrl: d.thumb, videoId: d.format === "video" ? `v_${d.id}` : null,
    metrics: w.m, metrics7d: w.m7, metricsPrev7d: w.p7, verdict: w.verdict, trend: w.trend, daysRunning: w.days,
    creative: d.creativeId ? { id: d.creativeId, name: d.name, adName: d.name } : null, championId: null,
    adCreatedTime: iso(Date.now() - w.days * 864e5), syncedAt: m.lastSyncAt ?? iso(Date.now()),
    status: d.status, fromHookMill: d.hm, adsManagerUrl: amUrl(m, "ad", d.id), canToggle: canWrite && !unusable() && !d.disapproved, canIterate: d.format === "video",
  }
}
function budgetOf(s: CState, level: "campaign" | "adset", id: string, currency: string, canWrite: boolean): MetaBudget {
  const base = { currency, minimumMinor: MIN_MINOR }
  if (level === "campaign") {
    const c = s.campaigns.find((x) => x.id === id)!
    if (!c.cbo) return { ...base, level: "adset", kind: null, amountMinor: null, remainingMinor: null, editable: false }
    return { ...base, level: "campaign", kind: c.kind, amountMinor: c.budget, remainingMinor: c.remaining, editable: canWrite && !unusable() && c.kind === "daily" }
  }
  const a = s.adsets.find((x) => x.id === id)!
  const c = s.campaigns.find((x) => x.id === a.campaignId)!
  if (c.cbo) return { ...base, level: "campaign", kind: c.kind, amountMinor: c.budget, remainingMinor: c.remaining, editable: false }
  return { ...base, level: "adset", kind: "daily", amountMinor: a.budget, remainingMinor: null, editable: canWrite && !unusable() }
}
function setView(s: CState, m: MetaState, a: MA, canWrite: boolean, ads: MetaCampaignAdRow[]): MetaAdsetRow {
  const cur = accountOf(m.adAccountId)?.currency ?? "USD"
  return {
    id: a.id, name: a.name, status: a.status, effectiveStatus: effSet(s, a), campaignId: a.campaignId,
    metrics: sum(ads.map((x) => x.metrics), null), metrics7d: sum(ads.map((x) => x.metrics7d), 1.9), metricsPrev7d: sum(ads.map((x) => x.metricsPrev7d), 1.8),
    fromHookMill: a.hm, adsManagerUrl: amUrl(m, "adset", a.id), canToggle: canWrite && !unusable(),
    optimizationGoal: "OFFSITE_CONVERSIONS", billingEvent: "IMPRESSIONS", bidStrategy: "LOWEST_COST_WITHOUT_CAP", learningStage: a.learning,
    budget: budgetOf(s, "adset", a.id, cur, canWrite),
    counts: { ads: ads.length, activeAds: ads.filter((x) => x.effectiveStatus === "ACTIVE").length, winners: ads.filter((x) => x.verdict === "WINNER").length },
    startTime: null, endTime: null,
  }
}
function campaignView(s: CState, m: MetaState, c: MC, canWrite: boolean) {
  const cur = accountOf(m.adAccountId)?.currency ?? "USD"
  const sets = s.adsets.filter((a) => a.campaignId === c.id).map((a) => {
    const ads = s.ads.filter((d) => d.adsetId === a.id).map((d) => adView(s, m, d, canWrite))
    return { ...setView(s, m, a, canWrite, ads), ads }
  })
  const ads = sets.flatMap((x) => x.ads)
  const row: MetaCampaignRow = {
    id: c.id, name: c.name, status: c.status, effectiveStatus: c.status,
    metrics: sum(ads.map((x) => x.metrics), null), metrics7d: sum(ads.map((x) => x.metrics7d), 1.9), metricsPrev7d: sum(ads.map((x) => x.metricsPrev7d), 1.8),
    fromHookMill: c.hm, adsManagerUrl: amUrl(m, "campaign", c.id), canToggle: canWrite && !unusable(),
    objective: c.objective, buyingType: "AUCTION", bidStrategy: "LOWEST_COST_WITHOUT_CAP", isCbo: c.cbo, budget: budgetOf(s, "campaign", c.id, cur, canWrite),
    counts: { adsets: sets.length, ads: ads.length, activeAds: ads.filter((x) => x.effectiveStatus === "ACTIVE").length, winners: ads.filter((x) => x.verdict === "WINNER").length, tiring: ads.filter((x) => x.trend === "TIRING").length },
    startTime: iso(Date.now() - c.days * 864e5), stopTime: null, anyAdsetLearning: sets.some((x) => x.learningStage === "LEARNING"),
  }
  return { row, sets }
}

// ───────────────────────── filters / sort ─────────────────────────
type StatusF = "active" | "paused" | "issues" | "all"
const ISSUES = ["DISAPPROVED", "WITH_ISSUES", "PENDING_REVIEW", "IN_PROCESS"]
const matchStatus = (eff: string, f: StatusF) =>
  f === "all" || (f === "active" ? eff === "ACTIVE" : f === "paused" ? ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(eff) : ISSUES.includes(eff))
const has = (name: string, q: string) => !q || name.toLowerCase().includes(q.toLowerCase())
type Sortable = { name: string; metrics: MetaMetrics; metrics7d: MetaMetrics; budget?: MetaBudget }
function sorter(sort: string, dir: "asc" | "desc", period: MetaPeriod) {
  const d = dir === "asc" ? 1 : -1
  const val = (x: Sortable): number | null => {
    const w = period === "7d" ? x.metrics7d : x.metrics
    return sort === "cpa" ? w.cpa : sort === "results" ? w.results : sort === "ctr" ? w.ctr : sort === "hookRate" ? w.hookRate : sort === "budget" ? (x.budget?.amountMinor ?? null) : w.spend
  }
  return (a: Sortable, b: Sortable) => {
    if (sort === "name") return d * a.name.localeCompare(b.name)
    const x = val(a), y = val(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return d * (x - y)
  }
}
/** offset cursor like the API; `?mockpage=N` (sessionStorage mock:page) shrinks the page so "Load more" can be tested */
function pageOf<T>(rows: T[], sp: URLSearchParams) {
  const small = typeof window !== "undefined" ? Number(sessionStorage.getItem("mock:page")) || 0 : 0
  const limit = Math.min(small || 100, Math.max(1, Math.min(100, Number(sp.get("limit")) || 30)))
  const start = Number(sp.get("cursor") ?? 0) || 0
  return { items: rows.slice(start, start + limit), nextCursor: start + limit < rows.length ? String(start + limit) : null }
}
const dirOf = (sp: URLSearchParams, sort: string): "asc" | "desc" => (sp.get("dir") === "asc" || sp.get("dir") === "desc" ? (sp.get("dir") as "asc" | "desc") : sort === "cpa" || sort === "name" ? "asc" : "desc")
function totals(list: { metrics: MetaMetrics; metrics7d: MetaMetrics }[], period: MetaPeriod) {
  const w = sum(list.map((x) => (period === "7d" ? x.metrics7d : x.metrics)), null)
  return { count: list.length, spend: w.spend, results: w.results, resultType: "omni_purchase", cpa: w.cpa, ctr: w.spend ? w.ctr : null, hookRate: w.hookRate }
}
export { totals as mockTotals }

// ───────────────────────── reads ─────────────────────────
function guard(req: Request): MetaState | Response {
  if (metaFlag() === "off") return fail("META_NOT_CONFIGURED", 503, "Meta isn't set up on this server yet.", { reason: "off" })
  const m = metaOf(req)
  if (!selectedOf(m)) return fail("META_NOT_CONNECTED", 422, "Connect a Meta account first.")
  settle(m)
  return m
}
function campaignList(req: Request, m: MetaState) {
  const s = stateOf(req)
  const sp = new URL(req.url).searchParams
  const period: MetaPeriod = sp.get("period") === "7d" ? "7d" : "30d"
  const status = (sp.get("status") ?? "all") as StatusF
  const origin = sp.get("origin") === "hookmill" ? "hookmill" : "all"
  const q = (sp.get("q") ?? "").trim()
  const sort = sp.get("sort") ?? "spend"
  const sync = syncState(m)
  const canWrite = writer(req)
  const all = sync.state === "first_sync" || metaFlag() === "nocamp" ? [] : s.campaigns.map((c) => campaignView(s, m, c, canWrite))
  // origin + q first (counts ignore only `status`)
  const pre = all.flatMap(({ row, sets }) => {
    const hmOk = origin === "all" || row.fromHookMill || sets.some((a) => a.fromHookMill || a.ads.some((d) => d.fromHookMill))
    if (!hmOk) return []
    if (!q) return [{ row, sets }]
    const inSet = sets.some((a) => has(a.name, q))
    const inAd = sets.some((a) => a.ads.some((d) => has(d.name, q)))
    if (!has(row.name, q) && !inSet && !inAd) return []
    const matchedIn: ("adset" | "ad")[] = [...(inSet ? (["adset"] as const) : []), ...(inAd ? (["ad"] as const) : [])]
    return [{ row: { ...row, matchedIn }, sets }]
  })
  const statusHit = (x: (typeof pre)[number], f: StatusF) => matchStatus(x.row.effectiveStatus, f) || x.sets.some((a) => matchStatus(a.effectiveStatus, f) || a.ads.some((d) => matchStatus(d.effectiveStatus, f)))
  const counts: MetaStatusCounts = { all: pre.length, active: pre.filter((x) => statusHit(x, "active")).length, paused: pre.filter((x) => statusHit(x, "paused")).length, issues: pre.filter((x) => statusHit(x, "issues")).length }
  const all2 = pre.filter((x) => statusHit(x, status)).map((x) => x.row).sort(sorter(sort, dirOf(sp, sort), period))
  const { items: rows, nextCursor } = pageOf(all2, sp)
  return { rows, meta: { nextCursor, period, currency: accountOf(m.adAccountId)?.currency ?? "USD", totals: totals(all2, period), truncated: metaFlag() === "trunc", sync, counts } }
}

/** GET /meta/ads in the Campaigns "Ads only" mode (handlers-meta routes here when format=all or a campaigns filter is sent). */
export async function campaignAds(req: Request, m: MetaState) {
  const s = stateOf(req)
  const sp = new URL(req.url).searchParams
  const period: MetaPeriod = sp.get("period") === "7d" ? "7d" : "30d"
  const status = (sp.get("status") ?? "all") as StatusF
  const q = (sp.get("q") ?? "").trim()
  const sort = sp.get("sort") ?? "spend"
  const sync = syncState(m)
  const canWrite = writer(req)
  await delay(250)
  let ads = sync.state === "first_sync" || metaFlag() === "nocamp" ? [] : s.ads.map((d) => adView(s, m, d, canWrite))
  if (sp.get("format") !== "all") ads = ads.filter((d) => d.videoId)
  if (sp.get("origin") === "hookmill") ads = ads.filter((d) => d.fromHookMill)
  if (sp.get("campaignId")) ads = ads.filter((d) => d.campaign.id === sp.get("campaignId"))
  if (sp.get("adsetId")) ads = ads.filter((d) => d.adset.id === sp.get("adsetId"))
  if (q) ads = ads.filter((d) => has(d.name, q) || has(d.campaign.name, q) || has(d.adset.name, q))
  const counts: MetaStatusCounts = { all: ads.length, active: ads.filter((d) => matchStatus(d.effectiveStatus, "active")).length, paused: ads.filter((d) => matchStatus(d.effectiveStatus, "paused")).length, issues: ads.filter((d) => matchStatus(d.effectiveStatus, "issues")).length }
  const rows = ads.filter((d) => matchStatus(d.effectiveStatus, status)).sort(sorter(sort, dirOf(sp, sort), period))
  if (Number(sp.get("limit")) > 100) return fail("VALIDATION_ERROR", 400, "limit max 100", { fields: [{ field: "limit", rule: "max" }] })
  const pg = pageOf(rows, sp)
  return ok(pg.items, { nextCursor: pg.nextCursor, summary: summaryOf(m, "30d", adRows(m, new Set(m.iterated ?? []))), counts, totals: totals(rows, period) })
}

// ───────────────────────── writes ─────────────────────────
type Found = { level: "campaign"; o: MC } | { level: "adset"; o: MA } | { level: "ad"; o: MD }
function find(s: CState, level: MetaLevel, id: string): Found | null {
  if (level === "campaign") { const o = s.campaigns.find((x) => x.id === id); return o ? { level, o } : null }
  if (level === "adset") { const o = s.adsets.find((x) => x.id === id); return o ? { level, o } : null }
  const o = s.ads.find((x) => x.id === id)
  return o ? { level, o } : null
}
const liveOf = (f: Found) => (f.level === "adset" && f.o.live ? f.o.live : { status: f.o.status, budget: f.level === "ad" ? null : (f.o as MC | MA).budget })
function log(req: Request, s: CState, f: Found, field: MetaChangeRow["field"], from: string | null, to: string, result: "APPLIED" | "FAILED", errorCode: string | null, also: MetaObjectRef[] = []) {
  void req
  const row = {
    id: `chg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, level: f.level, objectId: f.o.id, objectName: f.o.name, field, from, to,
    alsoChanged: also.map((p) => p.id), result, errorCode, source: "CAMPAIGNS" as const, by: GUSTA, at: iso(Date.now()),
  }
  s.changes.unshift(row)
  if (result === "APPLIED") s.writes.push(Date.now())
  persist()
  return row
}
function preWrite(req: Request, s: CState, f: Found | null): Response | null {
  if (!writer(req)) return fail("FORBIDDEN", 403, "Only owners and admins can change Meta.")
  const recent = s.writes.filter((t) => Date.now() - t < 60_000)
  s.writes = recent
  if (recent.length >= WRITES_PER_MIN) return fail("RATE_LIMITED", 429, "Too many changes in a minute.", { retryAfterSec: Math.max(1, Math.ceil((60_000 - (Date.now() - recent[0])) / 1000)) })
  if (!f) return fail("META_OBJECT_GONE", 404, "This doesn't exist on Meta anymore.")
  if (unusable()) return fail("META_ACCOUNT_UNUSABLE", 422, "Meta disabled ads on this account.")
  if (metaFlag() === "expired") return fail("META_TOKEN_INVALID", 422, "Your Meta login expired. Reconnect to continue.")
  return null
}
function metaTrigger(req: Request, s: CState, f: Found, field: MetaChangeRow["field"], from: string | null, to: string): Response | null {
  if (f.o.name.includes("[mock:meta-rate]")) {
    log(req, s, f, field, from, to, "FAILED", "META_UNAVAILABLE")
    return fail("META_UNAVAILABLE", 503, "Meta asked us to wait.", { reason: "rate_limited", retryAfterSec: 60 })
  }
  if (f.o.name.includes("[mock:meta-token]")) {
    log(req, s, f, field, from, to, "FAILED", "META_TOKEN_INVALID")
    return fail("META_TOKEN_INVALID", 422, "Your Meta login expired. Reconnect to continue.")
  }
  return null
}
function result(req: Request, s: CState, m: MetaState, f: Found, change: ReturnType<typeof log>, also: MetaObjectRef[]): MetaWriteResult {
  const canWrite = writer(req)
  let object: MetaWriteResult["object"]
  if (f.level === "ad") object = adView(s, m, f.o, canWrite)
  else if (f.level === "adset") {
    const ads = s.ads.filter((d) => d.adsetId === f.o.id).map((d) => adView(s, m, d, canWrite))
    object = setView(s, m, f.o, canWrite, ads)
  } else object = campaignView(s, m, f.o, canWrite).row
  return { level: f.level, object, change: { ...change, alsoChangedRefs: also }, alsoActivated: also }
}

async function writeStatus(req: Request, level: MetaLevel, id: string) {
  const g = guard(req)
  if (g instanceof Response) return g
  const m = g
  const s = stateOf(req)
  const b = (await req.json().catch(() => ({}))) as Partial<MetaStatusBody>
  await delay(700)
  if (b.confirm !== true || (b.status !== "ACTIVE" && b.status !== "PAUSED")) return fail("VALIDATION_ERROR", 400, "confirm: true and status are required.", { fields: [{ field: "confirm", rule: "equals" }] })
  const f = find(s, level, id)
  const pre = preWrite(req, s, f)
  if (pre) return pre
  const found = f!
  const live = liveOf(found)
  if (b.expected !== live.status) return fail("META_OBJECT_CHANGED", 409, "This changed in Ads Manager after our last sync.", { current: { status: live.status, dailyBudgetMinor: live.budget } })
  const trig = metaTrigger(req, s, found, "STATUS", live.status, b.status)
  if (trig) return trig
  const parents: { ref: MetaObjectRef; set: () => void }[] = []
  if (b.status === "ACTIVE") {
    if (found.level === "ad" && found.o.disapproved) {
      log(req, s, found, "STATUS", live.status, b.status, "FAILED", "META_POLICY")
      return fail("META_POLICY", 422, "Rejected by Meta's ad review.")
    }
    const a = found.level === "ad" ? s.adsets.find((x) => x.id === found.o.adsetId)! : found.level === "adset" ? found.o : null
    const c = a ? s.campaigns.find((x) => x.id === a.campaignId)! : null
    if (c && c.status === "PAUSED") parents.push({ ref: { level: "campaign", id: c.id, name: c.name }, set: () => (c.status = "ACTIVE") })
    if (found.level === "ad" && a && a.status === "PAUSED") parents.push({ ref: { level: "adset", id: a.id, name: a.name }, set: () => (a.status = "ACTIVE") })
    if (parents.length && !b.includeParents) return fail("META_PARENT_PAUSED", 409, "A parent is paused.", { parents: parents.map((p) => p.ref) })
  }
  parents.forEach((p) => p.set())
  found.o.status = b.status
  if (found.level === "adset") delete found.o.live
  const also = parents.map((p) => p.ref)
  const change = log(req, s, found, "STATUS", live.status, b.status, "APPLIED", null, also)
  return ok(result(req, s, m, found, change, also))
}

async function writeBudget(req: Request, level: "campaign" | "adset", id: string) {
  const g = guard(req)
  if (g instanceof Response) return g
  const m = g
  const s = stateOf(req)
  const b = (await req.json().catch(() => ({}))) as Partial<MetaBudgetBody>
  await delay(700)
  if (b.confirm !== true || !Number.isInteger(b.dailyBudgetMinor)) return fail("VALIDATION_ERROR", 400, "confirm: true and an integer dailyBudgetMinor are required.", { fields: [{ field: "dailyBudgetMinor", rule: "isInt" }] })
  const f = find(s, level, id)
  const pre = preWrite(req, s, f)
  if (pre) return pre
  const found = f as Extract<Found, { level: "campaign" | "adset" }>
  const cur = accountOf(m.adAccountId)?.currency ?? "USD"
  const live = liveOf(found)
  if (b.expectedDailyBudgetMinor !== live.budget) return fail("META_OBJECT_CHANGED", 409, "This changed in Ads Manager after our last sync.", { current: { status: live.status, dailyBudgetMinor: live.budget } })
  const camp = found.level === "campaign" ? found.o : s.campaigns.find((x) => x.id === found.o.campaignId)!
  if (found.level === "campaign" ? !camp.cbo || camp.kind !== "daily" : camp.cbo)
    return fail("META_BUDGET_NOT_EDITABLE", 422, "This budget can't be edited here.", { budgetLevel: camp.cbo ? "campaign" : "adset", kind: camp.cbo ? camp.kind : null })
  const now = live.budget ?? 0
  const to = b.dailyBudgetMinor!
  const trig = metaTrigger(req, s, found, "DAILY_BUDGET", String(now), String(to))
  if (trig) return trig
  if (to > now * STEP) return fail("META_BUDGET_STEP_TOO_LARGE", 422, "Too large a step.", { maxMinor: now * STEP, currency: cur })
  if (to < MIN_MINOR) {
    log(req, s, found, "DAILY_BUDGET", String(now), String(to), "FAILED", "META_BUDGET_TOO_LOW")
    return fail("META_BUDGET_TOO_LOW", 422, "Daily budget is below the account minimum.", { minimumMinor: MIN_MINOR, currency: cur })
  }
  found.o.budget = to
  if (found.level === "adset") delete found.o.live
  const change = log(req, s, found, "DAILY_BUDGET", String(now), String(to), "APPLIED", null)
  return ok(result(req, s, m, found, change, []))
}

const LEVEL: Record<string, MetaLevel> = { campaigns: "campaign", adsets: "adset", ads: "ad" }

export const campaignHandlers = [
  http.get(u("/meta/campaigns"), async ({ request }) => {
    const g = guard(request)
    if (g instanceof Response) return g
    await delay(300)
    const { rows, meta } = campaignList(request, g)
    return ok(rows, meta)
  }),
  http.get(u("/meta/campaigns/:id"), async ({ request, params }) => {
    const g = guard(request)
    if (g instanceof Response) return g
    const s = stateOf(request)
    const c = s.campaigns.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Campaign not in the snapshot.")
    const sp = new URL(request.url).searchParams
    const period: MetaPeriod = sp.get("period") === "7d" ? "7d" : "30d"
    await delay(450)
    const { row, sets } = campaignView(s, g, c, writer(request))
    const by = sorter("spend", "desc", period)
    return ok({ campaign: row, adsets: sets.sort(by).map((a) => ({ ...a, ads: a.ads.sort(by) })) })
  }),
  http.post(u("/meta/:lvl/:id/status"), ({ request, params }) => {
    const level = LEVEL[String(params.lvl)]
    return level ? writeStatus(request, level, String(params.id)) : fail("NOT_FOUND", 404, "Unknown level.")
  }),
  http.patch(u("/meta/:lvl/:id/budget"), ({ request, params }) => {
    const level = LEVEL[String(params.lvl)]
    return level === "campaign" || level === "adset" ? writeBudget(request, level, String(params.id)) : fail("NOT_FOUND", 404, "Unknown level.")
  }),
  http.get(u("/meta/changes"), async ({ request }) => {
    const s = stateOf(request)
    const sp = new URL(request.url).searchParams
    const objectId = sp.get("objectId")
    const level = sp.get("level")
    const list = s.changes.filter((c) => (!objectId || c.objectId === objectId) && (!level || c.level === level))
    const start = Number(sp.get("cursor") ?? 0) || 0
    const limit = Math.max(1, Math.min(50, Number(sp.get("limit")) || 20))
    const nameOf = (id: string): MetaObjectRef => {
      const c = s.campaigns.find((x) => x.id === id)
      if (c) return { level: "campaign", id, name: c.name }
      const a = s.adsets.find((x) => x.id === id)
      return a ? { level: "adset", id, name: a.name } : { level: "campaign", id, name: id }
    }
    await delay(300)
    const page = list.slice(start, start + limit).map((c) => ({ ...c, alsoChangedRefs: c.alsoChanged.map(nameOf) }))
    return ok(page, { nextCursor: start + limit < list.length ? String(start + limit) : null })
  }),
]
