import type { CreativeRow } from "@/lib/api/types"

/** A creative opens the wizard on its current step (spec §5 Home); approved ones open in the Library. */
export function creativeHref(c: Pick<CreativeRow, "id" | "step">) {
  return c.step === "library" ? `/library?new=${encodeURIComponent(c.id)}` : `/creatives/${encodeURIComponent(c.id)}/${c.step}`
}

/** Variar campeão (feature 2). The 6 steps; batch-scoped steps carry ?batch=<id>. */
export type VariarStep = "winner" | "teardown" | "variations" | "hooks" | "estimate" | "batch"
export const VARIAR_STEPS: readonly VariarStep[] = ["winner", "teardown", "variations", "hooks", "estimate", "batch"]
export function variarHref(championId: string | null, step: VariarStep, batchId?: string | null) {
  if (!championId) return "/variations/new"
  const base = `/variations/${encodeURIComponent(championId)}/${step}`
  return batchId ? `${base}?batch=${encodeURIComponent(batchId)}` : base
}

/** Variação automática (variacao-auto-v1): /iterate/new, then one route per batch; `view` only to look at a step the phase already passed. */
export type IterateView = "analyze" | "generate" | "download"
export function iterateHref(batchId: string | null, view?: IterateView | null) {
  if (!batchId) return "/iterate/new"
  const base = `/iterate/${encodeURIComponent(batchId)}`
  return view ? `${base}?view=${view}` : base
}

/** templates-creditos-v1: gallery (optionally pinned to one ad), the Ad step of a template, and the batch born from it. */
export type TemplateSource = { metaAdId?: string; championId?: string; creativeId?: string; uploadId?: string; researchAdId?: string }
const sourceQuery = (s: TemplateSource | null | undefined) => {
  if (!s) return ""
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(s)) if (v) q.set(k, v)
  const str = q.toString()
  return str ? `?${str}` : ""
}
/** templates-multi-v1: `picked` = the checked templates (`?t=a,b,c`), so coming back from the Ad step keeps them. */
export function templatesHref(source?: TemplateSource | null, picked?: readonly string[] | null) {
  const q = sourceQuery(source)
  if (!picked?.length) return `/templates${q}`
  return `/templates${q}${q ? "&" : "?"}t=${picked.map(encodeURIComponent).join(",")}`
}
/** templates-multi-v1 §5.2: the Ad step of 2+ checked templates (1 goes to `templateAdHref`). */
export function templateSelectionHref(slugs: readonly string[]) {
  return `/templates/selection?t=${slugs.map(encodeURIComponent).join(",")}`
}
/** `?t=a,b,c` → distinct, non-empty slugs in URL order (unknown ones are dropped by the caller, against the list). */
export function pickedFromParams(sp: Pick<URLSearchParams, "get">): string[] {
  const raw = sp.get("t")
  if (!raw) return []
  return [...new Set(raw.split(",").map((x) => x.trim()).filter((x) => x && x.length <= 64))]
}
export function templateAdHref(slug: string) {
  return `/templates/${encodeURIComponent(slug)}`
}
export function templateRunHref(batchId: string) {
  return `/templates/run/${encodeURIComponent(batchId)}`
}
export const CREDITS_HREF = "/credits"
export const TEMPLATES_ADMIN_HREF = "/templates/admin"
/** the one source (if any) carried in the URL */
export function sourceFromParams(sp: Pick<URLSearchParams, "get">): TemplateSource | null {
  for (const k of ["metaAdId", "championId", "creativeId", "uploadId", "researchAdId"] as const) {
    const v = sp.get(k)
    if (v) return { [k]: v }
  }
  return null
}

/** Ad Radar (ads-research-v1 C.1): the feed; `ad` = the detail Sheet on the same route (`/radar?ad=<id>`). */
export const RADAR_HREF = "/radar"
export function radarHref(ad?: string | null) {
  return ad ? `${RADAR_HREF}?ad=${encodeURIComponent(ad)}` : RADAR_HREF
}
