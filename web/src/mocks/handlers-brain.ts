import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type {
  BrainCounts, BrainEdge, BrainEdgeKind, BrainGraph, BrainNeighbor, BrainNode, BrainNodeDetail, BrainNodeField, BrainNodeMeta, BrainOpenTarget, CreativeState, Engine, Offer,
} from "@/lib/api/types"
import { BRAIN_KINDS as BRAIN_NODE_KINDS, CATEGORY_OF as BRAIN_CATEGORY_OF } from "@/lib/brain-graph"
import { mockWorkspaceOf } from "./auth"
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
  if (w.businessType || w.industry || w.market || fresh) {
    add(
      { ...base, id: `business:${wid}`, kind: "business", refId: wid, label: [w.industry ?? "Online business", w.market].filter(Boolean).join(" · "), summary: w.websiteUrl ?? null, weight: 0.5, meta: { kind: "business", setupStep: 1 } },
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

  const offers: Offer[] = fresh ? db.offers.slice(0, 1) : db.offers
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
      [f("offer.name", o.name), f("offer.kind", o.kind), f("offer.language", o.language), f("offer.what", o.what), f("offer.promise", o.promise), f("offer.offerAndPrice", o.offerAndPrice), f("offer.cta", o.cta), f("offer.creatives", creativesOf.get(o.id) ?? 0), f("offer.winners", winnersOf.get(o.id) ?? 0)],
      { route: "offer", id: o.id }
    )
    link(center, oid, "part_of")
    if (o.audience) {
      add({ ...base, id: `audience:${o.id}`, kind: "audience", refId: o.id, label: cut(o.audience, 60)!, summary: cut(o.pains, 200), weight: 0.5, meta: { kind: "audience", setupStep: 4 } },
        [f("offer.audience", o.audience), f("offer.pains", o.pains)], { route: "setup", step: 4 })
      link(oid, `audience:${o.id}`, "targets")
    }
    if (o.proof) {
      add({ ...base, id: `proof:${o.id}`, kind: "proof", refId: o.id, label: cut(`Proof · ${o.proof}`, 60)!, summary: cut(o.proof, 200), weight: 0.5, meta: { kind: "proof", setupStep: 3 } },
        [f("offer.proof", o.proof)], { route: "setup", step: 3 })
      link(oid, `proof:${o.id}`, "uses_proof")
    }
    if (o.notes) {
      add({ ...base, id: `instructions:${o.id}`, kind: "instructions", refId: o.id, label: cut(`Voice · ${o.notes}`, 60)!, summary: cut(o.notes, 200), weight: 0.5, meta: { kind: "instructions", setupStep: 4 } },
        [f("offer.notes", o.notes)], { route: "setup", step: 4 })
      link(oid, `instructions:${o.id}`, "instructed_by")
    }
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
