import type { BrainCategory, BrainEdge, BrainEdgeKind, BrainGraph, BrainNode, BrainNodeKind } from "@/lib/api/types"

/*
 * Brain 3D v1 (docs/contratos/brain-3d-v1.md + design/brain-3d-2026-10-22.md): pure graph helpers shared by the globe,
 * the List view, the drawer and the MSW mock. No three.js here (the 3D engine lives only in components/brain/brain-globe).
 * @maquina/contratos is types-only, so the runtime constants are mirrored here and checked against the types with `satisfies`.
 */
export const BRAIN_KINDS = [
  "workspace", "business", "offer", "audience", "proof", "instructions", "goal", "hook", "script", "creative", "meta_ad",
] as const satisfies readonly BrainNodeKind[]
export const CATEGORY_OF = {
  workspace: "center", business: "business", proof: "business", instructions: "business",
  offer: "offers", audience: "audience", goal: "goals", hook: "hooks", script: "scripts", creative: "creatives", meta_ad: "meta_ads",
} as const satisfies Record<BrainNodeKind, BrainCategory>

export type Cat = Exclude<BrainCategory, "center">
/** Ruler order (mockup CATS) */
export const CATS: readonly Cat[] = ["business", "offers", "audience", "goals", "hooks", "scripts", "creatives", "meta_ads"]
/** Data colors, on the dark stage only (spec §2.2/§3). The center is the lime client orb. */
export const CAT_COLOR: Record<BrainCategory, string> = {
  center: "#C8F03C", business: "#E6E1D3", offers: "#F2B33D", audience: "#4CC9B0", goals: "#9AA8FF",
  hooks: "#FF8466", scripts: "#C7A4F5", creatives: "#6FC8F2", meta_ads: "#F27BA8",
}
export const LIME = "#C8F03C"

export interface GNode extends BrainNode {
  /** extra search text, lowercase (the creative's other name, see creativeNames) */
  aka: string
  deg: number
  /** growth order 0..1 (BFS from the client) */
  born: number
  x?: number; y?: number; z?: number
  fx?: number; fy?: number; fz?: number
}
export interface GLink {
  source: string | GNode
  target: string | GNode
  kind: BrainEdgeKind
  publication?: BrainEdge["publication"]
  /** drawn when nothing is selected (short links + 1 in 29, like the skill) */
  quiet: boolean
}
export interface Adj { id: string; kind: BrainEdgeKind; link: GLink }
export interface BrainIndex {
  nodes: GNode[]
  links: GLink[]
  byId: Map<string, GNode>
  adj: Map<string, Adj[]>
  /** one label per category while idle: the highest degree, winner first */
  hubs: Set<string>
  /** winners and what made them (2 hops), for the "Winners" chip */
  winnerSet: Set<string>
  centerId: string | null
  byCat: Map<BrainCategory, GNode[]>
}

/*
 * Creative names (QA 23/10): the node shows the name the person gave the creative and falls back to the Meta ad name only
 * when there is none; search matches both, so the creative and the ad published from it stop sharing one label.
 * GET /brain/graph sends `label` (= name, falling back to adName; api brain.montagem creativeLabel) plus `meta.name` and
 * `meta.adName` on the creative meta.
 */
type CreativeNameFields = { name?: string | null; adName?: string | null }
const clean = (v: string | null | undefined) => (v && v.trim() ? v.replace(/\s+/g, " ").trim() : null)
export function creativeNames(n: Pick<BrainNode, "label" | "meta">): { label: string; aka: string } {
  if (n.meta.kind !== "creative") return { label: n.label, aka: "" }
  const m = n.meta as typeof n.meta & CreativeNameFields
  const name = clean(m.name)
  const adName = clean(m.adName)
  const label = name ?? adName ?? n.label
  const cut = label.length > 80 ? `${label.slice(0, 79).trimEnd()}…` : label
  return { label: cut, aka: [name, adName, n.label].filter((v): v is string => !!v && v !== label).join(" ").toLowerCase() }
}
/** Display label of any node (drawer, neighbors): the creative's own name first. */
export const nodeLabel = (n: Pick<BrainNode, "label" | "meta">) => creativeNames(n).label

/** What search looks at: label + the other creative name + summary + hook angle. */
export const searchText = (n: GNode) => `${n.label} ${n.aka} ${n.summary ?? ""} ${n.meta.kind === "hook" ? (n.meta.angle ?? "") : ""}`.toLowerCase()

export const endId = (v: string | GNode) => (typeof v === "string" ? v : v.id)

/** Deterministic globe layout (composeGlobe of the skill, radii of the mockup): one sector per category, center at 0. */
function layout(nodes: GNode[]) {
  CATS.forEach((cat, sector) => {
    const list = nodes.filter((n) => n.category === cat).sort((a, b) => a.id.localeCompare(b.id))
    list.forEach((n, i) => {
      const y = 1 - 2 * ((i + 0.5) / list.length)
      const turn = (i * 0.61803398875) % 1
      const a = ((sector + 0.08 + turn * 0.84) / CATS.length) * Math.PI * 2
      const base = cat === "business" || cat === "goals" ? 250 : cat === "offers" || cat === "audience" ? 300 : 360
      const radius = base + 90 * ((i * 0.754877666) % 1)
      const hz = Math.sqrt(Math.max(0, 1 - y * y))
      n.x = n.fx = radius * hz * Math.sin(a)
      n.y = n.fy = radius * y * 0.92
      n.z = n.fz = radius * hz * Math.cos(a)
    })
  })
  for (const n of nodes) if (n.category === "center") n.x = n.fx = n.y = n.fy = n.z = n.fz = 0
}

export function indexGraph(g: BrainGraph): BrainIndex {
  const nodes: GNode[] = g.nodes.map((n) => ({ ...n, ...creativeNames(n), deg: 0, born: 1 }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const adj = new Map<string, Adj[]>(nodes.map((n) => [n.id, []]))
  const links: GLink[] = []
  for (const e of g.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    const l: GLink = { source: e.from, target: e.to, kind: e.kind, publication: e.publication, quiet: false }
    links.push(l)
    adj.get(e.from)!.push({ id: e.to, kind: e.kind, link: l })
    adj.get(e.to)!.push({ id: e.from, kind: e.kind, link: l })
  }
  for (const n of nodes) n.deg = adj.get(n.id)!.length
  layout(nodes)
  links.forEach((l, i) => {
    const a = byId.get(endId(l.source))!
    const b = byId.get(endId(l.target))!
    const d = Math.hypot(a.x! - b.x!, a.y! - b.y!, a.z! - b.z!)
    l.quiet = links.length < 120 || d < 220 || i % 29 === 0
  })
  const centerId = nodes.find((n) => n.category === "center")?.id ?? null
  // growth order: BFS from the client, disconnected pieces after
  const seen = new Set<string>()
  const order: string[] = []
  const bfs = (start: string) => {
    let q = [start]
    seen.add(start)
    order.push(start)
    while (q.length) {
      const nx: string[] = []
      for (const id of q)
        for (const e of [...adj.get(id)!].sort((a, b) => byId.get(b.id)!.deg - byId.get(a.id)!.deg))
          if (!seen.has(e.id)) {
            seen.add(e.id)
            order.push(e.id)
            nx.push(e.id)
          }
      q = nx
    }
  }
  if (centerId) bfs(centerId)
  for (const n of nodes) if (!seen.has(n.id)) bfs(n.id)
  order.forEach((id, i) => (byId.get(id)!.born = order.length > 1 ? i / (order.length - 1) : 0))

  const byCat = new Map<BrainCategory, GNode[]>()
  for (const n of nodes) byCat.set(n.category, [...(byCat.get(n.category) ?? []), n])
  const hubs = new Set<string>()
  for (const c of CATS) {
    const top = (byCat.get(c) ?? []).toSorted((a, b) => (b.winner ? 100 : 0) + b.deg - ((a.winner ? 100 : 0) + a.deg))[0]
    if (top) hubs.add(top.id)
  }
  // winners and what made them: the winner, its non-ad neighbors, and (from a creative/hook) its script/offer/hook
  const winnerSet = new Set<string>(centerId ? [centerId] : [])
  for (const w of nodes.filter((n) => n.winner)) {
    winnerSet.add(w.id)
    for (const e of adj.get(w.id)!) {
      const o = byId.get(e.id)!
      if (o.category === "meta_ads") continue
      winnerSet.add(o.id)
      if (o.category === "creatives" || o.category === "hooks" || o.category === "scripts")
        for (const e2 of adj.get(o.id)!) {
          const o2 = byId.get(e2.id)!
          if (o2.category === "scripts" || o2.category === "offers" || o2.category === "hooks") winnerSet.add(o2.id)
        }
    }
  }
  return { nodes, links, byId, adj, hubs, winnerSet, centerId, byCat }
}

export interface Filter { cats: ReadonlySet<Cat>; winners: boolean }
export function isVisible(n: GNode, f: Filter, ix: BrainIndex) {
  if (n.category === "center") return true
  if (!f.cats.has(n.category)) return false
  return !f.winners || ix.winnerSet.has(n.id)
}

/** Search over searchText (both creative names included); prefix matches first, then degree. */
export function searchNodes(ix: BrainIndex, q: string, limit = 8): GNode[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return ix.nodes
    .filter((n) => searchText(n).includes(s))
    .sort((a, b) => (b.label.toLowerCase().startsWith(s) ? 50 : 0) + b.deg - ((a.label.toLowerCase().startsWith(s) ? 50 : 0) + a.deg))
    .slice(0, limit)
}

/** Order inside a category (List, gallery): winners first, then spend, then degree. */
export function rank(a: GNode, b: GNode) {
  const sp = (n: GNode) => (n.meta.kind === "meta_ad" ? n.meta.spend30d : 0)
  return Number(b.winner) - Number(a.winner) || sp(b) - sp(a) || b.deg - a.deg || a.label.localeCompare(b.label)
}

/** The offer a creative/ad belongs to (gallery filter). */
export function offerOfNode(ix: BrainIndex, n: GNode): string | null {
  if (n.meta.kind === "creative") return `offer:${n.meta.offerId}`
  const e = ix.adj.get(n.id)?.find((x) => x.kind === "for_offer" && ix.byId.get(x.id)?.kind === "offer")
  return e?.id ?? null
}

/** The hook text that opens a creative/ad (gallery caption, ad drawer "Hook"). */
export function hookOfNode(ix: BrainIndex, n: GNode): GNode | null {
  const hookNeighbor = (id: string) => ix.adj.get(id)?.map((e) => ix.byId.get(e.id)!).find((o) => o.kind === "hook") ?? null
  if (n.kind === "meta_ad") {
    const direct = hookNeighbor(n.id)
    if (direct) return direct
    const c = ix.adj.get(n.id)?.find((e) => e.kind === "published_as")
    return c ? hookOfNode(ix, ix.byId.get(c.id)!) : null
  }
  if (n.kind === "creative") {
    const s = ix.adj.get(n.id)?.find((e) => e.kind === "made_from")
    return s ? hookNeighbor(s.id) : null
  }
  return null
}

/** Gallery items: creatives with a render (approved / in review) and video Meta ads. */
export function isMediaNode(n: GNode) {
  return (n.meta.kind === "creative" && n.meta.status !== "draft") || (n.meta.kind === "meta_ad" && n.meta.isVideo)
}

export function hexA(hex: string, a: number) {
  const x = hex.replace("#", "")
  return `rgba(${parseInt(x.slice(0, 2), 16)},${parseInt(x.slice(2, 4), 16)},${parseInt(x.slice(4, 6), 16)},${a})`
}

/** The globe needs WebGL; without it (or with prefers-reduced-data) the Brain opens as the List (spec §5). */
export function canDraw3D() {
  if (typeof window === "undefined") return true
  if (window.matchMedia?.("(prefers-reduced-data: reduce)").matches) return false
  if (new URLSearchParams(window.location.search).get("webgl") === "off") return false
  try {
    const c = document.createElement("canvas")
    return !!(c.getContext("webgl2") || c.getContext("webgl"))
  } catch {
    return false
  }
}
