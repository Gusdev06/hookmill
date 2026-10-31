/**
 * MSW handlers of meta-templates-v1 §2: templates CRUD per (workspace, ad account), import (doesn't save), publish with
 * `{ templateId }` and POST /meta/publish-batch. Registered BEFORE metaHandlers: the two routes they share
 * (POST …/publish, GET /creatives/:id/meta) fall through when the request isn't about templates.
 * Mock triggers: a template whose name has "[mock:no-pixel]" → 422 META_PIXEL_REQUIRED on publish.
 */
import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type { MetaPublishBatchBody, MetaPublishBody, MetaPublishTemplate, MetaTemplateBody, MetaTemplateImportBody, MetaTemplateImportResult, UpdateMetaTemplateBody } from "@/lib/api/types"
import { db, save, toDetail, type MCreative } from "./db"
import { mockWorkspaceOf } from "./auth"
import { ME } from "./fixtures"
import { metaOf, metaReadyOf } from "./handlers-meta"
import { listOf, MIN_BUDGET_MINOR, newPublication, publicationView } from "./publish"
import { accountOf, metaFlag } from "./v2"

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

function scope(req: Request) {
  if (metaFlag() === "off") return fail("META_NOT_CONFIGURED", 503, "Meta isn't set up on this server yet.", { reason: "off" })
  const m = metaOf(req)
  if (!m || m.status !== "ACTIVE") return fail("META_NOT_CONNECTED", 422, "Connect a Meta account first.")
  if (!m.adAccountId || !m.pageId) return fail("META_SELECTION_MISSING", 422, "Choose an ad account and a Page to continue.")
  return { m, key: `${wid(req)}:${m.adAccountId}` }
}

/** Same checks as the API (templates.ts): 400 fields, then 422 pixel, then 422 budget. */
function check(b: MetaTemplateBody, pixelOk: boolean, currency: string) {
  const fields: { field: string; rule: string }[] = []
  if (!b.name?.trim() || b.name.length > 60) fields.push({ field: "name", rule: "length" })
  if (!Number.isInteger(b.campaign?.dailyBudgetMinor) || b.campaign.dailyBudgetMinor < 1) fields.push({ field: "campaign.dailyBudgetMinor", rule: "isInt" })
  if (!b.adset?.countries?.length || b.adset.countries.some((c) => !/^[A-Z]{2}$/.test(c))) fields.push({ field: "adset.countries", rule: "isCountryList" })
  if (!/^https?:\/\/\S+\.\S+/.test(b.ad?.link ?? "")) fields.push({ field: "ad.link", rule: "isUrl" })
  if (fields.length) return fail("VALIDATION_ERROR", 400, "Invalid request.", { fields })
  const needs = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION"].includes(b.campaign.objective)
  if (!b.adset.pixelId && (needs || b.adset.pixelEvent)) return fail("META_PIXEL_REQUIRED", 422, "This objective needs a pixel.", { objective: b.campaign.objective })
  if (!pixelOk && b.adset.pixelId) return fail("META_PIXEL_REQUIRED", 422, "This pixel isn't on the ad account.", { objective: b.campaign.objective })
  if (b.campaign.dailyBudgetMinor < MIN_BUDGET_MINOR) return fail("META_BUDGET_TOO_LOW", 422, "Daily budget must be at least the account minimum.", { minimumMinor: MIN_BUDGET_MINOR, currency })
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
  http.get(u("/meta/templates"), async ({ request }) => {
    const g = scope(request)
    if (g instanceof Response) return g
    await delay(250)
    return ok(sorted(active(load(), g.key).map(view)))
  }),

  http.post(u("/meta/templates"), async ({ request }) => {
    if (isClient(request)) return fail("FORBIDDEN", 403, "Clients can't edit templates.")
    const g = scope(request)
    if (g instanceof Response) return g
    const b = (await request.json()) as MetaTemplateBody
    const bad = check(b, true, accountOf(g.m.adAccountId)?.currency ?? "USD")
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
    const bad = check(merged, true, accountOf(g.m.adAccountId)?.currency ?? "USD")
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
    const result: MetaTemplateImportResult = {
      template: {
        name: "",
        campaign: { destination: "NEW_CAMPAIGN", objective: "OUTCOME_SALES", budgetMode: abo ? "ABO" : "CBO", dailyBudgetMinor: abo ? 4000 : 12000, bidStrategy: "LOWEST_COST", bidAmountMinor: null, specialAdCategories: [], namePattern: "HookMill — {offer}" },
        adset: {
          pixelId: g.m.pixelId, pixelEvent: g.m.pixelId ? "PURCHASE" : null, countries: ["US", "CA"], ageMin: 25, ageMax: 54, genders: "ALL", advantageAudience: false,
          placements: { platforms: ["facebook", "instagram"], positions: ["facebook_feed", "instagram_stream", "instagram_reels", "facebook_facebook_reels"] },
          adsPerAdset: { min: 4, max: 8 }, namePattern: "{offer} — {date} — {n}",
        },
        ad: { primaryText: null, headline: null, description: null, callToAction: "SHOP_NOW", link: "https://mooncloth.com/start", urlTags: "utm_source=meta&utm_medium=paid", namePattern: "{code}" },
        importedFrom: { level: b.level, id: b.id, name: b.id },
      },
      unsupported: [
        { field: "custom audience (exclusion)", value: "Purchasers 180d" },
        { field: "ad schedule", value: "" },
      ],
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
