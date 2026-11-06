import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type {
  BrainCounts, BrainEdge, BrainEdgeKind, BrainGraph, BrainNeighbor, BrainNode, BrainNodeDetail, BrainNodeField, BrainNodeMeta, BrainOfferFieldKey, BrainOpenTarget, BrandAsset, CreativeState, Engine,
  FieldOrigin, Offer, OfferReadMeta, PageRole, ReadPageRef,
} from "@/lib/api/types"
import { BRAIN_KINDS as BRAIN_NODE_KINDS, CATEGORY_OF as BRAIN_CATEGORY_OF } from "@/lib/brain-graph"
import { mockWorkspaceOf } from "./auth"
import { kitOf } from "./handlers-brand-kit"
import { db } from "./db"
import { metaOf, selectedOf } from "./handlers-meta"
import { scenario } from "./scenario"
import { adRows, metaFlag } from "./v2"

/*
 * Brain 3D v1 mock (docs/contratos/brain-3d-v1.md §1-2): GET /brain/graph and GET /brain/node/:id built from the mock db
 * (workspace, offers, creatives) + the Meta mock ads + a deterministic "history" of hooks/scripts/creatives so the globe has
 * the density of a client that has been working for a while. Example data, never real performance.
 * States: ?mock=empty (or a new client ws_new_*) = only the setup · ?mock=loading · ?mock=error (500) ·
 * ?metamock=off = no Meta (enabled false) · ?metamock=trunc = truncated counts.
 */
const u = (p: string) => API_URL + p
const ok = <D,>(data: D) => HttpResponse.json({ success: true, data })
const fail = (code: string, statusCode: number, message: string) => HttpResponse.json({ success: false, error: { code, message, statusCode } }, { status: statusCode })

interface Built {
  graph: BrainGraph
  detail: Map<string, { fields: BrainNodeField[]; media: BrainNodeDetail["media"]; open: BrainOpenTarget | null }>
}

const HOOKS: Record<string, [string, string][]> = {
  of_orbit: [
    ["I found $212 I was paying for nothing", "Outcome"], ["My bank app never told me this", "Mechanism"], ["Payday is gone in a week?", "Problem"],
    ["I cancelled 7 subscriptions in 5 minutes", "Outcome"], ["Spreadsheets didn't work for me either", "Comparison"], ["The $9 that pays for itself", "Risk reversal"],
  ],
  of_quiet: [
    ["3 a.m. and your brain won't stop?", "Problem"], ["I fell asleep without my phone", "Outcome"], ["Melatonin stopped working for me", "Comparison"],
    ["21 days, one audio a night", "Mechanism"], ["11,400 people sleep like this now", "Authority"],
  ],
  of_bright: [
    ["A routine shorter than your coffee", "Outcome"], ["I skipped skincare for 3 years", "Founder story"], ["Ten steps nobody keeps", "Problem"],
    ["A dermatologist on the 5-minute kit", "Authority"],
  ],
}
const STATES: CreativeState[] = ["APPROVED", "APPROVED", "RENDER_READY", "EDIT_PENDING", "APPROVED", "SCRIPTS_READY", "RENDER_READY"]
const statusOf = (s: CreativeState) => (s === "APPROVED" ? "approved" : s === "RENDER_READY" ? "in_review" : "draft") as "approved" | "in_review" | "draft"
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(16).padStart(8, "0") + "0000"
}
const cut = (s: string | null | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n - 1) + "…" : s) : null)

// ───── brain-preenchido-v1 (04/11): the same pure rules as api brain.montagem (dividirItens §2, normalizaUrl §4)
const filled = (v: string | null | undefined): v is string => !!v && v.trim().length > 0
const MAX_ITEMS = 8
const MAX_SOURCES = 12
const MAX_SOURCES_PER_OFFER = 6
const MAX_BRAND_FILES = 8
const OFFER_FIELDS: readonly BrainOfferFieldKey[] = ["what", "promise", "offerAndPrice", "cta"]
const SENTENCE = /(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"“'¿¡])/u
const INLINE_BULLET = /\s+(?:•|-|–|—)\s+|•/
export function splitItems(text: string | null | undefined, max = MAX_ITEMS): string[] {
  if (!filled(text)) return []
  const t = text.replace(/\r\n/g, "\n")
  const lines = t.split("\n").filter((l) => l.trim())
  const bullets = (t.match(/•|\s(?:-|–|—)\s/g) ?? []).length
  const raw = lines.length >= 2 ? lines : t.includes(";") ? t.split(";") : bullets >= 2 ? t.split(INLINE_BULLET) : t.split(SENTENCE)
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of raw) {
    const v = c.replace(/^\s*(?:[-*•·–—]|\d{1,2}[.)])\s+/, "").trim().replace(/[;,]+$/, "").trim()
    if (v.length < 3 || seen.has(norm(v))) continue
    seen.add(norm(v))
    out.push(v)
  }
  return out.length ? out.slice(0, max) : [cut(text, 200)!]
}
/** host without www. + path without the trailing "/" + query; null = not a URL */
function normUrl(url: string): { key: string; host: string } | null {
  try {
    const x = new URL(url)
    if (x.protocol !== "http:" && x.protocol !== "https:") return null
    const host = x.hostname.toLowerCase().replace(/^www\./, "")
    return { key: host + x.pathname.replace(/\/+$/, "") + x.search, host }
  } catch {
    return null
  }
}
/**
 * The sample client's offers don't carry a reading in the fixtures, so the mock gives the first one "main page + 2 quiz
 * steps" and the others their main page (example data, the shape of briefing-leitura-v2 D5).
 */
function readMetaOf(o: Offer, i: number): OfferReadMeta | null {
  if (o.readMeta) return o.readMeta
  if (!o.sourceUrl) return null
  const base = o.sourceUrl.replace(/\/+$/, "")
  const pages: ReadPageRef[] =
    i === 0
      ? [
          { url: `${base}/`, role: "main", via: "http", chars: 8420 },
          { url: `${base}/quiz/2`, role: "quiz_step", via: "rendered", chars: 1180 },
          { url: `${base}/quiz/3`, role: "quiz_step", via: "rendered", chars: 960 },
        ]
      : [{ url: `${base}/`, role: "main", via: "http", chars: 5200 + i * 700 }]
  const main: FieldOrigin[] = [{ role: "main", url: `${base}/` }]
  return {
    readMode: "rendered", pages, imagesRead: i === 0 ? [{ index: 1, src: `${base}/hero.png`, alt: null, kind: "img", widthPx: 1200, heightPx: 800 }] : [],
    fieldOrigins: { what: main, promise: main, cta: main, offerAndPrice: i === 0 ? [{ role: "quiz_step", url: `${base}/quiz/3` }] : main },
    costUsd: 0.02, readAt: new Date(Date.now() - (i + 2) * 86_400_000).toISOString(),
  }
}

function build(req: Request): Built {
  const ref = mockWorkspaceOf(req.headers.get("Authorization"))
  const fresh = ref.id !== db.workspace.id || scenario() === "empty"
  const w = ref.id === db.workspace.id ? db.workspace : { ...db.workspace, ...(db.v2.ws[ref.id] ?? {}), id: ref.id, name: ref.name }
  const wid = w.id
  const nodes: BrainNode[] = []
  const edges: BrainEdge[] = []
  const detail: Built["detail"] = new Map()
  const has = new Set<string>()
  const edgeKeys = new Set<string>()
  const add = (n: Omit<BrainNode, "category">, fields: BrainNodeField[] = [], open: BrainOpenTarget | null = null, media: BrainNodeDetail["media"] = null) => {
    if (has.has(n.id)) return
    has.add(n.id)
    nodes.push({ ...n, category: BRAIN_CATEGORY_OF[n.kind] })
    detail.set(n.id, { fields, media, open })
  }
  const link = (from: string, to: string, kind: BrainEdgeKind, extra: Partial<BrainEdge> = {}) => {
    const k = `${from}|${to}|${kind}`
    if (has.has(from) && has.has(to) && from !== to && !edgeKeys.has(k)) {
      edgeKeys.add(k)
      edges.push({ from, to, kind, ...extra })
    }
  }
  const f = (key: string, value: string | number | null | undefined): BrainNodeField => ({ key, value: value ?? null })
  const base = { winner: false, summary: null as string | null }

  add({ ...base, id: `workspace:${wid}`, kind: "workspace", refId: wid, label: w.name, weight: 1, meta: { kind: "workspace" } }, [f("workspace.name", w.name)])
  const center = `workspace:${wid}`
  const offers: Offer[] = fresh ? db.offers.slice(0, 1) : db.offers

  // brain-preenchido-v1 §1/§3: brand kit (logo, demo videos, the 8 newest files) and the sources (website + pages read)
  const kit = scenario() === "empty" ? { logo: null, files: [], demoVideos: [] } : kitOf(wid)
  const assets: BrandAsset[] = [...(kit.logo ? [kit.logo] : []), ...kit.demoVideos.toReversed(), ...kit.files.toReversed().slice(0, MAX_BRAND_FILES)]
  const website = w.websiteUrl ?? (wid === db.workspace.id && !fresh ? (offers[0]?.sourceUrl ?? null) : null)
  type Src = { id: string; url: string; host: string; isWebsite: boolean; roles: PageRole[]; offers: string[]; readAt: string | null; via: string | null; chars: number | null }
  const sources = new Map<string, Src>()
  const pagesOf = new Map<string, string[]>()
  const source = (url: string, page: ReadPageRef | null, offerId: string | null, readAt: string | null) => {
    const k = normUrl(url)
    if (!k) return null
    const id = `source:${hash(k.key).slice(0, 12)}`
    let src = sources.get(id)
    if (!src) {
      if (sources.size >= MAX_SOURCES) return null
      src = { id, url, host: k.host, isWebsite: !page, roles: [], offers: [], readAt: null, via: page?.via ?? null, chars: page?.chars ?? null }
      sources.set(id, src)
    }
    if (page && !src.roles.includes(page.role)) src.roles.push(page.role)
    if (page) {
      src.via ??= page.via
      src.chars ??= page.chars
    }
    if (offerId && !src.offers.includes(offerId)) src.offers.push(offerId)
    if (readAt && (!src.readAt || readAt > src.readAt)) src.readAt = readAt
    return id
  }
  if (website) source(website, null, null, null)
  const readMetas = new Map(offers.map((o, i) => [o.id, fresh ? (o.readMeta ?? null) : readMetaOf(o, i)]))
  for (const o of offers) {
    const rm = readMetas.get(o.id)
    if (!rm) continue
    const pages = [...rm.pages].sort((a, b) => Number(b.role === "main") - Number(a.role === "main")).slice(0, MAX_SOURCES_PER_OFFER)
    pagesOf.set(o.id, pages.map((pg) => source(pg.url, pg, o.id, rm.readAt)).filter((x): x is string => !!x))
  }

  if (w.businessType || w.industry || w.market || fresh || assets.length > 0 || sources.size > 0) {
    const firstHost = [...sources.values()][0]?.host
    const bizLabel = w.industry || w.market ? [w.industry ?? "Online business", w.market].filter(Boolean).join(" · ") : fresh ? "Online business" : (firstHost ?? w.name)
    add(
      { ...base, id: `business:${wid}`, kind: "business", refId: wid, label: cut(bizLabel, 80)!, summary: w.websiteUrl ?? null, weight: 0.5, meta: { kind: "business", setupStep: 1 } },
      [f("business.businessType", w.businessType ?? "ONLINE_STORE"), f("business.industry", w.industry ?? "Online business"), f("business.market", w.market ?? "US"), f("business.websiteUrl", w.websiteUrl)],
      { route: "setup", step: 1 }
    )
    link(center, `business:${wid}`, "part_of")
  }
  if (w.monthlySpendCapUsd != null || w.defaultResult) {
    add(
      { ...base, id: `goal:${wid}`, kind: "goal", refId: wid, label: w.monthlySpendCapUsd != null ? `Cap $${w.monthlySpendCapUsd.toLocaleString("en-US")} a month` : "Goals", summary: w.defaultResult ? `Result: ${w.defaultResult.toLowerCase()}` : null, weight: 0.5,
        meta: { kind: "goal", setupStep: 5, spendCapUsd: w.monthlySpendCapUsd, defaultResult: w.defaultResult } },
      [f("goal.spendCapUsd", w.monthlySpendCapUsd), f("goal.defaultResult", w.defaultResult)],
      { route: "setup", step: 5 }
    )
    link(center, `goal:${wid}`, "part_of")
  }

  const creativesOf = new Map<string, number>()
  const winnersOf = new Map<string, number>()
  for (const o of offers) {
    const mine = db.creatives.filter((c) => c.offerId === o.id)
    creativesOf.set(o.id, fresh ? 0 : mine.length + (HOOKS[o.id]?.length ?? 0) * 2)
    winnersOf.set(o.id, fresh ? 0 : mine.filter((c) => c.isWinner).length + 1)
  }
  const maxC = Math.max(1, ...creativesOf.values())
  for (const o of offers) {
    const oid = `offer:${o.id}`
    add(
      { ...base, id: oid, kind: "offer", refId: o.id, label: cut(o.name, 80)!, summary: cut(o.promise, 200), weight: Math.max(0.4, (creativesOf.get(o.id) ?? 0) / maxC),
        meta: { kind: "offer", setupStep: 3, creatives: creativesOf.get(o.id) ?? 0, winners: winnersOf.get(o.id) ?? 0 } },
      [f("offer.name", o.name), f("offer.kind", o.kind), f("offer.language", o.language), f("offer.what", o.what), f("offer.promise", o.promise), f("offer.offerAndPrice", o.offerAndPrice), f("offer.cta", o.cta), f("offer.creatives", creativesOf.get(o.id) ?? 0), f("offer.winners", winnersOf.get(o.id) ?? 0), f("offer.imagesRead", readMetas.get(o.id)?.imagesRead.length ?? null)],
      { route: "offer", id: o.id }
    )
    link(center, oid, "part_of")
    const pains = splitItems(o.pains)
    const proofs = splitItems(o.proof)
    if (filled(o.audience) || pains.length) {
      add({ ...base, id: `audience:${o.id}`, kind: "audience", refId: o.id, label: cut(filled(o.audience) ? o.audience : o.name, 80)!, summary: cut(o.pains, 200), weight: 0.5, meta: { kind: "audience", setupStep: 4 } },
        [f("offer.audience", o.audience), f("offer.pains", o.pains)], { route: "setup", step: 4 })
      link(oid, `audience:${o.id}`, "targets")
    }
    if (o.proof) {
      add({ ...base, id: `proof:${o.id}`, kind: "proof", refId: o.id, label: cut(proofs.length >= 2 ? proofs[0] : `Proof · ${o.proof}`, 80)!, summary: cut(o.proof, 200), weight: 0.5, meta: { kind: "proof", setupStep: 3 } },
        [f("offer.proof", o.proof)], { route: "setup", step: 3 })
      link(oid, `proof:${o.id}`, "uses_proof")
    }
    if (o.notes) {
      add({ ...base, id: `instructions:${o.id}`, kind: "instructions", refId: o.id, label: cut(`Voice · ${o.notes}`, 60)!, summary: cut(o.notes, 200), weight: 0.5, meta: { kind: "instructions", setupStep: 4 } },
        [f("offer.notes", o.notes)], { route: "setup", step: 4 })
      link(oid, `instructions:${o.id}`, "instructed_by")
    }
  }

  // brain-preenchido-v1 §1/§5/§6: kit, logo colors and website (after the center), then the detail of each offer
  const biz = `business:${wid}`
  const inGraph = new Set(offers.map((o) => o.id))
  const offerName = (id: string | null) => (id ? (db.offers.find((o) => o.id === id)?.name ?? null) : null)
  // fallback label number = position inside the kind by createdAt asc, from 1 (§1.1)
  const nth = new Map<string, number>()
  const perKind = new Map<string, number>()
  for (const a of assets.toSorted((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    perKind.set(a.kind, (perKind.get(a.kind) ?? 0) + 1)
    nth.set(a.id, perKind.get(a.kind)!)
  }
  const logo = kit.logo
  for (const a of assets) {
    const id = `brand_asset:${a.id}`
    const image = a.file.mimeType.startsWith("image/")
    const video = a.kind === "DEMO_VIDEO"
    const fallback = a.kind === "LOGO" ? "Logo" : a.kind === "FILE" ? `Brand file ${nth.get(a.id)}` : `Demo video ${nth.get(a.id)}`
    add(
      { ...base, id, kind: "brand_asset", refId: a.id, label: cut(a.label?.trim() || fallback, 80)!, summary: offerName(a.offerId), weight: a.kind === "LOGO" ? 0.5 : 0.4,
        meta: { kind: "brand_asset", assetKind: a.kind, customLabel: a.label?.trim() || null, mimeType: a.file.mimeType, offerId: a.offerId, thumbnailUrl: image ? a.file.url : null, durationSec: video ? (a.file.durationSec ?? null) : null, createdAt: a.createdAt } },
      [f("brand.kind", a.kind), f("brand.label", a.label), f("brand.mimeType", a.file.mimeType), f("brand.sizeBytes", (video ? 18_400_000 : a.file.mimeType === "application/pdf" ? 2_350_000 : 184_000)),
        f("brand.durationSec", video ? (a.file.durationSec ?? null) : null), f("brand.colors", a.kind === "LOGO" ? a.colors.join(", ") || null : null), f("brand.offerName", offerName(a.offerId)),
        f("brand.createdAt", a.createdAt), f("brand.downloadUrl", a.file.url)],
      { route: "brand", id: a.id },
      video ? { videoUrl: a.file.url, posterUrl: null } : image ? { videoUrl: null, posterUrl: a.file.url } : null
    )
    if (a.kind !== "LOGO" && a.offerId && inGraph.has(a.offerId)) link(id, `offer:${a.offerId}`, "for_offer")
    else link(biz, id, "has_brand")
  }
  if (logo)
    for (const hex of [...new Set(logo.colors.map((c) => c.toUpperCase()))].slice(0, 5)) {
      const id = `brand_color:${hex.slice(1).toLowerCase()}`
      add({ ...base, id, kind: "brand_color", refId: hex.slice(1).toLowerCase(), label: hex, weight: 0.2, meta: { kind: "brand_color", hex } },
        [f("brand.hex", hex), f("brand.logo", logo.label?.trim() || "Logo")], { route: "brand" })
      link(`brand_asset:${logo.id}`, id, "has_color")
    }
  for (const src of sources.values()) {
    const names = src.offers.map(offerName).filter(Boolean).join(" · ") || null
    add(
      { ...base, id: src.id, kind: "source", refId: src.id.slice(7), label: cut(normUrl(src.url)!.key, 80)!, summary: cut(src.url, 200), weight: src.isWebsite ? 0.45 : 0.3,
        meta: { kind: "source", url: src.url, host: src.host, isWebsite: src.isWebsite, roles: src.roles, offers: src.offers.length, readAt: src.readAt } },
      [f("source.url", src.url), f("source.roles", src.roles.join(",") || null), f("source.via", src.via), f("source.chars", src.chars), f("source.readAt", src.readAt), f("source.offers", names), f("source.isWebsite", src.isWebsite ? 1 : 0)],
      src.isWebsite ? { route: "setup", step: 1 } : { route: "offer", id: src.offers[0] }
    )
    link(biz, src.id, "read_from")
  }
  for (const o of offers) {
    const oid = `offer:${o.id}`
    const origins = readMetas.get(o.id)?.fieldOrigins ?? {}
    for (const key of OFFER_FIELDS) {
      const v = o[key]
      if (!filled(v)) continue
      const id = `offer_field:${o.id}:${key}`
      add({ ...base, id, kind: "offer_field", refId: `${o.id}:${key}`, label: cut(v, 80)!, summary: cut(v, 200), weight: 0.35, meta: { kind: "offer_field", setupStep: 3, offerId: o.id, field: key, from: o.fieldSources[key] ?? null } },
        [f(`offer.${key}`, v), f("offer.readFrom", origins[key] ? JSON.stringify(origins[key]) : null), f("offer.fieldSource", o.fieldSources[key] ?? null), f("offer.offerName", o.name)], { route: "setup", step: 3 })
      link(oid, id, "has_field")
    }
    const pains = splitItems(o.pains)
    pains.forEach((item, index) => {
      const h = hash(norm(item)).slice(0, 12)
      const id = `pain:${o.id}:${h}`
      add({ ...base, id, kind: "pain", refId: `${o.id}:${h}`, label: cut(item, 80)!, summary: cut(item, 200), weight: 0.3, meta: { kind: "pain", setupStep: 4, offerId: o.id, index, of: pains.length } },
        [f("pain.item", item), f("pain.position", index + 1), f("pain.of", pains.length), f("pain.offerName", o.name)], { route: "setup", step: 4 })
      link(`audience:${o.id}`, id, "has_pain")
    })
    const proofs = splitItems(o.proof)
    if (proofs.length >= 2)
      proofs.forEach((item, index) => {
        const h = hash(norm(item)).slice(0, 12)
        const id = `proof_item:${o.id}:${h}`
        add({ ...base, id, kind: "proof_item", refId: `${o.id}:${h}`, label: cut(item, 80)!, summary: cut(item, 200), weight: 0.3, meta: { kind: "proof_item", setupStep: 3, offerId: o.id, index, of: proofs.length } },
          [f("proof.item", item), f("proof.position", index + 1), f("proof.of", proofs.length), f("proof.offerName", o.name)], { route: "setup", step: 3 })
        link(`proof:${o.id}`, id, "has_proof")
      })
    for (const sid of pagesOf.get(o.id) ?? []) link(oid, sid, "read_from")
  }

  const meta = metaOf(req)
  const metaOff = metaFlag() === "off"
  const connected = !metaOff && !fresh && selectedOf(meta)
  const counts = Object.fromEntries(BRAIN_NODE_KINDS.map((k) => [k, { total: 0, shown: 0 }])) as BrainCounts

  if (!fresh) {
    // ───── hooks → scripts → creatives (db creatives first, then the example history)
    const hookUse = new Map<string, { scripts: number; ads: number; angles: Map<string, number>; cpa: number | null }>()
    const hookNode = (text: string, offerId: string, angle: string | null) => {
      const id = `hook:${hash(norm(text))}`
      if (!has.has(id)) {
        add({ ...base, id, kind: "hook", refId: id.slice(5), label: cut(text, 80)!, summary: cut(text, 200), weight: 0.2, meta: { kind: "hook", angle, scripts: 0, ads: 0, bestCpa: null, currency: null } })
        hookUse.set(id, { scripts: 0, ads: 0, angles: new Map(), cpa: null })
      }
      link(id, `offer:${offerId}`, "for_offer")
      if (angle) hookUse.get(id)!.angles.set(angle, (hookUse.get(id)!.angles.get(angle) ?? 0) + 1)
      return id
    }
    let seq = 0
    const creative = (p: { id: string; name: string; offerId: string; state: CreativeState; winner: boolean; engine: Engine | null; dur: number; hook: string; angle: string; letter: string; cost: number; thumb: string; source?: string | null }) => {
      const sid = `script:sc_${p.id}`
      const hid = hookNode(p.hook, p.offerId, p.angle)
      hookUse.get(hid)!.scripts++
      add({ ...base, id: sid, kind: "script", refId: `sc_${p.id}`, label: `Script ${p.letter} · ${cut(p.name, 50)}`, summary: cut(p.hook, 200), weight: 0.3,
        meta: { kind: "script", creativeId: p.id, letter: p.letter, angle: p.angle, durationSec: p.dur, editedByUser: false } },
        [f("script.letter", p.letter), f("script.angle", p.angle), f("script.rationale", `Opens on the ${p.angle.toLowerCase()} angle, then proof and the offer.`), f("script.durationSec", p.dur),
          f("script.blocks", JSON.stringify([
            { label: "Hook", startSec: 0, endSec: 3, speech: p.hook },
            { label: "Problem", startSec: 3, endSec: 9, speech: "Here's what nobody tells you about it." },
            { label: "Proof", startSec: 9, endSec: 18, speech: "Thousands already switched, and the numbers show it." },
            { label: "CTA", startSec: 18, endSec: p.dur, speech: "Tap the link and try it today." },
          ]))],
        { route: "creative", id: p.id, step: "scripts" })
      link(sid, hid, "opens_with")
      link(sid, `offer:${p.offerId}`, "for_offer")
      link(sid, `audience:${p.offerId}`, "speaks_to")
      const cid = `creative:${p.id}`
      const st = statusOf(p.state)
      add({ ...base, id: cid, kind: "creative", refId: p.id, label: cut(p.name, 80)!, summary: null, winner: p.winner, weight: p.winner ? 1 : st === "approved" ? 0.6 : st === "in_review" ? 0.4 : 0.25,
        meta: { kind: "creative", name: p.name, adName: null, state: p.state, status: st, isWinner: p.winner, origin: p.source ? "VARIATION" : "SCRATCH", variationCode: p.source ? "V1" : null, offerId: p.offerId, engine: p.engine, durationSec: p.dur, thumbnailUrl: p.thumb, published: false, sourceMetaAdId: p.source ?? null, sourceCreativeId: null } },
        [f("creative.name", p.name), f("creative.adName", null), f("creative.state", p.state), f("creative.origin", p.source ? "VARIATION" : "SCRATCH"), f("creative.variationCode", p.source ? "V1" : null), f("creative.engine", p.engine), f("creative.durationSec", p.dur), f("creative.costUsd", p.cost), f("creative.iteratedFromMetaAdId", p.source ?? null), f("creative.iteratedFromCreativeId", null)],
        { route: "creative", id: p.id },
        st === "draft" ? null : { videoUrl: "/mock/render.mp4", posterUrl: p.thumb })
      link(cid, sid, "made_from")
      if (p.source) link(cid, `meta_ad:${p.source}`, "iterated_from")
      return cid
    }
    for (const c of db.creatives) {
      if (!offers.some((o) => o.id === c.offerId)) continue
      const s = c.scripts.find((x) => x.id === c.selectedScriptId) ?? c.scripts[0]
      const hook = s?.full?.[0]?.speech ?? s?.blocks?.[0]?.speech
      if (!hook) continue
      creative({ id: c.id, name: c.name, offerId: c.offerId, state: c.state, winner: c.isWinner, engine: c.engine, dur: s?.durationSec ?? 27, hook, angle: s?.angle ?? s?.fullAngle ?? "Problem", letter: s?.letter ?? "A", cost: +c.costUsd.toFixed(2), thumb: `/mock/art-${seq++ % 4}-${seq % 4}.svg` })
    }
    const history: string[] = []
    for (const o of offers) {
      ;(HOOKS[o.id] ?? []).forEach(([hook, angle], i) => {
        const n = i < 2 ? 3 : i < 4 ? 2 : 1
        for (let v = 0; v < n; v++) {
          const k = seq++
          history.push(creative({ id: `cr_h${k}`, name: `${hook.split(" ").slice(0, 4).join(" ")} · v${v + 1}`, offerId: o.id, state: STATES[k % STATES.length], winner: k === 3 || k === 17, engine: k % 2 ? "LIPSYNC" : "SCENES", dur: 18 + (k * 7) % 20, hook, angle, letter: "ABC"[v], cost: +(2 + ((k * 37) % 60) / 10).toFixed(2), thumb: `/mock/art-${k % 4}-${(k >> 1) % 4}.svg` }))
        }
      })
    }

    // ───── Meta ads
    if (connected && meta) {
      const rows = adRows(meta, new Set(meta.iterated ?? []))
      const maxSpend = Math.max(1, ...rows.map((r) => r.metrics.spend))
      const approved = history.filter((id) => nodes.find((n) => n.id === id)?.meta.kind === "creative" && (nodes.find((n) => n.id === id)!.meta as { status: string }).status === "approved")
      const offerIds = offers.map((o) => o.id)
      rows.forEach((r, i) => {
        const id = `meta_ad:${r.metaAdId}`
        const fromHookMill = i === 1 || i === 3
        const m: BrainNodeMeta = { kind: "meta_ad", verdict: r.verdict, trend: r.trend, effectiveStatus: r.effectiveStatus, spend30d: r.metrics.spend, cpa: r.metrics.cpa, ctr: r.metrics.ctr, hookRate: i === 4 ? null : r.metrics.hookRate, currency: "USD",
          daysRunning: r.daysRunning, thumbnailUrl: r.thumbnailUrl, isVideo: i !== 4, fromHookMill, championId: r.championId }
        add({ ...base, id, kind: "meta_ad", refId: r.metaAdId, label: fromHookMill ? `HookMill · ${r.name}` : `MC | ${r.name}`, summary: null, winner: r.verdict === "WINNER", weight: Math.max(r.verdict === "WINNER" ? 0.7 : 0, r.metrics.spend / maxSpend), meta: m },
          [f("meta_ad.name", r.name), f("meta_ad.campaignName", r.campaign.name), f("meta_ad.adsetName", r.adset.name), f("meta_ad.effectiveStatus", r.effectiveStatus), f("meta_ad.verdict", r.verdict), f("meta_ad.trend", r.trend), f("meta_ad.spend30d", r.metrics.spend), f("meta_ad.results", r.metrics.results), f("meta_ad.cpa", r.metrics.cpa), f("meta_ad.ctr", r.metrics.ctr), f("meta_ad.hookRate", m.hookRate), f("meta_ad.daysRunning", r.daysRunning), f("meta_ad.currency", "USD")],
          { route: "campaigns", id: r.metaAdId },
          { videoUrl: fromHookMill || r.championId ? "/mock/render.mp4" : null, posterUrl: r.thumbnailUrl })
        const offerId = offerIds[i % offerIds.length]
        if (fromHookMill && approved[i]) {
          const cnode = nodes.find((n) => n.id === approved[i])!
          if (cnode.meta.kind === "creative") cnode.meta.published = true
          link(approved[i], id, "published_as", { publication: { publicationId: `pub_${i}`, status: r.effectiveStatus === "ACTIVE" ? "ACTIVE" : "PAUSED", publishedAt: r.adCreatedTime, activatedAt: r.adCreatedTime, byName: "Tordan" } })
          link(id, `offer:${offerId}`, "for_offer")
        } else if (i < rows.length - 1) {
          const h = hookNode(r.name, offerId, null)
          link(id, h, "uses_hook")
          link(id, `offer:${offerId}`, "for_offer")
        } else link(center, id, "part_of")
      })
      // the loop of the product: winner → iteration → new creative
      rows.filter((r) => r.verdict === "WINNER").slice(0, 2).forEach((r, i) => {
        const k = seq++
        creative({ id: `cr_it${i}`, name: `Iteration of "${r.name}"`, offerId: offers[i % offers.length].id, state: i ? "APPROVED" : "RENDER_READY", winner: false, engine: "SCENES", dur: 24, hook: r.name, angle: "Comparison", letter: "A", cost: 4.8, thumb: `/mock/art-${k % 4}-1.svg`, source: r.metaAdId })
      })
    }

    // hook stats
    for (const [id, u] of hookUse) {
      const n = nodes.find((x) => x.id === id)!
      const ads = edges.filter((e) => (e.kind === "uses_hook" && e.to === id)).map((e) => nodes.find((x) => x.id === e.from)!)
      const cpas = ads.map((a) => (a.meta.kind === "meta_ad" ? a.meta.cpa : null)).filter((x): x is number => x != null)
      const angle = [...u.angles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      n.meta = { kind: "hook", angle, scripts: u.scripts, ads: ads.length, bestCpa: cpas.length ? Math.min(...cpas) : null, currency: cpas.length ? "USD" : null }
      n.winner = false
      detail.set(id, { fields: [f("hook.text", n.summary), f("hook.angle", angle), f("hook.scripts", u.scripts), f("hook.ads", ads.length), f("hook.bestCpa", n.meta.bestCpa), f("hook.currency", n.meta.currency)], media: null, open: null })
    }
    const maxUse = Math.max(1, ...[...hookUse.values()].map((u) => u.scripts + u.ads))
    for (const [id, u] of hookUse) nodes.find((x) => x.id === id)!.weight = Math.max(0.2, (u.scripts + u.ads) / maxUse)
  }

  for (const n of nodes) {
    counts[n.kind].total++
    counts[n.kind].shown++
  }
  const truncated = metaFlag() === "trunc"
  if (truncated) counts.meta_ad.total = Math.max(640, counts.meta_ad.total)
  return {
    graph: {
      generatedAt: new Date().toISOString(), nodes, edges, counts, truncated,
      meta: { enabled: !metaOff, connected: !!connected, lastSyncAt: connected && meta ? (meta.lastSyncAt ?? new Date(Date.now() - 12 * 60_000).toISOString()) : null },
    },
    detail,
  }
}

async function gate() {
  const s = scenario()
  if (s === "loading") await delay("infinite")
  await delay(350)
  return s === "error" ? fail("INTERNAL_ERROR", 500, "Something went wrong.") : null
}

export const brainHandlers = [
  http.get(u("/brain/graph"), async ({ request }) => {
    const bad = await gate()
    if (bad) return bad
    return ok(build(request).graph)
  }),
  http.get(u("/brain/node/:id"), async ({ request, params }) => {
    await delay(250)
    const id = decodeURIComponent(String(params.id))
    if (!/^[a-z_]+:.+$/.test(id) || !(BRAIN_NODE_KINDS as readonly string[]).includes(id.split(":")[0])) return fail("VALIDATION_ERROR", 400, "Invalid node id.")
    const b = build(request)
    const node = b.graph.nodes.find((n) => n.id === id)
    const d = b.detail.get(id)
    if (!node || !d) return fail("NOT_FOUND", 404, "Not found.")
    const byId = new Map(b.graph.nodes.map((n) => [n.id, n]))
    const neighbors: BrainNeighbor[] = b.graph.edges
      .filter((e) => e.from === id || e.to === id)
      .slice(0, 50)
      .map((e) => {
        const o = byId.get(e.from === id ? e.to : e.from)!
        return { id: o.id, kind: o.kind, category: o.category, label: o.label, edge: e.kind, winner: o.winner }
      })
    const res: BrainNodeDetail = { node, fields: d.fields, neighbors, media: d.media, open: d.open }
    return ok(res)
  }),
]
