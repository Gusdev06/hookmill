/**
 * MSW model of meta-v1 §3.3 (Send → "Publish to Meta"): one META_PUBLISH job per publication, time-based like the rest
 * of the mock (t0 + a duration per stage; a reload resumes). The §8 triggers in `primaryText` / `headline` decide the
 * failing stage and the error code; `POST …/retry` resumes from the failed stage keeping the ids already created.
 */
import type { MetaAction, MetaAsyncErrorCode, MetaObjective, MetaPublication, MetaPublishBody, MetaPublishDefaults, MetaPublishSettings, UserRef } from "@/lib/api/types"
import type { MCreative } from "./db"
import { db, mockAdName, offerOf, save } from "./db"
import type { MetaState } from "./v2"
import { accountOf, PAGES, PIXELS } from "./v2"

export const STAGES = ["uploading_video", "processing_video", "creating_campaign", "creating_adset", "creating_creative", "creating_ad"] as const
type Stage = (typeof STAGES)[number]
/** mock: US$ 5.00 minimum (§8) */
export const MIN_BUDGET_MINOR = 500

export interface MPublication {
  id: string; creativeId: string; adAccountId: string
  settings: MetaPublishSettings
  /** start of the current run (ms) and the duration of each stage from `from` */
  t0: number; from: number; stageMs: number[]
  /** stage index that fails on this run (null = none); null again after a retry */
  failAt: number | null; failCode: MetaAsyncErrorCode | null; failAction: MetaAction | null; failReason: string | null
  /** ids created by earlier runs (kept on retry) */
  ids: MetaPublication["ids"]
  /** set once the job finished: PAUSED | ACTIVE | DELETED (null while the clock decides) */
  final: "PAUSED" | "ACTIVE" | "DELETED" | null
  publishedAt: string | null; activatedAt: string | null
  createdBy: UserRef; createdAt: string
}

const iso = (t: number) => new Date(t).toISOString()
const MARKETS: Record<string, string> = { "united states": "US", usa: "US", brazil: "BR", brasil: "BR", canada: "CA", portugal: "PT", "united kingdom": "GB", uk: "GB", mexico: "MX", méxico: "MX", spain: "ES", españa: "ES", germany: "DE", france: "FR", australia: "AU" }
const OBJECTIVE_OF: Record<string, MetaObjective> = { ONLINE_STORE: "OUTCOME_SALES", LOCAL_BUSINESS: "OUTCOME_LEADS", APP: "OUTCOME_APP_PROMOTION" }

export function listOf(creativeId: string): MPublication[] {
  db.v2.publications ??= {}
  return (db.v2.publications[creativeId] ??= [])
}
export const allPublications = () => Object.values((db.v2.publications ??= {})).flat()

/** §2 MetaPublishDefaults from the connection, the workspace and the offer of the creative. */
export function defaultsOf(m: MetaState, c: MCreative, ws: { businessType: unknown; market: string | null }): MetaPublishDefaults {
  const a = accountOf(m.adAccountId)
  const page = PAGES.find((p) => p.id === m.pageId) ?? null
  const px = PIXELS.find((p) => p.id === m.pixelId) ?? null
  const byType = OBJECTIVE_OF[String(ws.businessType)] ?? "OUTCOME_SALES"
  const o = offerOf(c)
  const market = (ws.market ?? "").trim().toLowerCase()
  return {
    objective: px ? byType : "OUTCOME_TRAFFIC",
    objectiveReason: px ? "business_type" : "no_pixel",
    countries: MARKETS[market] ? [MARKETS[market]] : [],
    ageMin: 18, ageMax: 65,
    dailyBudgetMinor: MIN_BUDGET_MINOR, currency: a?.currency ?? null,
    page, pixel: px ? { id: px.id, name: px.name } : null,
    name: mockAdName(c) ?? c.name,
    primaryText: [o.promise, o.what].filter(Boolean).join(" ") || c.name,
    headline: o.name.slice(0, 40), description: o.promise ? String(o.promise).slice(0, 125) : null,
    callToAction: byType === "OUTCOME_LEADS" ? "SIGN_UP" : byType === "OUTCOME_APP_PROMOTION" ? "DOWNLOAD" : "SHOP_NOW",
    link: o.sourceUrl ?? null,
  }
}

/** §8 triggers → failing stage + code + action. */
function triggerOf(b: MetaPublishBody): Pick<MPublication, "failAt" | "failCode" | "failAction" | "failReason"> {
  const txt = b.primaryText
  const none = { failAt: null, failCode: null, failAction: null, failReason: null }
  if (txt.includes("[mock:meta-policy]")) return { failAt: 4, failCode: "META_POLICY", failAction: "edit_ad_text", failReason: "Your ad may not comply with our Advertising Policies: the text promises results we can't verify." }
  if (txt.includes("[mock:meta-payment]")) return { failAt: 2, failCode: "META_PAYMENT_REQUIRED", failAction: "fix_payment", failReason: "The ad account has an unsettled balance." }
  if (txt.includes("[mock:meta-token]")) return { failAt: 2, failCode: "META_TOKEN_INVALID", failAction: "reconnect_meta", failReason: "Error validating access token: the session has expired." }
  if (txt.includes("[mock:meta-rate]")) return { failAt: 2, failCode: "META_RATE_LIMITED", failAction: "retry", failReason: "User request limit reached." }
  if (txt.includes("[mock:meta-error]")) return { failAt: 2, failCode: "META_ERROR", failAction: "retry", failReason: "An unknown error occurred (code 1)." }
  return none
}

export function newPublication(c: MCreative, m: MetaState, b: MetaPublishBody, d: MetaPublishDefaults, by: UserRef): MPublication {
  const slow = (b.headline ?? "").includes("[mock:meta-slow]")
  const now = Date.now()
  const settings: MetaPublishSettings = {
    dailyBudgetMinor: b.dailyBudgetMinor, countries: b.countries, objective: b.objective ?? d.objective, objectiveReason: d.objectiveReason,
    primaryText: b.primaryText, headline: b.headline ?? null, description: b.description ?? null, callToAction: b.callToAction, link: b.link,
    specialAdCategories: b.specialAdCategories ?? [], ageMin: b.ageMin ?? 18, ageMax: b.ageMax ?? 65,
  }
  const p: MPublication = {
    id: `pub_${now.toString(36)}`, creativeId: c.id, adAccountId: m.adAccountId!,
    settings, t0: now, from: 0, stageMs: [2500, slow ? 30_000 : 3000, 2000, 2500, 2500, 2000],
    ...triggerOf(b),
    ids: { videoId: null, creativeId: null, campaignId: null, adsetId: null, adId: null },
    final: null, publishedAt: null, activatedAt: null, createdBy: by, createdAt: iso(now),
  }
  listOf(c.id).unshift(p)
  save()
  return p
}

/** how many stages of the current run are done at `now`, and the stage running */
function clock(p: MPublication, now: number) {
  let t = p.t0
  let done = p.from
  for (let i = p.from; i < STAGES.length; i++) {
    t += p.stageMs[i]
    if (now < t) return { done, eta: Math.ceil((t - now) / 1000), running: i }
    done = i + 1
    if (p.failAt === i) return { done: i, eta: 0, running: null as number | null, failed: true }
  }
  return { done, eta: 0, running: null as number | null }
}

const ID_OF: Partial<Record<Stage, keyof MetaPublication["ids"]>> = { uploading_video: "videoId", creating_campaign: "campaignId", creating_adset: "adsetId", creating_creative: "creativeId", creating_ad: "adId" }

/** Derives the MetaPublication (status, job, ids) from the clock; stamps the finished state once. */
export function publicationView(p: MPublication, now = Date.now()): MetaPublication {
  const k = clock(p, now)
  // ids of the finished stages are "created" (kept on retry)
  for (let i = 0; i < k.done; i++) {
    const key = ID_OF[STAGES[i]]
    if (key && !p.ids[key]) p.ids[key] = `mock_${key.replace("Id", "")}_${p.id.slice(4)}`
  }
  const failed = !!k.failed
  const finished = !failed && k.done >= STAGES.length
  if (finished && !p.final) {
    p.final = "PAUSED"
    p.publishedAt = iso(now)
    save()
  }
  const status: MetaPublication["status"] = failed ? "FAILED" : p.final ?? "PUBLISHING"
  const checklist = STAGES.map((key, i) => ({ key, done: i < k.done }))
  const stage = failed ? STAGES[k.done] : k.running !== null ? STAGES[k.running] : null
  const job: MetaPublication["job"] = {
    id: `job_pub_${p.id.slice(4)}`, type: "META_PUBLISH",
    status: failed ? "FAILED" : finished || p.final ? "SUCCEEDED" : "RUNNING",
    stage, progress: Math.round((k.done / STAGES.length) * 100), etaSec: status === "PUBLISHING" ? k.eta + STAGES.slice((k.running ?? STAGES.length) + 1).reduce((a, _s, i) => a + p.stageMs[(k.running ?? 0) + 1 + i] / 1000, 0) : null,
    checklist, errorCode: failed ? p.failCode : null, failReason: failed ? p.failReason : null, action: failed ? p.failAction : null, output: null,
  }
  const published = status === "PAUSED" || status === "ACTIVE" || status === "DELETED"
  return {
    id: p.id, status, creativeId: p.creativeId, adAccountId: p.adAccountId,
    ids: { ...p.ids }, settings: p.settings,
    adsManagerUrl: published || p.ids.campaignId ? "#" : null, previewUrl: published ? "#" : null,
    job, errorCode: failed ? p.failCode : null, failReason: failed ? p.failReason : null, action: failed ? p.failAction : null,
    metrics: status === "ACTIVE" && p.activatedAt && now - Date.parse(p.activatedAt) > 20_000 ? { spend: 12.4, impressions: 3100, clicks: 58, ctr: 1.87, results: 1, resultType: "purchase", cpa: 12.4, roas: 2.1, plays2s: 1210, hookRate: 39, thruplays: 380, frequency: 1.1 } : null,
    publishedAt: p.publishedAt, activatedAt: p.activatedAt, createdBy: p.createdBy, createdAt: p.createdAt,
  }
}

/** POST …/retry: resumes from the failed stage; the trigger is spent so the retry succeeds (ids are kept). */
export function retryPublication(p: MPublication) {
  const k = clock(p, Date.now())
  if (!k.failed) return false
  p.from = k.done
  p.t0 = Date.now()
  p.failAt = null
  save()
  return true
}
