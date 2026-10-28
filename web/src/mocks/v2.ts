/**
 * Mock state of onboarding-v2 + meta-v1 (docs/contratos/onboarding-v2.md, meta-v1.md). Lives in db.v2 (localStorage with
 * the rest; `?mock=reset` reseeds). Pure helpers here, HTTP in handlers-meta.ts and handlers.ts.
 *
 * Workspaces: ws_1 ("Workspace", the live one) keeps using db.workspace; the others (Mooncloth, Northpeak, the ws_new_*
 * of a fresh signup) get a WsState here, so the setup gate, the "Setup in progress" screen and the resume screen can be
 * exercised. Account mode: the mock user is AGENCY (backfill D2); a fresh signup (ws_new_*) starts with null → /start.
 * Meta: one connection per workspace. POST /meta/connect points to /dev/meta-login (the fake Facebook dialog), which
 * comes back with ?meta=connected|error. Dev toggles (sessionStorage mock:meta): `?metamock=stale|failed|expired|off`.
 */
import type {
  AccountMode, ClientStatus, MetaAdRow, MetaAdVerdict, MetaConnection, MetaHealth, MetaHealthCheck, MetaMetrics, MetaOAuthErrorCode, MetaOptions, MetaSummary, MetaSyncState,
  Offer, OnboardingStep, OnboardingStepInfo, UserRef, Workspace,
} from "@/lib/api/types"

export interface WsState {
  id: string; name: string; shortCode: string; status: ClientStatus
  onboarding: { step: OnboardingStep; totalSteps: 6; completedAt: string | null }
  resultType: Workspace["resultType"]; resultTypeOther: string | null
  businessType: Workspace["businessType"]; defaultResult: Workspace["defaultResult"]; industry: string | null; market: string | null; websiteUrl: string | null
  monthlySpendCapUsd: number | null; uiLocale: "EN" | "PT_BR"
  updatedBy: UserRef | null; updatedAt: string | null
}
export interface MetaState {
  status: "ACTIVE" | "TOKEN_INVALID" | "DISCONNECTED"
  /** POST /meta/connect was called: the next GET /meta/connection after the fake dialog promotes it to ACTIVE */
  pending: boolean
  /** "Connect from another browser" attempt (returnTo /meta/done): GET /meta/oauth/status reads it; result comes via localStorage */
  oauth?: { remote: boolean; expiresAt: string; lastError: { code: MetaOAuthErrorCode; missing: string[]; at: string } | null; connectedAt: string | null }
  user: { id: string; name: string }
  adAccountId: string | null; pageId: string | null; pixelId: string | null
  connectedAt: string; selectedAt: string | null
  /** sync clock: first sync runs from t0 to t1 (ms) */
  syncT0: number | null; syncT1: number | null; lastSyncAt: string | null
  disconnectedAt: string | null
  /** ads already imported as champions (Pick from Meta) */
  iterated?: string[]
}
export interface V2State {
  accountMode: AccountMode | null
  newAccountMode: AccountMode | null
  ws: Record<string, WsState>
  tour: Record<string, string | null>
  meta: Record<string, MetaState>
  /** meta-v1 §3.3: publications per creative, newest first (optional: states saved before 21/10 don't have it) */
  publications?: Record<string, MPublication[]>
}

import type { MPublication } from "./publish"

const TORDAN: UserRef = { id: "u_tordan", name: "Tordan", initials: "T" }
const iso = (t: number) => new Date(t).toISOString()

export function seedV2(): V2State {
  const now = Date.now()
  return {
    accountMode: "AGENCY",
    newAccountMode: null,
    ws: {
      ws_mooncloth: ws("ws_mooncloth", "Mooncloth", "MC", 3, { resultType: "PURCHASE", businessType: "ONLINE_STORE", defaultResult: "PURCHASES", industry: "Sleep products", market: "United States", websiteUrl: "https://mooncloth.com", updatedBy: TORDAN, updatedAt: iso(now - 40 * 60_000) }),
      ws_northpeak: ws("ws_northpeak", "Northpeak Dental", "NP", 2, { resultType: "APPOINTMENT", businessType: "LOCAL_BUSINESS", defaultResult: "APPOINTMENTS", industry: "Dental clinic", market: "Canada", updatedBy: TORDAN, updatedAt: iso(now - 3 * 3_600_000) }),
    },
    // backfill D4: everyone who already uses the app has the tour done in ws_1; the other workspaces have it pending
    tour: { ws_1: "2026-10-05T12:00:00.000Z" },
    meta: {},
    publications: {},
  }
}
function ws(id: string, name: string, shortCode: string, step: OnboardingStep, extra: Partial<WsState> = {}): WsState {
  return {
    id, name, shortCode, status: "SETUP", onboarding: { step, totalSteps: 6, completedAt: null },
    resultType: null, resultTypeOther: null, businessType: null, defaultResult: null, industry: null, market: null, websiteUrl: null, monthlySpendCapUsd: null, uiLocale: "EN",
    updatedBy: null, updatedAt: null, ...extra,
  }
}
/** A fresh signup's workspace (ws_new_*), created on first access: SETUP, step 1. */
export function newWs(id: string, name: string): WsState {
  return ws(id, name, name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "WS", 1)
}

// ───────────── onboarding steps (contract §2) ─────────────
const KEYS: OnboardingStepInfo["key"][] = ["business", "meta", "offer", "audience", "goals", "brain"]
const DEFAULT_NAMES = new Set(["Workspace", "New client", ""])
export function onboardingSteps(w: { name: string; resultType: unknown; monthlySpendCapUsd: number | null; onboarding: { step: number; completedAt: string | null } }, offers: Offer[], meta: MetaState | null, metaOff: boolean): OnboardingStepInfo[] {
  const active = offers
  const done: Record<OnboardingStepInfo["key"], boolean> = {
    business: w.resultType != null && !DEFAULT_NAMES.has(w.name),
    meta: !!meta && meta.status === "ACTIVE" && !!meta.adAccountId && !!meta.pageId,
    offer: active.some((o) => !!o.what && !!o.promise),
    audience: active.some((o) => !!o.audience),
    goals: w.monthlySpendCapUsd != null,
    brain: !!w.onboarding.completedAt,
  }
  const cur = w.onboarding.completedAt ? 0 : w.onboarding.step
  return KEYS.map((key, i) => {
    const step = (i + 1) as OnboardingStep
    const enabled = key !== "meta" || !metaOff
    const state: OnboardingStepInfo["state"] = done[key] ? "done" : step === cur ? "current" : key === "meta" && cur > 2 ? "skipped" : "todo"
    return { step, key, state, enabled }
  })
}
export function onboardingPercent(steps: OnboardingStepInfo[], completedAt: string | null) {
  if (completedAt) return 100
  const enabled = steps.filter((s) => s.enabled)
  return Math.round((enabled.filter((s) => s.state === "done").length / enabled.length) * 100)
}

// ───────────── Meta: options, health, ads ─────────────
export const META_USER = { id: "fb_1029", name: "Tordan Oliveira" }
export const ACCOUNTS: MetaOptions["adAccounts"] = [
  { id: "act_229184301", name: "Mooncloth US", currency: "USD", accountStatus: 1, business: { id: "b_1", name: "Mooncloth" }, canManage: true, permissionReason: null },
  { id: "act_229184388", name: "Mooncloth EU", currency: "EUR", accountStatus: 1, business: { id: "b_1", name: "Mooncloth" }, canManage: true, permissionReason: null },
  { id: "act_118820011", name: "Old store (2023)", currency: "USD", accountStatus: 1, business: null, canManage: false, permissionReason: "no_advertise_task" },
]
export const PAGES: MetaOptions["pages"] = [
  { id: "pg_1", name: "Mooncloth (12.4k followers)" },
  { id: "pg_2", name: "Mooncloth Sleep (820 followers)" },
]
export const PIXELS: MetaOptions["pixels"] = [
  { id: "px_1", name: "Mooncloth pixel", adAccountId: "act_229184301", lastFiredAt: iso(Date.now() - 2 * 60_000) },
  { id: "px_2", name: "EU pixel", adAccountId: "act_229184388", lastFiredAt: iso(Date.now() - 9 * 864e5) },
]
export const accountOf = (id: string | null) => ACCOUNTS.find((a) => a.id === id) ?? null

export function newMeta(): MetaState {
  return { status: "ACTIVE", pending: false, user: META_USER, adAccountId: null, pageId: null, pixelId: null, connectedAt: iso(Date.now()), selectedAt: null, syncT0: null, syncT1: null, lastSyncAt: null, disconnectedAt: null }
}
export const metaFlag = () => (typeof window === "undefined" ? null : sessionStorage.getItem("mock:meta"))

function check(key: MetaHealthCheck["key"], level: MetaHealthCheck["level"], detail: string | null = null): MetaHealthCheck {
  return { key, level, detail }
}
/** Health by account: US all good · EU pixel warning (no purchase in 7 days) · the old store has no permission (blocked). */
export function healthOf(m: MetaState, adsCount: number, activeCount: number): MetaHealth {
  const a = accountOf(m.adAccountId)
  const flag = metaFlag()
  const checks: MetaHealthCheck[] = []
  checks.push(check("token", flag === "expired" ? "bad" : "ok", flag === "expired" ? "Your Meta login expired" : null))
  // ?metamock=perm: a permission missing on the ad account (live finding 25/10, account 7518)
  checks.push(flag === "perm" ? check("scopes", "bad", "Missing permission: ads_read") : check("scopes", "ok"))
  if (flag === "unusable") checks.push(check("account", "bad", "Account disabled, choose another"))
  else if (a && !a.canManage) checks.push(check("account", "bad", "Your profile has view access only. Ask the account owner to give you Advertiser (or higher) in Meta Business settings → Ad accounts → People. Then press Check again."))
  else checks.push(check("account", "ok", "No restrictions, spending allowed"))
  checks.push(check("funding", a && !a.canManage ? "bad" : "ok", a && !a.canManage ? null : "Visa ending 4412"))
  checks.push(check("page", "ok"))
  const px = PIXELS.find((p) => p.id === m.pixelId)
  if (!px) checks.push(check("pixel", "warn", "No pixel: ads will optimize for clicks"))
  else if (px.lastFiredAt && Date.now() - Date.parse(px.lastFiredAt) > 7 * 864e5) checks.push(check("pixel", "warn", "Pixel hasn't fired in 7 days: results on Home may be empty"))
  else checks.push(check("pixel", "ok", "Last purchase event 2 min ago"))
  checks.push(check("budget", "ok"))
  checks.push(check("verified", a?.business ? "ok" : "warn", a?.business ? null : "Business not verified: Meta may limit spend"))
  const bad = checks.some((c) => c.level === "bad")
  const canPublish = !checks.some((c) => c.level === "bad" && c.key !== "pixel" && c.key !== "verified")
  return { level: bad ? "bad" : checks.some((c) => c.level === "warn") ? "warn" : "ok", canPublish, checks, adsCount, activeCount, checkedAt: iso(Date.now()) }
}

/** Example ads (the mockup's three + three more). Numbers are placeholders, never real performance. */
export interface AdSeed { id: string; name: string; days: number; spend: number; results: number; roas: number; spend7: number; results7: number; prev7: number; prevSpend7: number; active: boolean; thumb: string; imp: number }
export const ADS: AdSeed[] = [
  { id: "ad_1", name: "I tried 11 sleep masks", days: 41, spend: 4120, results: 212, roas: 3.4, spend7: 980, results7: 52, prev7: 46, prevSpend7: 1010, active: true, thumb: "/mock/art-0-1.svg", imp: 410_000 },
  { id: "ad_2", name: "Founder story v2", days: 18, spend: 2860, results: 105, roas: 2.8, spend7: 1100, results7: 40, prev7: 42, prevSpend7: 1120, active: true, thumb: "/mock/art-1-3.svg", imp: 260_000 },
  { id: "ad_3", name: "60 nights to try it", days: 63, spend: 1900, results: 49, roas: 1.9, spend7: 420, results7: 9, prev7: 17, prevSpend7: 430, active: true, thumb: "/mock/art-2-2.svg", imp: 190_000 },
  { id: "ad_4", name: "Flashlight test", days: 12, spend: 760, results: 31, roas: 2.6, spend7: 500, results7: 21, prev7: 10, prevSpend7: 260, active: true, thumb: "/mock/art-3-2.svg", imp: 80_000 },
  { id: "ad_5", name: "Partner reads till 1am", days: 88, spend: 640, results: 26, roas: 2.1, spend7: 60, results7: 2, prev7: 3, prevSpend7: 90, active: false, thumb: "/mock/art-2-0.svg", imp: 70_000 },
  { id: "ad_6", name: "Unboxing · weighted mask", days: 5, spend: 110, results: 2, roas: 1.1, spend7: 110, results7: 2, prev7: 0, prevSpend7: 0, active: true, thumb: "/mock/art-0-0.svg", imp: 12_000 },
]
const MIN_SPEND = 50
const MIN_RESULTS = 3
export function metrics(spend: number, results: number, roas: number | null, imp: number, freq: number | null): MetaMetrics {
  const clicks = Math.round(imp * 0.014)
  return { spend, impressions: imp, clicks, ctr: +((clicks / Math.max(1, imp)) * 100).toFixed(2), results, resultType: "omni_purchase", cpa: results ? +(spend / results).toFixed(2) : null, roas, plays2s: Math.round(imp * 0.31), hookRate: 31, thruplays: Math.round(imp * 0.12), frequency: freq }
}
export function adRows(m: MetaState, iterated: Set<string>): MetaAdRow[] {
  const eligible = ADS.filter((a) => a.spend >= MIN_SPEND && a.results >= MIN_RESULTS)
  const cpas = eligible.map((a) => a.spend / a.results).sort((x, y) => x - y)
  const median = cpas.length ? cpas[Math.floor((cpas.length - 1) / 2)] : null
  const rows = ADS.map((a): MetaAdRow => {
    const cpa = a.spend / a.results
    const verdict: MetaAdVerdict = a.spend >= MIN_SPEND && a.results >= MIN_RESULTS ? (median === null || cpa <= median ? "WINNER" : "OK") : "LOW_DATA"
    const cpa7 = a.results7 ? a.spend7 / a.results7 : null
    const cpaPrev = a.prev7 ? a.prevSpend7 / a.prev7 : null
    const trend: MetaAdRow["trend"] = a.spend7 < MIN_SPEND / 4 || a.results7 < 3 || a.prev7 < 3 || cpa7 === null || cpaPrev === null ? null : cpa7 <= 0.85 * cpaPrev ? "WORKING" : cpa7 >= 1.25 * cpaPrev ? "TIRING" : "STEADY"
    return {
      metaAdId: a.id, name: a.name, effectiveStatus: a.active ? "ACTIVE" : "PAUSED",
      campaign: { id: "c_1", name: "MC_TEST" }, adset: { id: "as_1", name: "Broad US" },
      thumbnailUrl: a.thumb, videoId: `v_${a.id}`,
      metrics: metrics(a.spend, a.results, a.roas, a.imp, null),
      metrics7d: metrics(a.spend7, a.results7, a.roas, Math.round(a.imp / 4), 2.1),
      metricsPrev7d: metrics(a.prevSpend7, a.prev7, a.roas, Math.round(a.imp / 4), 1.8),
      verdict, trend, daysRunning: a.days, creative: null, championId: iterated.has(a.id) ? `ch_${a.id}` : null,
      adCreatedTime: iso(Date.now() - a.days * 864e5), syncedAt: m.lastSyncAt ?? iso(Date.now()),
    }
  })
  // default order: WINNER first, then spend desc
  const rank: Record<MetaAdVerdict, number> = { WINNER: 0, OK: 1, LOW_DATA: 2 }
  return rows.sort((x, y) => rank[x.verdict] - rank[y.verdict] || y.metrics.spend - x.metrics.spend)
}

export function syncState(m: MetaState): MetaSyncState {
  const flag = metaFlag()
  const now = Date.now()
  if (!m.adAccountId) return { state: "never", syncedAt: null, progress: null, job: null }
  if (m.syncT0 !== null && m.syncT1 !== null && now < m.syncT1) {
    const total = ADS.length * 36
    const done = Math.min(total, Math.round(((now - m.syncT0) / (m.syncT1 - m.syncT0)) * total))
    return { state: m.lastSyncAt ? "syncing" : "first_sync", syncedAt: m.lastSyncAt, progress: { done, total, unit: "ads" }, job: null }
  }
  if (flag === "failed") return { state: "failed", syncedAt: m.lastSyncAt, progress: null, job: null }
  if (flag === "stale" || flag === "expired") return { state: "stale", syncedAt: iso(now - 2 * 864e5), progress: null, job: null }
  return { state: "ok", syncedAt: m.lastSyncAt ?? iso(now - 4 * 60_000), progress: null, job: null }
}

export function summaryOf(m: MetaState, period: "7d" | "30d", rows: MetaAdRow[]): MetaSummary {
  const a = accountOf(m.adAccountId)
  const pick = (r: MetaAdRow) => (period === "7d" ? r.metrics7d : r.metrics)
  const spend = rows.reduce((n, r) => n + pick(r).spend, 0)
  const results = rows.reduce((n, r) => n + pick(r).results, 0)
  const prevSpend = period === "7d" ? rows.reduce((n, r) => n + r.metricsPrev7d.spend, 0) : spend * 1.08
  const prevResults = period === "7d" ? rows.reduce((n, r) => n + r.metricsPrev7d.results, 0) : results * 0.97
  const eligible = rows.filter((r) => r.verdict !== "LOW_DATA")
  const cpas = eligible.map((r) => r.metrics.cpa ?? 0).sort((x, y) => x - y)
  const cpa = results ? +(spend / results).toFixed(2) : null
  return {
    period, currency: a?.currency ?? "USD", spend: +spend.toFixed(2), results, resultType: "omni_purchase",
    cpa, roas: period === "7d" ? 3.1 : 2.9, ctr: 1.4, hookRate: 31,
    prev: { spend: +prevSpend.toFixed(2), cpa: prevResults ? +(prevSpend / prevResults).toFixed(2) : null, roas: period === "7d" ? 2.8 : 2.6 },
    medianCpa: cpas.length ? cpas[Math.floor((cpas.length - 1) / 2)] : null,
    adsCount: rows.length, activeAds: rows.filter((r) => r.effectiveStatus === "ACTIVE").length, newThisWeek: rows.filter((r) => (r.daysRunning ?? 99) <= 7).length,
    eligibleCount: eligible.length, winnersCount: rows.filter((r) => r.verdict === "WINNER").length, tiringCount: rows.filter((r) => r.trend === "TIRING" && r.effectiveStatus === "ACTIVE").length,
    rule: { minSpendUsd: MIN_SPEND, minResults: MIN_RESULTS }, sync: syncState(m),
  }
}

export function connectionView(m: MetaState, rows: MetaAdRow[]): MetaConnection {
  const a = accountOf(m.adAccountId)
  const flag = metaFlag()
  const sync = syncState(m)
  return {
    status: flag === "expired" ? "TOKEN_INVALID" : m.status,
    user: m.user, scopes: ["ads_management", "ads_read", "business_management", "pages_show_list"],
    tokenExpiresAt: iso(Date.now() + 55 * 864e5),
    adAccount: a ? { id: a.id, name: a.name, currency: a.currency, timezoneName: "America/Los_Angeles", accountStatus: a.accountStatus } : null,
    page: PAGES.find((p) => p.id === m.pageId) ?? null,
    pixel: (() => {
      const p = PIXELS.find((x) => x.id === m.pixelId)
      return p ? { id: p.id, name: p.name } : null
    })(),
    health: m.adAccountId && m.pageId ? healthOf(m, rows.length, rows.filter((r) => r.effectiveStatus === "ACTIVE").length) : null,
    lastSyncAt: sync.syncedAt, syncing: sync.state === "first_sync" || sync.state === "syncing",
    connectedBy: TORDAN, connectedAt: m.connectedAt,
  }
}
