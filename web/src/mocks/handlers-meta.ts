/**
 * MSW handlers of meta-v1 §3.1-3.2 (connection, options, selection, health, ads, summary) and of the tour
 * (onboarding-v2 §3.4). State in db.v2 (./v2.ts). Dev toggles: `?metamock=stale|failed|expired|off` (sessionStorage mock:meta).
 */
import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type { MetaAdsQuery, MetaConnectBody, MetaOAuthErrorCode, MetaOAuthStatus, MetaOfferLinkBody, MetaOfferLinkLevel, MetaOfferLinkResult, MetaPublishBody, MetaSelectionBody, ProductEventsBody, SeeTipBody, TipKey, TipsSeenResponse, TourEventName, TourStateV2, TourStop, TourStopV2 } from "@/lib/api/types"
import { mockAccess } from "./amostra"
import { db, save, toDetail } from "./db"
import { mockWorkspaceOf } from "./auth"
import { ME } from "./fixtures"
import { allPublications, defaultsOf, listOf, MIN_BUDGET_MINOR, newPublication, publicationView, retryPublication } from "./publish"
import { campaignAds, campaignIdOfAd, mockTotals, snapshotAdRefs } from "./campaigns"
import { byGroup, decorateAds, linksOf, offerExists, offerInfoOf, offerQuery, setLinks, type OfferLink } from "./offer-match"
import { accountOf, ACCOUNTS, adRows, connectionView, healthOf, metaFlag, newMeta, PAGES, PIXELS, summaryOf, syncState, type MetaState } from "./v2"

const u = (p: string) => API_URL + p
const ok = <D, M>(data: D, meta?: M, status = 200) => HttpResponse.json({ success: true, data, ...(meta ? { meta } : {}) }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })
const body = async <T,>(r: Request) => ((await r.json().catch(() => ({}))) as T)
const wid = (req: Request) => mockWorkspaceOf(req.headers.get("Authorization")).id
const metaOff = () => metaFlag() === "off"
const offError = () => fail("META_NOT_CONFIGURED", 503, "Meta isn't set up on this server yet.", { reason: "off" })
const notConnected = () => fail("META_NOT_CONNECTED", 422, "Connect a Meta account first.")
const SYNC_MS = 20_000

/**
 * "Connect from another browser" (meta-v1 §3.1, 22/10): the fake dialog opened with returnTo=/meta/done (another tab
 * stands in for the other browser) leaves its result in localStorage, which every tab sees; this consumes it.
 */
const REMOTE_KEY = "mock:meta:remote"
type RemoteResult = { result: "connected" | "error"; code?: MetaOAuthErrorCode; missing?: string[] }
function takeRemote(m: MetaState): boolean {
  if (!m.oauth?.remote || typeof window === "undefined") return false
  const raw = localStorage.getItem(REMOTE_KEY)
  if (!raw) return false
  localStorage.removeItem(REMOTE_KEY)
  const r = JSON.parse(raw) as RemoteResult
  m.pending = false
  if (r.result === "connected") {
    m.status = "ACTIVE"
    if (!m.selectedAt) m.connectedAt = new Date().toISOString()
    m.oauth = { ...m.oauth, lastError: null, connectedAt: new Date().toISOString() }
    sessionStorage.removeItem("mock:meta")
  } else {
    m.oauth = { ...m.oauth, lastError: { code: r.code ?? "META_OAUTH_FAILED", missing: r.missing ?? [], at: new Date().toISOString() } }
  }
  save()
  return true
}
const oauthStatusOf = (m: MetaState | undefined): MetaOAuthStatus => ({
  pending: !!m?.pending && !!m.oauth && Date.parse(m.oauth.expiresAt) > Date.now(),
  expiresAt: m?.oauth?.expiresAt ?? null,
  lastError: m?.oauth?.lastError ?? null,
  connectedAt: m?.oauth?.connectedAt ?? null,
})

/** The connection of the token's workspace; a pending OAuth round trip is resolved here from what the fake dialog left. */
export function metaOf(req: Request): MetaState | null {
  // Meta gate (25/10): ?metamock=none = this workspace never connected (GET /meta/connection → null, reads → 422)
  if (metaFlag() === "none") return null
  const id = wid(req)
  let m = db.v2.meta[id]
  // ?metamock=connected|expired|perm|… on a workspace that never connected: seed a connected, synced account (web-mock QA)
  if (!m && metaFlag() && metaFlag() !== "off") {
    const t = Date.now()
    const acc = ACCOUNTS.find((a) => a.canManage) ?? ACCOUNTS[0]
    m = db.v2.meta[id] = {
      ...newMeta(), adAccountId: acc.id, pageId: PAGES[0].id, pixelId: PIXELS.find((x) => x.adAccountId === acc.id)?.id ?? null,
      selectedAt: new Date(t - 120_000).toISOString(), syncT0: t - 90_000, syncT1: t - 60_000, lastSyncAt: new Date(t - 60_000).toISOString(),
    }
  }
  if (!m) return null
  if (m.pending && m.oauth?.remote) {
    // the other browser hasn't finished yet: the row stays pending (status comes from GET /meta/oauth/status)
    if (!takeRemote(m)) return m.selectedAt || m.status !== "ACTIVE" ? m : null
    return m
  }
  if (m.pending) {
    const result = typeof window === "undefined" ? null : sessionStorage.getItem("mock:meta:result")
    sessionStorage.removeItem("mock:meta:result")
    m.pending = false
    if (result === "connected") {
      m.status = "ACTIVE"
      if (!m.selectedAt) m.connectedAt = new Date().toISOString()
      sessionStorage.removeItem("mock:meta")
    } else if (!m.selectedAt) {
      delete db.v2.meta[id]
      save()
      return null
    }
    save()
  }
  return m
}
/** businessType / market of the token's workspace (ws_1 = db.workspace; the others live in db.v2.ws) */
function wsOf(req: Request): { businessType: unknown; market: string | null } {
  const id = wid(req)
  return id === db.workspace.id ? db.workspace : (db.v2.ws[id] ?? { businessType: null, market: null })
}
export const metaReadyOf = (m: MetaState | null): m is MetaState => !!m && m.status === "ACTIVE" && !!m.adAccountId && !!m.pageId && metaFlag() !== "expired"
/** account + Page chosen, even with the login expired: the readings (summary/ads) come from the snapshots (design §2.12) */
export const selectedOf = (m: MetaState | null): m is MetaState => !!m && m.status !== "DISCONNECTED" && !!m.adAccountId && !!m.pageId
const rowsOf = (m: MetaState) => adRows(m, new Set(m.iterated ?? []))
/** the first finished sync stamps lastSyncAt (the clock is derived, nothing runs in the background) */
export function settle(m: MetaState) {
  if (m.syncT1 !== null && Date.now() >= m.syncT1 && !m.lastSyncAt) {
    m.lastSyncAt = new Date(m.syncT1).toISOString()
    m.syncT0 = m.syncT1 = null
    save()
  }
}

export const metaHandlers = [
  http.post(u("/meta/connect"), async ({ request }) => {
    if (metaOff()) return offError()
    const b = await body<MetaConnectBody>(request)
    const returnTo = b.returnTo ?? "/onboarding/meta"
    const id = wid(request)
    const expiresAt = new Date(Date.now() + 600_000).toISOString()
    const prev = db.v2.meta[id] ?? newMeta()
    // a first attempt starts DISCONNECTED (newMeta is ACTIVE for the seeded flow); the dialog's result promotes it
    const fresh = !db.v2.meta[id]
    db.v2.meta[id] = { ...prev, status: fresh ? "DISCONNECTED" : prev.status, pending: true, oauth: { remote: returnTo === "/meta/done", expiresAt, lastError: null, connectedAt: prev.oauth?.connectedAt ?? null } }
    if (typeof window !== "undefined") localStorage.removeItem(REMOTE_KEY)
    save()
    await delay(250)
    return ok({ url: `${location.origin}/dev/meta-login?returnTo=${encodeURIComponent(returnTo)}`, expiresAt }, undefined, 201)
  }),

  http.get(u("/meta/oauth/status"), async ({ request }) => {
    if (metaOff()) return offError()
    await delay(150)
    const m = db.v2.meta[wid(request)]
    if (m) takeRemote(m)
    return ok(oauthStatusOf(m))
  }),

  http.get(u("/meta/connection"), async ({ request }) => {
    if (metaOff()) return offError()
    await delay(200)
    const m = metaOf(request)
    if (!m) return ok(null)
    settle(m)
    // meta-templates-v2 §4: the account's daily minimum, so the template editor validates before the 422
    const view = connectionView(m, rowsOf(m))
    return ok(view.adAccount ? { ...view, adAccount: { ...view.adAccount, minDailyBudgetMinor: MIN_BUDGET_MINOR } } : view)
  }),

  http.get(u("/meta/options"), async ({ request }) => {
    const m = metaOf(request)
    if (!m || m.status !== "ACTIVE") return notConnected()
    if (metaFlag() === "expired") return fail("META_TOKEN_INVALID", 422, "Your Meta login expired. Reconnect to continue.")
    const acc = new URL(request.url).searchParams.get("adAccountId")
    await delay(1400)
    return ok({ adAccounts: ACCOUNTS, pages: PAGES, pixels: acc ? PIXELS.filter((p) => p.adAccountId === acc) : [] })
  }),

  http.put(u("/meta/selection"), async ({ request }) => {
    const m = metaOf(request)
    if (!m || m.status !== "ACTIVE") return notConnected()
    const b = await body<MetaSelectionBody>(request)
    const a = accountOf(b.adAccountId)
    if (!a) return fail("NOT_FOUND", 404, "Ad account not in your options.")
    if (!a.canManage) return fail("META_PERMISSION", 422, "You don't have permission to advertise on this account.", { adAccountId: a.id, reason: a.permissionReason })
    if (!PAGES.some((p) => p.id === b.pageId)) return fail("NOT_FOUND", 404, "Page not in your options.")
    if (b.pixelId && !PIXELS.some((p) => p.id === b.pixelId)) return fail("NOT_FOUND", 404, "Pixel not in your options.")
    const changed = m.adAccountId !== a.id
    m.adAccountId = a.id
    m.pageId = b.pageId
    m.pixelId = b.pixelId ?? null
    m.selectedAt = new Date().toISOString()
    if (changed || !m.lastSyncAt) {
      m.lastSyncAt = null
      m.syncT0 = Date.now()
      m.syncT1 = Date.now() + SYNC_MS
      m.iterated = []
    }
    save()
    await delay(900)
    return ok(connectionView(m, rowsOf(m)))
  }),

  http.post(u("/meta/health"), async ({ request }) => {
    const m = metaOf(request)
    if (!m || m.status !== "ACTIVE") return notConnected()
    await delay(800)
    const rows = rowsOf(m)
    return ok(healthOf(m, rows.length, rows.filter((r) => r.effectiveStatus === "ACTIVE").length))
  }),

  http.delete(u("/meta/connection"), async ({ request }) => {
    const id = wid(request)
    if (!db.v2.meta[id]) return fail("NOT_FOUND", 404, "Not connected.")
    delete db.v2.meta[id]
    save()
    await delay(300)
    return ok({ ok: true })
  }),

  http.post(u("/meta/sync"), async ({ request }) => {
    const m = metaOf(request)
    if (!metaReadyOf(m)) return notConnected()
    if (m.syncT1 !== null && Date.now() < m.syncT1) return ok({ job: job(m) })
    sessionStorage.removeItem("mock:meta")
    m.syncT0 = Date.now()
    m.syncT1 = Date.now() + 8_000
    save()
    return ok({ job: job(m) }, undefined, 202)
  }),

  http.get(u("/meta/ads"), async ({ request }) => {
    const m = metaOf(request)
    if (!selectedOf(m)) return notConnected()
    // campanhas-v1: the Campaigns "Ads only" mode (format=all or any of its filters) reads the campaigns model
    const sp = new URL(request.url).searchParams
    if (sp.get("format") === "all" || ["status", "origin", "campaignId", "adsetId"].some((k) => sp.has(k))) return campaignAds(request, m)
    settle(m)
    const q = Object.fromEntries(new URL(request.url).searchParams) as unknown as MetaAdsQuery
    // meta-oferta-v1 §4.1: offerScope without offerId = 400; an offer of another workspace = 404 { resource: 'offer' }
    const oq = offerQuery(sp)
    if ("error" in oq) return oq.error === "requires_offer" ? fail("VALIDATION_ERROR", 400, "offerScope needs offerId.", { fields: [{ field: "offerScope", rule: "requires_offer" }] }) : fail("NOT_FOUND", 404, "Offer not found.", { resource: "offer" })
    await delay(250)
    const sync = syncState(m)
    // the `offer` of each row (and the verdict inside the offer, §4.3) before the filters, like the API
    const dec = decorateAds(sync.state === "first_sync" ? [] : rowsOf(m), oq.offerId, wid(request), roleOf(request) !== "CLIENT", (id) => campaignIdOfAd(request, id))
    let rows = dec.rows
    if (q.verdict) rows = rows.filter((r) => r.verdict === q.verdict)
    if (q.trend) rows = rows.filter((r) => r.trend === q.trend)
    if (q.q) rows = rows.filter((r) => r.name.toLowerCase().includes(String(q.q).toLowerCase()))
    const offer = dec.meta ? { ...dec.meta, counts: { this: rows.filter((r) => r.offer.fit === "this").length, unknown: rows.filter((r) => r.offer.fit === "unknown").length, other: rows.filter((r) => r.offer.fit === "other").length } } : undefined
    if (oq.scope) rows = rows.filter((r) => r.offer.fit === oq.scope)
    if (oq.offerId) rows = byGroup(rows, (r) => r.offer.fit)
    const limit = Math.max(1, Math.min(50, Number(q.limit) || 20))
    return ok(rows.slice(0, limit), { nextCursor: null, summary: summaryOf(m, "30d", rowsOf(m)), totals: mockTotals(rows, q.period === "7d" ? "7d" : "30d"), ...(offer ? { offer } : {}) })
  }),

  http.get(u("/meta/summary"), async ({ request }) => {
    const m = metaOf(request)
    if (!selectedOf(m)) return notConnected()
    settle(m)
    const period = new URL(request.url).searchParams.get("period") === "7d" ? "7d" : "30d"
    await delay(250)
    return ok(summaryOf(m, period, rowsOf(m)))
  }),

  http.get(u("/meta/publications"), async ({ request }) => {
    const status = new URL(request.url).searchParams.get("status")
    await delay(200)
    const rows = allPublications().map((p) => publicationView(p)).filter((p) => !status || p.status === status)
    rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return ok(rows, { nextCursor: null })
  }),

  // ───── §3.3 Send → "Publish to Meta" (sequence §3.3.1)
  http.get(u("/creatives/:id/meta"), async ({ request, params }) => {
    if (metaOff()) return offError()
    const c = db.creatives.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Creative not found.")
    const m = metaOf(request)
    await delay(250)
    const list = listOf(c.id)
    const [cur, ...rest] = list.map((p) => publicationView(p))
    if (!m || m.status === "DISCONNECTED") return ok({ publication: cur ?? null, history: rest, defaults: null, connection: null })
    const view = connectionView(m, rowsOf(m))
    // like the API (publicacao.service creativeMeta): defaults whenever the connection isn't DISCONNECTED, also with the
    // login expired, so the Send screen shows the expired alert + the templates (F4) instead of "Connect Meta first"
    return ok({
      publication: cur ?? null, history: rest,
      defaults: selectedOf(m) ? defaultsOf(m, c, wsOf(request)) : null,
      connection: { status: view.status, canPublish: view.status === "ACTIVE" && !!view.health?.canPublish },
    })
  }),

  http.post(u("/creatives/:id/meta/publish"), async ({ request, params }) => {
    if (metaOff()) return offError()
    const c = db.creatives.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Creative not found.")
    if (mockWorkspaceOf(request.headers.get("Authorization")).role === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't publish.")
    const m = metaOf(request)
    if (!m || m.status !== "ACTIVE") return notConnected()
    if (metaFlag() === "expired") return fail("META_TOKEN_INVALID", 422, "Your Meta login expired. Reconnect to continue.")
    if (!m.adAccountId || !m.pageId) return fail("META_SELECTION_MISSING", 422, "Choose an ad account and a Page to continue.", { missing: [m.adAccountId ? null : "adAccount", m.pageId ? null : "page"].filter(Boolean) })
    const d = toDetail(c)
    if (d.state !== "APPROVED" || !d.finalRender) return fail("INVALID_STATE", 409, "The creative isn't approved.", { reason: "not_approved" })
    const cur = listOf(c.id)[0]
    if (cur && publicationView(cur).status === "PUBLISHING") return fail("INVALID_STATE", 409, "A publication is already running.", { reason: "publish_in_progress" })
    const a = accountOf(m.adAccountId)
    if (a && a.accountStatus !== 1) return fail("META_ACCOUNT_UNUSABLE", 422, "This ad account is disabled. Choose another account.", { accountStatus: a.accountStatus, label: "disabled" })
    const b = await body<MetaPublishBody>(request)
    const fields: { field: string; rule: string }[] = []
    if (!Number.isInteger(b.dailyBudgetMinor) || b.dailyBudgetMinor <= 0) fields.push({ field: "dailyBudgetMinor", rule: "isInt" })
    if (!Array.isArray(b.countries) || !b.countries.length || b.countries.length > 10 || b.countries.some((x) => !/^[A-Z]{2}$/.test(x))) fields.push({ field: "countries", rule: "isISO31661Alpha2" })
    if (typeof b.primaryText !== "string" || !b.primaryText.trim() || b.primaryText.length > 2000) fields.push({ field: "primaryText", rule: "length" })
    if (typeof b.link !== "string" || !/^https?:\/\//.test(b.link)) fields.push({ field: "link", rule: "isUrl" })
    if (fields.length) return fail("VALIDATION_ERROR", 400, "Invalid request.", { fields })
    const defaults = defaultsOf(m, c, wsOf(request))
    const objective = b.objective ?? defaults.objective
    if (objective !== "OUTCOME_TRAFFIC" && !m.pixelId) return fail("META_PIXEL_REQUIRED", 422, "This objective needs a pixel. Choose one, or switch to Traffic.", { objective })
    if (b.dailyBudgetMinor < MIN_BUDGET_MINOR) return fail("META_BUDGET_TOO_LOW", 422, "Daily budget must be at least the account minimum.", { minimumMinor: MIN_BUDGET_MINOR, currency: a?.currency ?? "USD" })
    await delay(600)
    const p = newPublication(c, m, { ...b, objective }, defaults, { id: ME.id, name: ME.name, initials: "G" })
    return ok(publicationView(p), undefined, 202)
  }),

  http.post(u("/creatives/:id/meta/retry"), async ({ request, params }) => {
    if (mockWorkspaceOf(request.headers.get("Authorization")).role === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't publish.")
    const p = listOf(String(params.id))[0]
    if (!p) return fail("NOT_FOUND", 404, "No publication.")
    if (!retryPublication(p)) return fail("INVALID_STATE", 409, "Only a failed publication can be retried.")
    await delay(300)
    return ok(publicationView(p), undefined, 202)
  }),

  http.post(u("/creatives/:id/meta/activate"), async ({ request, params }) => {
    const role = mockWorkspaceOf(request.headers.get("Authorization")).role
    if (role !== "OWNER" && role !== "ADMIN") return fail("FORBIDDEN", 403, "Only owners and admins can activate.")
    const p = listOf(String(params.id))[0]
    if (!p) return fail("NOT_FOUND", 404, "No publication.")
    if (metaFlag() === "expired") return fail("META_TOKEN_INVALID", 422, "Your Meta login expired. Reconnect to continue.")
    if (publicationView(p).status !== "PAUSED") return fail("INVALID_STATE", 409, "Only a paused ad can be activated.")
    await delay(900)
    p.final = "ACTIVE"
    p.activatedAt = new Date().toISOString()
    save()
    return ok(publicationView(p))
  }),

  http.post(u("/creatives/:id/meta/pause"), async ({ request, params }) => {
    const role = mockWorkspaceOf(request.headers.get("Authorization")).role
    if (role !== "OWNER" && role !== "ADMIN") return fail("FORBIDDEN", 403, "Only owners and admins can pause.")
    const p = listOf(String(params.id))[0]
    if (!p) return fail("NOT_FOUND", 404, "No publication.")
    if (publicationView(p).status !== "ACTIVE") return fail("INVALID_STATE", 409, "Only an active ad can be paused.")
    await delay(700)
    p.final = "PAUSED"
    save()
    return ok(publicationView(p))
  }),

  // ───── meta-oferta-v1 §5: manual correction (BELONGS is exclusive per object; NOT_BELONGS only excludes)
  http.put(u("/meta/offer-links"), async ({ request }) => {
    const g = offerLinkGuard(request)
    if (g) return g
    const b = await body<MetaOfferLinkBody>(request)
    const bad = offerLinkInvalid(request, b.level, b.objectId, b.offerId)
    if (bad) return bad
    const ws = wid(request)
    const before = fitsFor(request, b.offerId)
    const same = (l: OfferLink) => l.level === b.level && l.objectId === b.objectId
    const list = linksOf(ws).filter((l) => !(same(l) && (b.belongs ? l.decision === "BELONGS" || l.offerId === b.offerId : l.offerId === b.offerId)))
    list.push({ level: b.level, objectId: b.objectId, offerId: b.offerId, decision: b.belongs ? "BELONGS" : "NOT_BELONGS" })
    setLinks(ws, list)
    await delay(350)
    return ok<MetaOfferLinkResult, undefined>({ level: b.level, objectId: b.objectId, offerId: b.offerId, decision: b.belongs ? "BELONGS" : "NOT_BELONGS", affectedAds: changed(before, fitsFor(request, b.offerId)) })
  }),
  http.delete(u("/meta/offer-links"), async ({ request }) => {
    const g = offerLinkGuard(request)
    if (g) return g
    const sp = new URL(request.url).searchParams
    const level = sp.get("level") as MetaOfferLinkLevel
    const objectId = sp.get("objectId") ?? ""
    const offerId = sp.get("offerId") ?? ""
    const bad = offerLinkInvalid(request, level, objectId, offerId)
    if (bad) return bad
    const ws = wid(request)
    const before = fitsFor(request, offerId)
    setLinks(ws, linksOf(ws).filter((l) => !(l.level === level && l.objectId === objectId && l.offerId === offerId)))
    await delay(300)
    return ok<MetaOfferLinkResult, undefined>({ level, objectId, offerId, decision: null, affectedAds: changed(before, fitsFor(request, offerId)) })
  }),

  // ───── tour v2 (docs/contratos/tour-v2.md): stops by role, the winner (lowest CPA), the tips seen. No `?v=2` = legacy shape.
  http.get(u("/workspace/tour"), async ({ request }) => {
    const id = wid(request)
    const completedAt = db.v2.tour[id] ?? null
    const m = metaOf(request)
    const winners = metaReadyOf(m) && syncState(m).state !== "first_sync" ? rowsOf(m).filter((r) => r.verdict === "WINNER") : []
    const client = roleOf(request) === "CLIENT"
    const best = client ? null : (winners.sort((x, y) => (x.metrics.cpa ?? Infinity) - (y.metrics.cpa ?? Infinity))[0] ?? null)
    const tipsSeen = tipsOf(request)
    await delay(150)
    if (new URL(request.url).searchParams.get("v") !== "2") {
      const stops: TourStop[] = ["brain", ...(winners.length ? (["iterate"] as TourStop[]) : []), "concepts", "eddy", "home"]
      return ok({ completedAt, stops, winnerMetaAdId: best?.metaAdId ?? null, winnerName: best?.name ?? null, tipsSeen })
    }
    const stops: TourStopV2[] = client ? ["brain", "review"] : ["brain", "templates", ...(mockAccess() === "INTERNAL" ? [] : (["credits"] as TourStopV2[]))]
    return ok<TourStateV2, undefined>({ completedAt, stops, winnerMetaAdId: best?.metaAdId ?? null, winnerName: best?.name ?? null, tipsSeen })
  }),
  http.post(u("/workspace/tour/tips"), async ({ request }) => {
    const { tip } = (await request.json()) as SeeTipBody
    if (!TIP_KEYS.includes(tip)) return fail("VALIDATION_ERROR", 400, "Unknown tip.")
    const cur = tipsOf(request)
    if (!cur.includes(tip)) setTips(request, [...cur, tip])
    await delay(100)
    return ok<TipsSeenResponse, undefined>({ tipsSeen: tipsOf(request) })
  }),
  http.delete(u("/workspace/tour/tips"), async ({ request }) => {
    setTips(request, [])
    await delay(100)
    return ok<TipsSeenResponse, undefined>({ tipsSeen: [] })
  }),
  // tour-v2 §6: 204; the whole batch is refused when a name is unknown. The mock logs it so the funnel can be read in the console.
  http.post(u("/events"), async ({ request }) => {
    const { events } = (await request.json()) as ProductEventsBody
    if (!Array.isArray(events) || !events.length || events.length > 50 || events.some((e) => !EVENT_NAMES.includes(e.name)))
      return fail("VALIDATION_ERROR", 400, "Invalid events.")
    console.info("[mock events]", events.map((e) => `${e.name} ${JSON.stringify(e.props ?? {})}`).join("\n"))
    return new HttpResponse(null, { status: 204 })
  }),
  http.post(u("/workspace/tour/complete"), async ({ request }) => {
    const id = wid(request)
    db.v2.tour[id] ??= new Date().toISOString()
    save()
    await delay(150)
    return ok({ tourCompletedAt: db.v2.tour[id] })
  }),
]

// tour-v2: values of TIP_KEYS / TOUR_EVENT_NAMES (types-only package)
const TIP_KEYS: readonly TipKey[] = ["adSource", "plan", "result", "send", "library"]
const EVENT_NAMES: readonly TourEventName[] = ["tour_started", "tour_stop_viewed", "tour_stop_next", "tour_stop_back", "tour_stop_missing", "tour_skipped", "tour_completed", "tip_shown", "tip_dismissed", "tip_action"]
/** tips seen per workspace + user (sessionStorage, so "Show tips again" and a new tab behave like the API) */
const tipsKey = (req: Request) => `mock:tips:${wid(req)}`
const tipsOf = (req: Request): TipKey[] => {
  try {
    return JSON.parse(sessionStorage.getItem(tipsKey(req)) ?? "[]") as TipKey[]
  } catch {
    return []
  }
}
const setTips = (req: Request, v: TipKey[]) => sessionStorage.setItem(tipsKey(req), JSON.stringify(v))
const roleOf = (req: Request) => (typeof window !== "undefined" && sessionStorage.getItem("mock:role")) || mockWorkspaceOf(req.headers.get("Authorization")).role
function offerLinkGuard(req: Request): Response | null {
  if (metaOff()) return offError()
  if (roleOf(req) === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't change this.")
  const m = metaOf(req)
  if (!m || !m.adAccountId) return fail("META_SELECTION_MISSING", 409, "Choose an ad account first.", { missing: ["adAccount"] })
  return null
}
function offerLinkInvalid(req: Request, level: string, objectId: string, offerId: string): Response | null {
  if (level !== "AD" && level !== "CAMPAIGN") return fail("VALIDATION_ERROR", 400, "Invalid request.", { fields: [{ field: "level", rule: "isIn" }] })
  if (!objectId || objectId.length > 64) return fail("VALIDATION_ERROR", 400, "Invalid request.", { fields: [{ field: "objectId", rule: "length" }] })
  if (!offerExists(offerId)) return fail("NOT_FOUND", 404, "Offer not found.", { resource: "offer" })
  const refs = snapshotAdRefs(req)
  if (level === "AD" ? !refs.some((a) => a.metaAdId === objectId) : !refs.some((a) => a.campaignId === objectId))
    return fail("NOT_FOUND", 404, "Not in the snapshot of this ad account.", { resource: level === "AD" ? "ad" : "campaign" })
  return null
}
/** fit of every snapshot ad for one offer (to count `affectedAds`) */
function fitsFor(req: Request, offerId: string) {
  const ws = wid(req)
  return new Map(snapshotAdRefs(req).map((a) => [a.metaAdId, offerInfoOf(a, offerId, ws, true).fit]))
}
const changed = (a: Map<string, unknown>, b: Map<string, unknown>) => [...a].filter(([k, v]) => b.get(k) !== v).length

function job(m: MetaState) {
  const now = Date.now()
  const total = 6 * 36
  const done = m.syncT0 !== null && m.syncT1 !== null ? Math.min(total, Math.round(((now - m.syncT0) / (m.syncT1 - m.syncT0)) * total)) : total
  return {
    id: `job_sync_${m.syncT0 ?? 0}`, type: "META_SYNC", status: done >= total ? "SUCCEEDED" : "RUNNING", stage: done >= total ? null : "reading_insights",
    progress: Math.round((done / total) * 100), etaSec: m.syncT1 ? Math.max(0, Math.ceil((m.syncT1 - now) / 1000)) : 0,
    checklist: [{ key: "listing_ads", done: true }, { key: "reading_insights", done: done >= total }, { key: "scoring", done: done >= total }],
    errorCode: null, failReason: null, action: null, output: null,
  }
}
