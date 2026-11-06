/**
 * MSW handlers of meta-templates-v1 §2: templates CRUD per (workspace, ad account), import (doesn't save), publish with
 * `{ templateId }` and POST /meta/publish-batch. Registered BEFORE metaHandlers: the two routes they share
 * (POST …/publish, GET /creatives/:id/meta) fall through when the request isn't about templates.
 * Mock triggers: a template whose name has "[mock:no-pixel]" → 422 META_PIXEL_REQUIRED on publish; "[mock:schedule-expired]"
 * → 400 `adset.schedule.end` / `inPast` with `templateId` on publish (meta-templates-v2 §9).
 * v2 §4/§9: GET /meta/instagram-accounts, /meta/custom-audiences, /meta/locales with the same fixtures as the API mock
 * (the first ad account plays `act_mock_1`, the others `act_mock_2`). Import by id: an id with "life" comes back CBO +
 * LIFETIME, one with "awareness" as Awareness/REACH with the Instagram account; the rest carry audiences + a schedule.
 * F4 (`?metamock=expired`): the 3 live lists answer 422 META_TOKEN_INVALID; GET /meta/templates still answers 200 from the
 * database (the API fix of QA 03/11). `?mocktpl=list422` makes that list answer 422 too, like the API before the fix
 * (sessionStorage mock:tpl; `?mocktpl=off` clears).
 */
import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type {
  MetaCustomAudiencesResponse, MetaInstagramAccountsResponse, MetaLocalesResponse, MetaPublishBatchBody, MetaPublishBody, MetaPublishTemplate, MetaTemplateBody,
  MetaTemplateImportBody, MetaTemplateImportResult, UpdateMetaTemplateBody,
} from "@/lib/api/types"
import { db, save, toDetail, type MCreative } from "./db"
import { mockWorkspaceOf } from "./auth"
import { ME } from "./fixtures"
import { metaOf, metaReadyOf } from "./handlers-meta"
import { listOf, MIN_BUDGET_MINOR, newPublication, publicationView } from "./publish"
import { accountOf, ACCOUNTS, metaFlag } from "./v2"

const u = (p: string) => API_URL + p
const ok = <D,>(data: D, status = 200) => HttpResponse.json({ success: true, data }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })
const wid = (req: Request) => mockWorkspaceOf(req.headers.get("Authorization")).id
const isClient = (req: Request) => mockWorkspaceOf(req.headers.get("Authorization")).role === "CLIENT"
const KEY = "mock:meta:templates"

/** Stored in localStorage (survives reloads like the rest of the mock): `${workspace}:${adAccount}` → templates. */
type Store = Record<string, (MetaPublishTemplate & { archivedAt?: string | null })[]>
const load = (): Store => (typeof window === "undefined" ? {} : (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store))
const persist = (s: Store) => typeof window !== "undefined" && localStorage.setItem(KEY, JSON.stringify(s))

const expiredFail = () => fail("META_TOKEN_INVALID", 422, "Your Meta login expired. Reconnect to continue.")
/** the live lists read Meta with the user's token: an expired login answers 422 (contract v2 §4) */
function liveScope(req: Request) {
  const g = scope(req)
  if (g instanceof Response) return g
  return metaFlag() === "expired" ? expiredFail() : g
}

function scope(req: Request) {
  if (metaFlag() === "off") return fail("META_NOT_CONFIGURED", 503, "Meta isn't set up on this server yet.", { reason: "off" })
  const m = metaOf(req)
  if (!m || m.status !== "ACTIVE") return fail("META_NOT_CONNECTED", 422, "Connect a Meta account first.")
  if (!m.adAccountId || !m.pageId) return fail("META_SELECTION_MISSING", 422, "Choose an ad account and a Page to continue.")
  return { m, key: `${wid(req)}:${m.adAccountId}` }
}

// ───── v2 §9 fixtures (same as the API's FakeMetaService)
const IG_MOCK_1: MetaInstagramAccountsResponse = {
  accounts: [
    { id: "ig_mock_page", username: "mock.page", profilePicUrl: null, source: "PAGE" },
    { id: "ig_mock_1", username: "hookmill.demo", profilePicUrl: null, source: "AD_ACCOUNT" },
  ],
  pageLookup: "ok",
}
const IG_MOCK_2: MetaInstagramAccountsResponse = { accounts: [], pageLookup: "unavailable" }
const AUDIENCES: MetaCustomAudiencesResponse = {
  audiences: [
    { id: "ca_mock_buyers", name: "Purchasers 180d", subtype: "WEBSITE", sizeLower: 12_000, sizeUpper: 15_000, usable: true, unusableReason: null, updatedAt: "2026-11-01T12:00:00.000Z" },
    { id: "ca_mock_lal_1", name: "Lookalike (US, 1%) — Purchasers", subtype: "LOOKALIKE", sizeLower: 1_200_000, sizeUpper: 1_400_000, usable: true, unusableReason: null, updatedAt: "2026-10-28T12:00:00.000Z" },
    { id: "ca_mock_small", name: "Newsletter list (small)", subtype: "CUSTOM", sizeLower: null, sizeUpper: null, usable: false, unusableReason: "Audience too small", updatedAt: "2026-10-20T12:00:00.000Z" },
    { id: "ca_mock_flagged", name: "Imported CRM 2024", subtype: "CUSTOM", sizeLower: 3_000, sizeUpper: 3_500, usable: false, unusableReason: "This audience was flagged and can't be used", updatedAt: "2026-09-02T12:00:00.000Z" },
  ],
  truncated: false,
}
const LOCALES: MetaLocalesResponse = {
  locales: [
    { key: 1001, name: "English (All)" }, { key: 24, name: "English (UK)" }, { key: 6, name: "English (US)" }, { key: 23, name: "French (France)" },
    { key: 5, name: "German" }, { key: 1002, name: "Portuguese (All)" }, { key: 16, name: "Portuguese (Brazil)" }, { key: 1003, name: "Spanish (All)" },
  ],
}
const isFirstAccount = (adAccountId: string | null) => adAccountId === ACCOUNTS[0]?.id
const igOf = (adAccountId: string | null) => (isFirstAccount(adAccountId) ? IG_MOCK_1 : IG_MOCK_2)

const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
/** "now" as a local date-time; the mock treats the account zone as the browser's (good enough for the rules) */
const nowLocal = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const minutes = (a: string, b: string) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60_000
const GOALS: Record<string, string[]> = {
  OUTCOME_AWARENESS: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"],
  OUTCOME_ENGAGEMENT: ["THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS", "POST_ENGAGEMENT"],
}

/** Same checks as the API (templates.ts, v1 + v2 §3): 400 fields, then 422 pixel, then 422 budget (daily or total). */
function check(b: MetaTemplateBody, pixelOk: boolean, currency: string, adAccountId: string | null) {
  const fields: { field: string; rule: string }[] = []
  const c = b.campaign
  const a = b.adset
  const lifetime = c?.budgetType === "LIFETIME"
  const goalObj = !!GOALS[c?.objective]
  if (!b.name?.trim() || b.name.length > 60) fields.push({ field: "name", rule: "length" })
  if (c?.budgetType && !["DAILY", "LIFETIME"].includes(c.budgetType)) fields.push({ field: "campaign.budgetType", rule: "isIn" })
  if (!lifetime && (!Number.isInteger(c?.dailyBudgetMinor) || c.dailyBudgetMinor < 1)) fields.push({ field: "campaign.dailyBudgetMinor", rule: "isInt" })
  if (lifetime && c.dailyBudgetMinor !== 0) fields.push({ field: "campaign.dailyBudgetMinor", rule: "zeroForLifetime" })
  if (lifetime && (!Number.isInteger(c.lifetimeBudgetMinor) || (c.lifetimeBudgetMinor ?? 0) < 1)) fields.push({ field: "campaign.lifetimeBudgetMinor", rule: "isInt" })
  if (!lifetime && c?.lifetimeBudgetMinor != null) fields.push({ field: "campaign.lifetimeBudgetMinor", rule: "notAllowed" })
  if (lifetime && c.budgetMode === "CBO" && c.destination === "REUSE_CAMPAIGN") fields.push({ field: "campaign.destination", rule: "lifetimeCboNeedsNewCampaign" })
  if (a?.optimizationGoal != null && !goalObj) fields.push({ field: "adset.optimizationGoal", rule: "notForObjective" })
  else if (a?.optimizationGoal != null && !GOALS[c.objective].includes(a.optimizationGoal)) fields.push({ field: "adset.optimizationGoal", rule: "isIn" })
  if (goalObj && (a?.pixelId || a?.pixelEvent)) fields.push({ field: "adset.pixelId", rule: "notForObjective" })
  const sch = a?.schedule ?? null
  const now = nowLocal()
  if (sch?.start != null) {
    if (!LOCAL_RE.test(sch.start)) fields.push({ field: "adset.schedule.start", rule: "isLocalDateTime" })
    else if (minutes(sch.start, now) > 5) fields.push({ field: "adset.schedule.start", rule: "inPast" })
  }
  const end = sch?.end ?? null
  if (end?.kind === "AT") {
    const start = sch?.start && LOCAL_RE.test(sch.start) ? sch.start : now
    if (!LOCAL_RE.test(end.at)) fields.push({ field: "adset.schedule.end", rule: "isLocalDateTime" })
    else if (minutes(end.at, now) > 0) fields.push({ field: "adset.schedule.end", rule: "inPast" })
    else if (minutes(start, end.at) < 24 * 60) fields.push({ field: "adset.schedule.end", rule: "minDuration24h" })
  }
  if (end?.kind === "AFTER_DAYS" && !(Number.isInteger(end.days) && end.days >= 1 && end.days <= 365)) fields.push({ field: "adset.schedule.end", rule: "isInt" })
  if (lifetime && !end) fields.push({ field: "adset.schedule.end", rule: "requiredForLifetime" })
  if ((a?.locales?.length ?? 0) > 50) fields.push({ field: "adset.locales", rule: "isLocaleList" })
  if ((a?.customAudiences?.length ?? 0) > 20) fields.push({ field: "adset.customAudiences", rule: "isAudienceList" })
  if ((a?.excludedCustomAudiences?.length ?? 0) > 20) fields.push({ field: "adset.excludedCustomAudiences", rule: "isAudienceList" })
  if (a?.excludedCustomAudiences?.some((x) => a.customAudiences?.some((y) => y.id === x.id))) fields.push({ field: "adset.excludedCustomAudiences", rule: "includedAndExcluded" })
  // notAvailable: an id the account doesn't list anymore (the `*_gone` triggers, §9)
  const audIds = new Set(AUDIENCES.audiences.map((x) => x.id))
  if (a?.customAudiences?.some((x) => !audIds.has(x.id))) fields.push({ field: "adset.customAudiences", rule: "notAvailable" })
  if (a?.excludedCustomAudiences?.some((x) => !audIds.has(x.id))) fields.push({ field: "adset.excludedCustomAudiences", rule: "notAvailable" })
  if (b.ad?.instagramAccount && !igOf(adAccountId).accounts.some((x) => x.id === b.ad.instagramAccount!.id)) fields.push({ field: "ad.instagramAccount", rule: "notAvailable" })
  if (!a?.countries?.length || a.countries.some((x) => !/^[A-Z]{2}$/.test(x))) fields.push({ field: "adset.countries", rule: "isCountryList" })
  if (!/^https?:\/\/\S+\.\S+/.test(b.ad?.link ?? "")) fields.push({ field: "ad.link", rule: "isUrl" })
  if (fields.length) return fail("VALIDATION_ERROR", 400, "Invalid request.", { fields })
  const needs = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION"].includes(c.objective)
  if (!goalObj && !a.pixelId && (needs || a.pixelEvent)) return fail("META_PIXEL_REQUIRED", 422, "This objective needs a pixel.", { objective: c.objective })
  if (!pixelOk && a.pixelId) return fail("META_PIXEL_REQUIRED", 422, "This pixel isn't on the ad account.", { objective: c.objective })
  if (!lifetime && c.dailyBudgetMinor < MIN_BUDGET_MINOR) return fail("META_BUDGET_TOO_LOW", 422, "Daily budget must be at least the account minimum.", { minimumMinor: MIN_BUDGET_MINOR, currency })
  if (lifetime) {
    // total minimum = daily minimum × days, when the days can be told (§2.2)
    let days: number | null = null
    if (end?.kind === "AFTER_DAYS") days = end.days
    else if (end?.kind === "AT") days = Math.ceil(minutes(sch?.start ?? now, end.at) / 1440)
    if (days && (c.lifetimeBudgetMinor ?? 0) < MIN_BUDGET_MINOR * days)
      return fail("META_BUDGET_TOO_LOW", 422, "Lifetime budget must be at least the account minimum times the days.", { minimumMinor: MIN_BUDGET_MINOR * days, currency, budgetType: "LIFETIME", days })
  }
  return null
}

const active = (s: Store, key: string) => (s[key] ?? []).filter((t) => !t.archivedAt)
const sorted = (list: MetaPublishTemplate[]) => [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt))
const view = (t: MetaPublishTemplate & { archivedAt?: string | null }): MetaPublishTemplate => {
  const out = { ...t }
  delete out.archivedAt
  return out
}

/** MetaPublishBody of one creative from a template (empty text = from the offer, like the API). */
function bodyFrom(t: MetaPublishTemplate, c: MCreative | null): MetaPublishBody {
  return {
    dailyBudgetMinor: t.campaign.dailyBudgetMinor, countries: t.adset.countries, objective: t.campaign.objective,
    primaryText: t.ad.primaryText ?? (c ? `${c.name}` : "Written by HookMill from the offer."), headline: t.ad.headline ?? undefined,
    description: t.ad.description ?? undefined, callToAction: t.ad.callToAction, link: t.ad.urlTags ? `${t.ad.link}?${t.ad.urlTags}` : t.ad.link,
    specialAdCategories: t.campaign.specialAdCategories, ageMin: t.adset.ageMin, ageMax: t.adset.ageMax,
  }
}
const defaultsLite = { objectiveReason: "business_type" as const }

export const metaTemplateHandlers = [
  // ───── v2 §4: lists for the editor (OWNER/ADMIN/MEMBER; CLIENT → 403)
  http.get(u("/meta/instagram-accounts"), async ({ request }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't edit templates.")
    const g = liveScope(request)
    if (g instanceof Response) return g
    await delay(500)
    return ok(igOf(g.m.adAccountId))
  }),
  http.get(u("/meta/custom-audiences"), async ({ request }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't edit templates.")
    const g = liveScope(request)
    if (g instanceof Response) return g
    await delay(700)
    return ok(isFirstAccount(g.m.adAccountId) ? AUDIENCES : { audiences: [], truncated: false })
  }),
  http.get(u("/meta/locales"), async ({ request }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't edit templates.")
    const g = liveScope(request)
    if (g instanceof Response) return g
    await delay(400)
    return ok(LOCALES)
  }),

  http.get(u("/meta/templates"), async ({ request }) => {
    const g = scope(request)
    if (g instanceof Response) return g
    if (metaFlag() === "expired" && sessionStorage.getItem("mock:tpl") === "list422") {
      await delay(250)
      return expiredFail()
    }
    await delay(250)
    return ok(sorted(active(load(), g.key).map(view)))
  }),

  http.post(u("/meta/templates"), async ({ request }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't edit templates.")
    const g = scope(request)
    if (g instanceof Response) return g
    const b = (await request.json()) as MetaTemplateBody
    const bad = check(b, true, accountOf(g.m.adAccountId)?.currency ?? "USD", g.m.adAccountId)
    if (bad) return bad
    const s = load()
    const list = (s[g.key] ??= [])
    const first = !active(s, g.key).some((t) => t.isDefault)
    const isDefault = b.isDefault === true || first
    if (isDefault) list.forEach((t) => (t.isDefault = false))
    const now = new Date().toISOString()
    const t: MetaPublishTemplate = {
      id: `tpl_${Date.now().toString(36)}`, adAccountId: g.m.adAccountId!, name: b.name.trim(), isDefault,
      source: b.importedFrom ? "IMPORTED" : "MANUAL", importedFrom: b.importedFrom ?? null, campaign: b.campaign, adset: b.adset, ad: b.ad,
      reuseCampaignId: null, createdAt: now, updatedAt: now,
    }
    list.push(t)
    persist(s)
    await delay(400)
    return ok(t, 201)
  }),

  http.patch(u("/meta/templates/:id"), async ({ request, params }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't edit templates.")
    const g = scope(request)
    if (g instanceof Response) return g
    const s = load()
    const cur = active(s, g.key).find((t) => t.id === params.id)
    if (!cur) return fail("NOT_FOUND", 404, "Template not found.")
    const p = (await request.json()) as UpdateMetaTemplateBody
    const merged: MetaTemplateBody = { name: p.name ?? cur.name, campaign: p.campaign ?? cur.campaign, adset: p.adset ?? cur.adset, ad: p.ad ?? cur.ad }
    const bad = check(merged, true, accountOf(g.m.adAccountId)?.currency ?? "USD", g.m.adAccountId)
    if (bad) return bad
    if (p.isDefault === true) s[g.key].forEach((t) => (t.isDefault = false))
    Object.assign(cur, merged, { updatedAt: new Date().toISOString() }, p.isDefault !== undefined ? { isDefault: p.isDefault || cur.isDefault } : {})
    persist(s)
    await delay(400)
    return ok(view(cur))
  }),

  http.delete(u("/meta/templates/:id"), async ({ request, params }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't edit templates.")
    const g = scope(request)
    if (g instanceof Response) return g
    const s = load()
    const cur = active(s, g.key).find((t) => t.id === params.id)
    if (!cur) return fail("NOT_FOUND", 404, "Template not found.")
    const running = Object.values(db.v2.publications ?? {}).flat().some((p) => (p as { templateId?: string }).templateId === cur.id && publicationView(p).status === "PUBLISHING")
    if (running) return fail("INVALID_STATE", 409, "A publication with this template is running.", { reason: "publish_in_progress" })
    cur.archivedAt = new Date().toISOString()
    const wasDefault = cur.isDefault
    cur.isDefault = false
    if (wasDefault) {
      const next = sorted(active(s, g.key))[0]
      if (next) next.isDefault = true
    }
    persist(s)
    await delay(300)
    return ok(view(cur))
  }),

  http.post(u("/meta/templates/import"), async ({ request }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't edit templates.")
    const g = scope(request)
    if (g instanceof Response) return g
    const b = (await request.json()) as MetaTemplateImportBody
    await delay(900)
    const abo = b.level !== "campaign"
    const life = /life/i.test(b.id)
    const aware = /awareness/i.test(b.id)
    if (life || aware) {
      const result: MetaTemplateImportResult = {
        template: {
          name: "",
          campaign: life
            ? { destination: "NEW_CAMPAIGN", objective: "OUTCOME_SALES", budgetMode: "CBO", dailyBudgetMinor: 0, budgetType: "LIFETIME", lifetimeBudgetMinor: 30000, bidStrategy: "LOWEST_COST", bidAmountMinor: null, specialAdCategories: [], namePattern: "HookMill — {offer}" }
            : { destination: "NEW_CAMPAIGN", objective: "OUTCOME_AWARENESS", budgetMode: "CBO", dailyBudgetMinor: 2500, bidStrategy: "LOWEST_COST", bidAmountMinor: null, specialAdCategories: [], namePattern: "HookMill — {offer}" },
          adset: {
            pixelId: life ? g.m.pixelId : null, pixelEvent: life && g.m.pixelId ? "PURCHASE" : null, countries: ["US"], ageMin: 18, ageMax: 65, genders: "ALL", advantageAudience: true, placements: "AUTO",
            adsPerAdset: { min: 4, max: 8 }, namePattern: "{offer} — {date} — {n}",
            ...(life ? { schedule: { start: null, end: { kind: "AFTER_DAYS" as const, days: 7 } } } : { optimizationGoal: "REACH" as const }),
          },
          ad: { primaryText: null, headline: null, description: null, callToAction: life ? "SHOP_NOW" : "LEARN_MORE", link: "https://mooncloth.com/start", urlTags: "utm_source=meta&utm_medium=paid", namePattern: "{code}", ...(aware ? { instagramAccount: { id: "ig_mock_1", username: "hookmill.demo" } } : {}) },
          importedFrom: { level: b.level, id: b.id, name: b.id },
        },
        unsupported: [],
        adjusted: life ? [{ field: "adset.schedule", value: "Ran Nov 1–8 → runs 7 days from publish" }] : [],
      }
      return ok(result)
    }
    const result: MetaTemplateImportResult = {
      template: {
        name: "",
        campaign: { destination: "NEW_CAMPAIGN", objective: "OUTCOME_SALES", budgetMode: abo ? "ABO" : "CBO", dailyBudgetMinor: abo ? 4000 : 12000, bidStrategy: "LOWEST_COST", bidAmountMinor: null, specialAdCategories: [], namePattern: "HookMill — {offer}" },
        adset: {
          pixelId: g.m.pixelId, pixelEvent: g.m.pixelId ? "PURCHASE" : null, countries: ["US", "CA"], ageMin: 25, ageMax: 54, genders: "ALL", advantageAudience: false,
          placements: { platforms: ["facebook", "instagram"], positions: ["facebook_feed", "instagram_stream", "instagram_reels", "facebook_facebook_reels"] },
          adsPerAdset: { min: 4, max: 8 }, namePattern: "{offer} — {date} — {n}",
          // v2: audiences, languages and the schedule now come across (mock_adset_cbo_1, §9)
          customAudiences: [{ id: "ca_mock_lal_1", name: "Lookalike (US, 1%) — Purchasers" }], excludedCustomAudiences: [{ id: "ca_mock_buyers", name: "Purchasers 180d" }],
          locales: [{ key: 6, name: "English (US)" }], schedule: { start: null, end: { kind: "AFTER_DAYS", days: 14 } },
        },
        ad: { primaryText: null, headline: null, description: null, callToAction: "SHOP_NOW", link: "https://mooncloth.com/start", urlTags: "utm_source=meta&utm_medium=paid", namePattern: "{code}" },
        importedFrom: { level: b.level, id: b.id, name: b.id },
      },
      unsupported: [
        { field: "adset.targeting.flexible_spec", value: "Interest: Sleep" },
        { field: "adset.targeting.geo_locations.cities", value: "City: Austin, TX" },
      ],
      adjusted: [{ field: "adset.schedule", value: "Ran Oct 1–15 → runs 14 days from publish" }],
    }
    return ok(result)
  }),

  // with a template (falls through to metaHandlers without one)
  http.post(u("/creatives/:id/meta/publish"), async ({ request, params }) => {
    const b = (await request.clone().json().catch(() => ({}))) as { templateId?: string }
    if (!b.templateId) return undefined
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't publish.")
    const g = scope(request)
    if (g instanceof Response) return g
    const c = db.creatives.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Creative not found.")
    const d = toDetail(c)
    if (d.state !== "APPROVED" || !d.finalRender) return fail("INVALID_STATE", 409, "The creative isn't approved.", { reason: "not_approved" })
    const cur = listOf(c.id)[0]
    if (cur && publicationView(cur).status === "PUBLISHING") return fail("INVALID_STATE", 409, "A publication is already running.", { reason: "publish_in_progress" })
    const t = active(load(), g.key).find((x) => x.id === b.templateId)
    if (!t) return fail("NOT_FOUND", 404, "Template not found.")
    if (t.name.includes("[mock:no-pixel]")) return fail("META_PIXEL_REQUIRED", 422, "This objective needs a pixel.", { objective: t.campaign.objective })
    if (t.name.includes("[mock:schedule-expired]")) return fail("VALIDATION_ERROR", 400, "Invalid request.", { fields: [{ field: "adset.schedule.end", rule: "inPast" }], templateId: t.id })
    await delay(600)
    const p = newPublication(c, g.m, bodyFrom(t, c), { ...defaultsLite, objective: t.campaign.objective } as never, { id: ME.id, name: ME.name, initials: "G" })
    Object.assign(p, { templateId: t.id })
    save()
    return ok(publicationView(p), 202)
  }),

  http.post(u("/meta/publish-batch"), async ({ request }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't publish.")
    const g = scope(request)
    if (g instanceof Response) return g
    if (!metaReadyOf(g.m)) return fail("META_TOKEN_INVALID", 422, "Your Meta login expired. Reconnect to continue.")
    const b = (await request.json()) as MetaPublishBatchBody
    if (!Array.isArray(b.creativeIds) || !b.creativeIds.length || b.creativeIds.length > 50) return fail("VALIDATION_ERROR", 400, "Invalid request.", { fields: [{ field: "creativeIds", rule: "arraySize" }] })
    const t = active(load(), g.key).find((x) => x.id === b.templateId)
    if (!t) return fail("NOT_FOUND", 404, "Template not found.")
    // iterate pieces live in db.library (AUTO_APPROVE); creatives of the wizard in db.creatives
    const known = (id: string) => db.creatives.some((c) => c.id === id && toDetail(c).state === "APPROVED") || (db.library as { id: string }[]).some((l) => l.id === id)
    const notApproved = b.creativeIds.filter((id) => !known(id))
    if (notApproved.length) return fail("INVALID_STATE", 409, "Some creatives aren't approved.", { allowed: ["APPROVED"], reason: "not_approved", creativeIds: notApproved })
    const busy = b.creativeIds.filter((id) => { const cur = listOf(id)[0]; return cur && publicationView(cur).status === "PUBLISHING" })
    if (busy.length) return fail("INVALID_STATE", 409, "Already publishing.", { allowed: ["APPROVED"], reason: "publish_in_progress", creativeIds: busy })
    if (t.name.includes("[mock:no-pixel]")) return fail("META_PIXEL_REQUIRED", 422, "This objective needs a pixel.", { objective: t.campaign.objective })
    if (t.name.includes("[mock:schedule-expired]")) return fail("VALIDATION_ERROR", 400, "Invalid request.", { fields: [{ field: "adset.schedule.end", rule: "inPast" }], templateId: t.id })
    await delay(700)
    const max = t.adset.adsPerAdset.max
    const date = new Date().toISOString().slice(0, 10)
    const adsets: { name: string; creativeIds: string[]; belowMin: boolean }[] = []
    for (let i = 0; i < b.creativeIds.length; i += max) {
      const ids = b.creativeIds.slice(i, i + max)
      const n = adsets.length + 1
      adsets.push({ name: t.adset.namePattern.replace(/\{offer\}/g, "Mooncloth").replace(/\{code\}/g, ids[0]).replace(/\{date\}/g, date).replace(/\{n\}/g, String(n)), creativeIds: ids, belowMin: ids.length < t.adset.adsPerAdset.min })
    }
    const pubs = b.creativeIds.map((id, k) => {
      const c = db.creatives.find((x) => x.id === id) ?? ({ id, name: id } as MCreative)
      const p = newPublication(c, g.m, bodyFrom(t, c), { ...defaultsLite, objective: t.campaign.objective } as never, { id: ME.id, name: ME.name, initials: "G" })
      // staggered so the progress reads like a queue
      p.t0 += k * 1200
      Object.assign(p, { templateId: t.id })
      return p
    })
    save()
    return ok({ publications: pubs.map((p) => publicationView(p)), plan: { adsets } }, 202)
  }),

  // creatives born in the Iterate (only in db.library): their publications, so the batch progress polls like Send
  http.get(u("/creatives/:id/meta"), async ({ params }) => {
    const id = String(params.id)
    if (db.creatives.some((c) => c.id === id) || !(db.v2.publications?.[id]?.length)) return undefined
    await delay(200)
    const [cur, ...rest] = listOf(id).map((p) => publicationView(p))
    return ok({ publication: cur ?? null, history: rest, defaults: null, connection: { status: "ACTIVE", canPublish: true } })
  }),
]
