import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type {
  Competitor, CompetitorDiscoveryView, CompetitorRelation, DiscoveryStage, DiscoveryStatus, DiscoveryTrigger, DismissReason, LibraryAdFormat,
  LibraryAdPlatform, ResearchAdCard, ResearchAdDetail, ResearchAdPage, ResearchAdTier, ResearchStatus,
} from "@/lib/api/types"
import { mockWorkspaceOf } from "./auth"

/*
 * Ad Radar mock (ads-research-v1 C.8), until api/src/research answers. Deterministic:
 * 1st discovery (ONBOARDING) follows A, B, C, D (direct) + E (adjacent); reserve G (direct, 1 ad), F (adjacent).
 * Dismiss → the first in reserve with ≥ 2 ads seen takes the spot (none → the first one).
 * 2nd discovery (MANUAL, "Search again") finds J, K (new, direct) and brings G/F back as MEMORY; followed ones never leave.
 * States: ?radar=reset (first time: discovery running) · ready · loading · error (Softwake didn't answer) · empty · failed ·
 * cap (research budget used) · quota (Ad Library at its limit) · off (ADS_RESEARCH_MODE=off) · slow · ?radar=on clears the state flag.
 */
const u = (p: string) => API_URL + p
const ok = <D>(data: D, status = 200) => HttpResponse.json({ success: true, data }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })

const KEY = "mock:research:v1"
const FLAG = "mock:radar"
const DAY = 86_400_000
const STAGE_MS = 2600
const STAGES: DiscoveryStage[] = ["propose", "confirm", "scan", "judge", "import"]
const IMPORT_MS = 7000

type Page = { k: string; pageId: string; name: string; rel: CompetitorRelation | null; score: number; reason: string; ads: number; domain: string; likes: number }
const PAGES: Page[] = [
  { k: "A", pageId: "mock-page-1", name: "Nightfold", rel: "DIRECT", score: 92, reason: "Vende lençol que refresca pra quem acorda com calor, pro mesmo público e na mesma faixa de preço da sua oferta.", ads: 10, domain: "nightfold.com", likes: 48200 },
  { k: "B", pageId: "mock-page-2", name: "Lull & Co", rel: "DIRECT", score: 88, reason: "Edredom e lençol premium pra casais, com o mesmo gancho de dormir melhor.", ads: 8, domain: "lullandco.com", likes: 21900 },
  { k: "C", pageId: "mock-page-3", name: "Softwake", rel: "DIRECT", score: 81, reason: "Fronha de seda vendida com promessa de sono e pele, pro mesmo público.", ads: 7, domain: "softwake.co", likes: 12400 },
  { k: "D", pageId: "mock-page-4", name: "Hush Linen", rel: "DIRECT", score: 74, reason: "Lençol de linho com teste de 100 noites: mesmo produto, mesmo público.", ads: 6, domain: "hushlinen.com", likes: 6100 },
  { k: "E", pageId: "mock-page-5", name: "Duskwear", rel: "ADJACENT", score: 68, reason: "Pijama térmico pro mesmo público que dorme mal; é o produto vizinho ao seu (roupa de dormir × roupa de cama).", ads: 5, domain: "duskwear.com", likes: 9800 },
  { k: "F", pageId: "mock-page-6", name: "Pillowy", rel: "ADJACENT", score: 61, reason: "Travesseiro ajustável pro mesmo público; produto vizinho.", ads: 4, domain: "pillowy.com", likes: 3300 },
  { k: "G", pageId: "mock-page-7", name: "Restwell", rel: "DIRECT", score: 58, reason: "Lençol de bambu pro mesmo público; só 1 anúncio ativo visto.", ads: 1, domain: "restwell.co", likes: 800 },
  { k: "J", pageId: "mock-page-10", name: "Calmbed", rel: "DIRECT", score: 79, reason: "Kit de cama 'durma fresco' com o mesmo público e a mesma promessa.", ads: 5, domain: "calmbed.com", likes: 15200 },
  { k: "K", pageId: "mock-page-11", name: "Slumberly", rel: "DIRECT", score: 72, reason: "Lençol de algodão egípcio com teste em casa, mesmo público.", ads: 4, domain: "slumberly.com", likes: 7400 },
]
const pageOf = (k: string) => PAGES.find((p) => p.k === k)!

// ── ads: 10 shapes reused per Page (text from the mockup; `cap` is the hook on the poster)
const SHAPES = [
  { days: 214, coll: 9, fmt: "VIDEO", dur: 41, head: "Sleep cooler tonight", text: "I tried everything for 3am wake-ups. Then I swapped my sheets.\nOur cooling bamboo set drops your skin temp by 2°F while you sleep.\n\n100-night trial. Free returns.", cta: "Shop now" },
  { days: 131, coll: 6, fmt: "VIDEO", dur: 28, head: "Dual-weight duvet", text: "POV: your partner steals the blanket. Two sides, two temperatures. The dual-weight duvet ends the blanket war.", cta: "Learn more" },
  { days: 96, coll: 4, fmt: "IMAGE", dur: null, head: "The internet's favorite sheets", text: "12,000 five-star reviews can't all be wrong. Meet the set everyone's switching to.", cta: "Shop now" },
  { days: 63, coll: 2, fmt: "VIDEO", dur: 19, head: "Silk pillowcase, 22 momme", text: "A dermatologist told me to do this before bed. My skin and my sleep both changed.", cta: "Shop now" },
  { days: 41, coll: 7, fmt: "DCO", dur: 33, head: "Hotel-grade percale", text: "We asked 5-star hotels where their sheets come from. Then we made them for half the price.", cta: "Shop now" },
  { days: 22, coll: 1, fmt: "IMAGE", dur: null, head: "Fall sale", text: "Our biggest sale of the fall. 30% off every set until Sunday at midnight.", cta: "Shop now" },
  { days: 9, coll: 3, fmt: "VIDEO", dur: 24, head: "Try it 100 nights", text: "What 3 nights in bamboo did to my skin. Day 1 vs day 3. No filter, no makeup.", cta: "Shop now" },
  { days: 5, coll: 1, fmt: "VIDEO", dur: 15, head: "Unboxing the softest duvet", text: "It arrives vacuum packed and fluffs up in an hour.", cta: "Shop now" },
  { days: 58, coll: 2, fmt: "IMAGE", dur: null, head: "Cooling bamboo", text: "Night sweats? It might be your sheets.", cta: "Shop now", stoppedAgo: 37 },
  { days: 172, coll: null, fmt: "VIDEO", dur: 37, head: "Why hot sleepers switch", text: "If you kick the covers off every night, read this. Three reasons hot sleepers switch to us.", cta: "Learn more" },
] as const
const PLATS: LibraryAdPlatform[][] = [["FACEBOOK", "INSTAGRAM"], ["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK"], ["INSTAGRAM"], ["FACEBOOK"], ["FACEBOOK", "INSTAGRAM", "THREADS"]]

type MAd = { id: string; pageK: string; i: number }
function allAds(): MAd[] {
  return PAGES.flatMap((p) => Array.from({ length: p.ads }, (_, i) => ({ id: `rad_${p.k.toLowerCase()}${i + 1}`, pageK: p.k, i })))
}
const adById = (id: string) => allAds().find((a) => a.id === id) ?? null

// ── state
type MComp = { id: string; k: string; status: "ACTIVE" | "DISMISSED" | "RETIRED"; createdAt: number; importUntil: number; syncUntil: number; lastSync: number; refreshAt: number | null; dismissedAt: number | null; dismissReason: DismissReason | null; name: string }
type MDisc = { id: string; trigger: DiscoveryTrigger; startedAt: number; result: "SUCCEEDED" | "EMPTY" | "FAILED"; followed: number; reserved: number; applied: boolean }
type St = { comps: MComp[]; reserve: string[]; discs: MDisc[]; saved: string[]; refreshing: Record<string, number>; stored: string[]; lastManual: number | null }
const fresh = (): St => ({ comps: [], reserve: [], discs: [], saved: [], refreshing: {}, stored: [], lastManual: null })
let S: St | null = null
function st(): St {
  if (S) return S
  try {
    const raw = localStorage.getItem(KEY)
    S = raw ? (JSON.parse(raw) as St) : fresh()
  } catch {
    S = fresh()
  }
  return S
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(st()))
  } catch {}
}
const flag = () => (typeof window !== "undefined" ? sessionStorage.getItem(FLAG) : null)
let handledHref: string | null = null
function captureFlag() {
  if (typeof window === "undefined") return
  const v = new URLSearchParams(window.location.search).get("radar")
  // once per page load (the status polls every 3 s; a reset on each poll would restart the search forever)
  if (!v || handledHref === window.location.href) return
  handledHref = window.location.href
  if (v === "reset") {
    S = fresh()
    save()
    sessionStorage.removeItem(FLAG)
  } else if (v === "on") sessionStorage.removeItem(FLAG)
  else if (v === "ready") {
    // skip the wait: the 1st discovery already ran a day ago
    sessionStorage.removeItem(FLAG)
    S = fresh()
    const t = Date.now() - DAY
    startDiscovery("ONBOARDING", t)
    applyDone(st().discs[0], t + STAGE_MS * STAGES.length)
    st().comps.forEach((c) => {
      c.importUntil = 0
      c.syncUntil = 0
    })
    save()
    sessionStorage.removeItem(FLAG)
  } else {
    sessionStorage.setItem(FLAG, v)
    // these two only mean something on a search that starts now
    if (v === "empty" || v === "failed" || v === "sample") {
      S = fresh()
      save()
    }
  }
}
const roleOf = (r: Request) => (typeof window !== "undefined" && sessionStorage.getItem("mock:role")) || mockWorkspaceOf(r.headers.get("Authorization")).role
const readOnly = (r: Request) => roleOf(r) === "CLIENT"
const forbidden = () => fail("FORBIDDEN", 403, "Clients can only look.")

const MAX = 5
const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`

function startDiscovery(trigger: DiscoveryTrigger, at = Date.now()) {
  const f = flag()
  const d: MDisc = { id: rid("dsc"), trigger, startedAt: at, result: f === "empty" ? "EMPTY" : f === "failed" ? "FAILED" : "SUCCEEDED", followed: 0, reserved: 0, applied: false }
  st().discs.unshift(d)
  if (trigger === "MANUAL") st().lastManual = at
  return d
}
const slowFactor = () => (flag() === "slow" ? 4 : 1)
function runningStage(d: MDisc, now = Date.now()): DiscoveryStage | null {
  const i = Math.floor((now - d.startedAt) / (STAGE_MS * slowFactor()))
  return i < STAGES.length ? STAGES[i] : null
}
const blocked = () => new Set(st().comps.filter((c) => c.status === "DISMISSED").map((c) => c.k))
const followedKs = () => new Set(st().comps.filter((c) => c.status === "ACTIVE").map((c) => c.k))
/** C.2 order: DIRECT before ADJACENT, then score */
const order = (ks: string[]) => [...ks].sort((a, b) => (pageOf(a).rel === pageOf(b).rel ? pageOf(b).score - pageOf(a).score : pageOf(a).rel === "DIRECT" ? -1 : 1))
function follow(k: string, at: number) {
  const ex = st().comps.find((c) => c.k === k)
  if (ex) return ex
  const c: MComp = { id: `cmp_${k.toLowerCase()}`, k, status: "ACTIVE", createdAt: at, importUntil: at + IMPORT_MS, syncUntil: at + IMPORT_MS, lastSync: at + IMPORT_MS, refreshAt: null, dismissedAt: null, dismissReason: null, name: pageOf(k).name }
  st().comps.push(c)
  return c
}
function applyDone(d: MDisc, at: number) {
  if (d.applied) return
  d.applied = true
  if (d.result !== "SUCCEEDED") return save()
  const no = blocked()
  const pool = d.trigger === "MANUAL" || st().discs.length > 1 ? ["A", "B", "C", "D", "E", "F", "G", "J", "K"] : ["A", "B", "C", "D", "E", "F", "G"]
  const approved = pool.filter((k) => !no.has(k) && !followedKs().has(k))
  const multi = order(approved.filter((k) => pageOf(k).ads >= 2))
  let open = (flag() === "sample" ? 1 : MAX) - followedKs().size
  // fill with direct first, adjacent only if direct is missing; a Page with 1 ad goes only to the reserve
  const direct = multi.filter((k) => pageOf(k).rel === "DIRECT")
  const adj = multi.filter((k) => pageOf(k).rel === "ADJACENT")
  const take = [...direct, ...adj].slice(0, Math.max(0, open))
  take.forEach((k) => follow(k, at))
  open -= take.length
  // the reserve: new ones first (J/K land on top), then the remembered ones (MEMORY)
  const rest = approved.filter((k) => !take.includes(k))
  const fresh = order(rest.filter((k) => !st().reserve.includes(k)))
  const mem = order(rest.filter((k) => st().reserve.includes(k)))
  st().reserve = [...fresh, ...mem].slice(0, 10)
  d.followed = take.length
  d.reserved = st().reserve.length
  save()
}
/** advance time: finished discovery → apply once */
function tick() {
  const d = st().discs[0]
  if (d && !d.applied && !runningStage(d)) applyDone(d, d.startedAt + STAGE_MS * STAGES.length * slowFactor())
}

// ── views
const now = () => Date.now()
const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString())
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)
const media = (pageI: number, i: number) => ({ url: `/mock/art-${pageI % 4}-${i % 4}.svg`, mimeType: "image/svg+xml", width: 1080, height: 1920 })
const avatar = () => null
function compView(c: MComp): Competitor {
  const p = pageOf(c.k)
  const t = now()
  const importing = c.importUntil > t
  const syncing = c.syncUntil > t
  const err = flag() === "error" && c.k === "C"
  const cards = adsOf(c.k).map(cardOf)
  const active = cards.filter((a) => a.isActive)
  return {
    id: c.id, name: c.name, status: c.status, origin: "DISCOVERED", relation: p.rel ?? "DIRECT", nicheScore: p.score, reason: p.reason,
    source: { pageId: p.pageId, countryCode: "US", displayName: p.name, avatar: avatar(), likeCount: p.likes, adLibraryUrl: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=${p.pageId}` },
    domain: p.domain,
    counts: { active: importing ? Math.max(1, Math.ceil(active.length / 2)) : active.length, winners: cards.filter((a) => a.tier === "winner").length, new7d: cards.filter((a) => a.tier === "new").length, stopped30d: cards.filter((a) => !a.isActive).length },
    activeIsLowerBound: importing,
    sync: err
      ? { id: "rsy_err", trigger: "SCHEDULED", status: "FAILED", adsActive: 0, adsNew: 0, adsStopped: 0, errorCode: "AD_LIBRARY_UNAVAILABLE", failReason: null, startedAt: iso(t - 3_600_000), finishedAt: iso(t - 3_500_000) }
      : syncing
        ? { id: `rsy_${c.id}`, trigger: importing ? "INITIAL" : "MANUAL", status: "RUNNING", adsActive: 0, adsNew: 0, adsStopped: 0, errorCode: null, failReason: null, startedAt: iso(c.createdAt), finishedAt: null }
        : { id: `rsy_${c.id}`, trigger: "INITIAL", status: "SUCCEEDED", adsActive: active.length, adsNew: active.length, adsStopped: 0, errorCode: null, failReason: null, startedAt: iso(c.lastSync - 30_000), finishedAt: iso(c.lastSync) },
    lastValidSyncAt: err ? iso(t - DAY - 3_600_000) : syncing && importing ? null : iso(Math.min(c.lastSync, t)),
    nextSyncAt: iso(nextMonday()),
    refreshAvailableAt: c.refreshAt && c.refreshAt > t ? iso(c.refreshAt) : null,
    lastSyncSuspect: false,
    autoSyncPausedByCap: flag() === "cap",
    dismissedAt: iso(c.dismissedAt), dismissReason: c.dismissReason,
    createdAt: iso(c.createdAt)!,
  }
}
function nextMonday() {
  const d = new Date()
  d.setUTCHours(6, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7))
  return d.getTime()
}
const adsOf = (k: string) => allAds().filter((a) => a.pageK === k)
const pageIndex = (k: string) => PAGES.findIndex((p) => p.k === k)
function cardOf(a: MAd): ResearchAdCard {
  const p = pageOf(a.pageK)
  const sh = SHAPES[(a.i + pageIndex(a.pageK)) % SHAPES.length]
  const pi = pageIndex(a.pageK)
  const days = Math.max(1, sh.days - pi * 3)
  const stoppedAgo = "stoppedAgo" in sh ? sh.stoppedAgo : null
  const isActive = stoppedAgo == null
  const start = now() - (days + (stoppedAgo ?? 0)) * DAY
  const fmt = sh.fmt as LibraryAdFormat
  const hasVideo = fmt === "VIDEO" || fmt === "DCO"
  const expired = a.id === "rad_b1" && !st().stored.includes(a.id)
  const refreshing = (st().refreshing[a.id] ?? 0) > now()
  const status = !hasVideo ? "none" : refreshing ? "refreshing" : expired ? "expired" : st().stored.includes(a.id) || st().saved.includes(a.id) ? "stored" : "remote"
  const coll = sh.coll
  const tier: ResearchAdTier = !isActive ? "stopped" : days >= 30 || (coll ?? 0) >= 5 ? "winner" : days >= 7 ? "testing" : "new"
  const comp = st().comps.find((c) => c.k === a.pageK)
  return {
    id: a.id, adArchiveId: `11874420${String(9931 + pi * 37 + a.i).padStart(6, "0")}`,
    adLibraryUrl: `https://www.facebook.com/ads/library/?id=11874420${String(9931 + pi * 37 + a.i).padStart(6, "0")}`,
    page: { id: p.pageId, name: p.name, avatar: avatar() },
    competitors: comp ? [{ id: comp.id, name: comp.name }] : [],
    format: fmt, hasVideo,
    media: {
      playable: hasVideo && (status === "stored" || status === "remote"), status,
      poster: media(pi, a.i),
      video: hasVideo && (status === "stored" || status === "remote") ? { url: "/mock/render.mp4", mimeType: "video/mp4", width: 360, height: 640 } : null,
      durationSec: sh.dur, expiresAt: status === "remote" ? iso(now() + 3 * DAY) : null,
    },
    primaryText: sh.text.replace("Our cooling", `${p.name}'s cooling`), headline: sh.head, ctaText: sh.cta,
    linkUrl: `https://${p.domain}/`, linkHost: p.domain,
    platforms: PLATS[(a.i + pi) % PLATS.length], language: "en", countryCode: "US",
    startDate: isoDay(start), stoppedAt: stoppedAgo != null ? isoDay(now() - stoppedAgo * DAY) : null,
    isActive, daysRunning: days, tier, killedFast: !isActive && days < 7,
    collationCount: coll, euReach: null, lowImpressions: false,
    saved: st().saved.includes(a.id), usedInBatches: a.id === "rad_a1" ? 2 : 0, usable: hasVideo && status !== "refreshing",
  }
}
function detailOf(a: MAd): ResearchAdDetail {
  const c = cardOf(a)
  return {
    ...c,
    cards: c.format === "DCO" ? [0, 1, 2].map((i) => ({ headline: [c.headline, "Cooler sheets, deeper sleep", "100 nights, free returns"][i], body: null, linkUrl: c.linkUrl, mediaKind: i === 1 ? "IMAGE" : "VIDEO", poster: media(pageIndex(a.pageK), a.i + i) })) : [],
    firstSeenAt: iso(now() - 3 * DAY)!, lastSeenAt: iso(now() - 2 * 3_600_000)!,
    savedNote: null, championId: null,
  }
}
/** visible = ads of followed competitors + saved ones (§7) */
function visibleAds() {
  const ks = followedKs()
  return allAds().filter((a) => ks.has(a.pageK) || st().saved.includes(a.id))
}

function discoveryView(): CompetitorDiscoveryView {
  tick()
  const d = st().discs[0]
  const stage = d && !d.applied ? runningStage(d) : null
  const status: DiscoveryStatus | null = !d ? null : stage ? (now() - d.startedAt < 800 ? "QUEUED" : "RUNNING") : d.result
  const manualAt = st().lastManual ? st().lastManual! + 7 * DAY : null
  return {
    last: d
      ? {
          id: d.id, trigger: d.trigger, status: status!, stage, countryCode: "US", keywords: ["cooling sheets", "sleep hot", "bamboo bedding"],
          candidatesFound: d.applied ? 9 : 0, followed: d.followed, reserved: d.reserved, candidates: [], terms: [], costUsd: null,
          errorCode: d.result === "FAILED" && d.applied ? "PROVIDER_ERROR" : null, failReason: null,
          createdAt: iso(d.startedAt)!, finishedAt: d.applied ? iso(d.startedAt + STAGE_MS * STAGES.length * slowFactor()) : null,
        }
      : null,
    manualAvailableAt: manualAt && manualAt > now() ? iso(manualAt) : null,
    manualAllowed: flag() !== "sample", autoPendingAt: null, estimateUsd: 0.15,
  }
}
function statusView(): ResearchStatus {
  const dv = discoveryView()
  const f = flag()
  return {
    mode: f === "off" ? "off" : "mock", available: f !== "off" && f !== "quota", reason: f === "off" ? "not_configured" : f === "quota" ? "quota" : null,
    retryAfter: f === "quota" ? isoDay(now() + 2 * DAY) : null,
    limits: f === "sample"
      ? { access: "SAMPLE", maxCompetitors: 1, activeCompetitors: followedKs().size, reserveMax: 0, reserveCount: 0, maxAdsPerCompetitor: 100, refreshEveryHours: null, autoSync: false }
      : { access: "PAID", maxCompetitors: MAX, activeCompetitors: followedKs().size, reserveMax: 10, reserveCount: st().reserve.length, maxAdsPerCompetitor: 150, refreshEveryHours: 24, autoSync: true },
    spend: { monthUsd: f === "cap" ? 4 : 0.86, capUsd: 4 },
    discovery: { status: dv.last?.status ?? null, stage: dv.last?.stage ?? null },
    countryCode: "US", winnerDays: 30, winnerVersions: 5, newDays: 7,
  }
}
const capFail = () => fail("SPEND_CAP_EXCEEDED", 409, "Research budget used for this month.", { scope: "research", spentUsd: 4, capUsd: 4, estimateUsd: 0.15 })

/** for the templates mock (TemplateSourceRef.researchAdId): the name of the champion born from the ad */
export function researchAdName(id: string) {
  const a = adById(id)
  return a ? `${pageOf(a.pageK).name} · ${cardOf(a).headline}` : "Competitor ad"
}

export const researchHandlers = [
  http.get(u("/research/status"), async () => {
    captureFlag()
    // the onboarding trigger already queued the 1st discovery: a workspace that never ran one starts it now
    if (!st().discs.length && flag() !== "off") {
      startDiscovery("ONBOARDING")
      save()
    }
    await delay(200)
    return ok(statusView())
  }),
  http.get(u("/research/discovery"), async () => {
    await delay(150)
    return ok(discoveryView())
  }),
  http.post(u("/research/discovery"), async ({ request }) => {
    if (readOnly(request)) return forbidden()
    const f = flag()
    if (f === "sample") return fail("PAYMENT_REQUIRED", 402, "Paid plan.", { reason: "research_tier", unlock: { pieces: 0 } })
    if (f === "cap") return capFail()
    if (f === "quota") return fail("AD_LIBRARY_UNAVAILABLE", 503, "Ad Library at its limit.", { reason: "quota", retryAfter: isoDay(now() + 2 * DAY) })
    const dv = discoveryView()
    if (dv.last && (dv.last.status === "RUNNING" || dv.last.status === "QUEUED")) return fail("INVALID_STATE", 409, "A search is running.", { reason: "discovery_running" })
    if (dv.manualAvailableAt) return fail("RATE_LIMITED", 429, "Once every 7 days.", { retryAfter: dv.manualAvailableAt })
    startDiscovery("MANUAL")
    save()
    await delay(250)
    return ok(discoveryView(), 202)
  }),
  http.get(u("/research/competitors"), async ({ request }) => {
    tick()
    const s = new URL(request.url).searchParams.get("status") ?? "active"
    const want = s === "dismissed" ? "DISMISSED" : s === "retired" ? "RETIRED" : "ACTIVE"
    await delay(flag() === "loading" ? "infinite" : 250)
    const items = st().comps.filter((c) => c.status === want).map(compView)
    return ok({ items })
  }),
  http.post(u("/research/competitors/:id/dismiss"), async ({ params, request }) => {
    if (readOnly(request)) return forbidden()
    const c = st().comps.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Not found.")
    if (c.status !== "ACTIVE") return fail("INVALID_STATE", 409, "Not active.", { reason: "not_active" })
    const b = (await request.json()) as { reason: DismissReason }
    c.status = "DISMISSED"
    c.dismissedAt = now()
    c.dismissReason = b.reason
    const r = st().reserve
    const nextK = r.find((k) => pageOf(k).ads >= 2) ?? r[0] ?? null
    let replacement: Competitor | null = null
    if (nextK) {
      st().reserve = r.filter((k) => k !== nextK)
      replacement = compView(follow(nextK, now()))
    }
    save()
    await delay(300)
    return ok({ dismissed: compView(c), replacement })
  }),
  http.post(u("/research/competitors/:id/restore"), async ({ params, request }) => {
    if (readOnly(request)) return forbidden()
    const c = st().comps.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Not found.")
    if (c.status !== "DISMISSED") return fail("INVALID_STATE", 409, "Not removed.", { reason: "not_dismissed" })
    if (followedKs().size >= MAX) return fail("INVALID_STATE", 409, "No free spot.", { reason: "competitor_limit" })
    c.status = "ACTIVE"
    c.dismissedAt = null
    c.dismissReason = null
    save()
    await delay(250)
    return ok(compView(c))
  }),
  http.post(u("/research/competitors/:id/refresh"), async ({ params, request }) => {
    if (readOnly(request)) return forbidden()
    const c = st().comps.find((x) => x.id === params.id)
    if (!c || c.status !== "ACTIVE") return fail("NOT_FOUND", 404, "Not found.")
    if (flag() === "cap") return capFail()
    if (c.syncUntil > now()) return fail("INVALID_STATE", 409, "Already syncing.", { reason: "sync_running" })
    if (c.refreshAt && c.refreshAt > now()) return fail("RATE_LIMITED", 429, "Once a day.", { retryAfter: iso(c.refreshAt) })
    c.syncUntil = now() + 5000
    c.lastSync = now() + 5000
    c.refreshAt = now() + DAY
    save()
    return ok(compView(c), 202)
  }),
  http.patch(u("/research/competitors/:id"), async ({ params, request }) => {
    if (readOnly(request)) return forbidden()
    const c = st().comps.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Not found.")
    c.name = ((await request.json()) as { name: string }).name
    save()
    return ok(compView(c))
  }),
  http.get(u("/research/ads"), async ({ request }) => {
    tick()
    const q = new URL(request.url).searchParams
    const f = flag()
    await delay(f === "loading" ? "infinite" : 350)
    if (f === "error" && q.get("cursor") === "boom") return fail("INTERNAL_ERROR", 500, "Something broke.")
    const comps = q.getAll("competitorId")
    const formats = q.getAll("format")
    const tiers = q.getAll("tier")
    const langs = q.getAll("language")
    const status = q.get("status") ?? "active"
    const minDays = Number(q.get("minDays") ?? 0)
    const text = (q.get("q") ?? "").toLowerCase()
    const saved = q.get("saved") === "true"
    const hasVideo = q.get("hasVideo")
    let list = visibleAds().map(cardOf)
    if (saved) list = list.filter((a) => a.saved)
    if (comps.length) list = list.filter((a) => a.competitors.some((c) => comps.includes(c.id)))
    if (status === "active") list = list.filter((a) => a.isActive)
    if (status === "inactive") list = list.filter((a) => !a.isActive)
    if (formats.length) list = list.filter((a) => formats.includes(a.format))
    if (hasVideo === "true") list = list.filter((a) => a.hasVideo)
    if (hasVideo === "false") list = list.filter((a) => !a.hasVideo)
    if (tiers.length) list = list.filter((a) => tiers.includes(a.tier))
    if (langs.length) list = list.filter((a) => a.language && langs.includes(a.language))
    if (minDays) list = list.filter((a) => (a.daysRunning ?? 0) >= minDays)
    if (text) list = list.filter((a) => `${a.primaryText} ${a.headline} ${a.page.name}`.toLowerCase().includes(text))
    const sort = q.get("sort") ?? "longest_running"
    const cmp: Record<string, (x: ResearchAdCard, y: ResearchAdCard) => number> = {
      longest_running: (x, y) => Number(y.isActive) - Number(x.isActive) || (x.startDate ?? "").localeCompare(y.startDate ?? ""),
      newest: (x, y) => (y.startDate ?? "").localeCompare(x.startDate ?? ""),
      most_variations: (x, y) => (y.collationCount ?? -1) - (x.collationCount ?? -1),
      eu_reach: () => 0,
    }
    list.sort(cmp[sort] ?? cmp.longest_running)
    const limit = Math.min(60, Number(q.get("limit") ?? 30))
    const offset = Number(q.get("cursor") ?? 0) || 0
    const page: ResearchAdPage = {
      items: list.slice(offset, offset + limit),
      nextCursor: offset + limit < list.length ? String(offset + limit) : null,
      total: list.length, winners: list.filter((a) => a.tier === "winner").length,
    }
    return ok(page)
  }),
  http.get(u("/research/ads/:id"), async ({ params }) => {
    const a = adById(String(params.id))
    if (!a) return fail("NOT_FOUND", 404, "Not found.")
    // a finished "load video" lands in our storage
    const r = st().refreshing[a.id]
    if (r && r <= now()) {
      delete st().refreshing[a.id]
      if (!st().stored.includes(a.id)) st().stored.push(a.id)
      save()
    }
    await delay(200)
    return ok(detailOf(a))
  }),
  http.post(u("/research/ads/:id/media"), async ({ params, request }) => {
    if (readOnly(request)) return forbidden()
    const a = adById(String(params.id))
    if (!a) return fail("NOT_FOUND", 404, "Not found.")
    if (flag() === "cap") return capFail()
    if ((st().refreshing[a.id] ?? 0) > now()) return fail("INVALID_STATE", 409, "Already loading.", { reason: "media_refreshing" })
    st().refreshing[a.id] = now() + 6000
    save()
    return ok(detailOf(a), 202)
  }),
  http.put(u("/research/ads/:id/save"), async ({ params, request }) => {
    if (readOnly(request)) return forbidden()
    const a = adById(String(params.id))
    if (!a) return fail("NOT_FOUND", 404, "Not found.")
    if (!st().saved.includes(a.id)) st().saved.push(a.id)
    save()
    await delay(150)
    return ok(cardOf(a))
  }),
  http.delete(u("/research/ads/:id/save"), async ({ params, request }) => {
    if (readOnly(request)) return forbidden()
    st().saved = st().saved.filter((x) => x !== params.id)
    save()
    await delay(120)
    return new HttpResponse(null, { status: 204 })
  }),
]
