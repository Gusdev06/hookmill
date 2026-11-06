// Editor universal v1 (docs/contratos/editor-universal-v1.md, F-U1): pure helpers of the web side. The geometry always
// comes from the resolver's `EditLayout` (§5: "layout é a fonte única da geometria"); nothing is re-measured in the DOM.
import type { ComponentType } from "react"
import {
  LIMITES_DOC_V3, Moldura, RemixKeep, checarEdicao, comVideoEditado, exportLiberado, metadadosMoldura, metadadosRemix, resolverPropsHeadline, resolverPropsMoldura,
  type MetadadosPlayer, type MolduraProps, type RemixKeepProps, type TextoEditor,
} from "@maquina/video/player"
import type {
  AutoPieceSource, EditDocLayerV3, EditDocV3, EditIssue, EditLayout, EditLayoutLayer, EditManifest, EditorStateV3, FormatCode, LayerDecl, LayerStyle,
  LayerTransform, Rect, VideoFraming,
} from "@/lib/api/types"

export type DocLayerPatch = Omit<Partial<EditDocLayerV3>, "style" | "id"> & { style?: Partial<LayerStyle> | null }

/** What the resolver gives back, plus the Player inputs. Typed loosely at the boundary (video mirrors the contract types). */
export interface Resolved {
  component: ComponentType<Record<string, unknown>>
  props: Record<string, unknown>
  meta: MetadadosPlayer
  layout: EditLayout
  textos: TextoEditor[]
}

export const FORMAT_LABEL: Record<FormatCode, string> = { "9x16": "9:16", "4x5": "4:5", "1x1": "1:1" }

export const emptyDoc = (): EditDocV3 => ({ version: 3, clips: [], trim: null, layers: [], captionWords: [] })
export const isEmpty = (d: EditDocV3 | null | undefined) =>
  !d || (!d.layers.length && !d.captionWords.length && !Object.keys(d.templateOpts ?? {}).length && !d.video
    && !Object.values(d.items ?? {}).some((x) => x.length) && !(d.clipSwaps ?? []).length && !(d.confirmations ?? []).length
    && !Object.values(d.formatOverrides ?? {}).some((g) => g && (g.layers.length || g.video)))
export const docOrEmpty = (d: EditDocV3 | null | undefined): EditDocV3 => (d ? (JSON.parse(JSON.stringify(d)) as EditDocV3) : emptyDoc())

export const baseOf = (st: EditorStateV3, fmt: FormatCode) => {
  const src = st.source as AutoPieceSource
  return src.formats?.find((f) => f.format === fmt && f.supported)?.base ?? null
}
export const principalOf = (m: EditManifest): FormatCode => m.formats[0] ?? "9x16"

/** One resolver per composition (§5). F-U1: `frame:*` → Moldura, `headline` → RemixKeep. */
export function resolve(st: EditorStateV3, doc: EditDocV3 | null, fmt: FormatCode): Resolved | null {
  const base = baseOf(st, fmt)
  if (!base) return null
  const principal = principalOf(st.manifest)
  const d = isEmpty(doc) ? null : (doc as never)
  if (st.templateKey === "headline") {
    const r = resolverPropsHeadline(base as unknown as RemixKeepProps, d, { format: fmt, principal })
    return { component: RemixKeep as unknown as Resolved["component"], props: r.props as unknown as Record<string, unknown>, meta: metadadosRemix(r.props), layout: r.layout as unknown as EditLayout, textos: r.textos }
  }
  if (st.templateKey.startsWith("frame:")) {
    const r = resolverPropsMoldura(base as unknown as MolduraProps, d, { format: fmt, principal })
    return { component: Moldura as unknown as Resolved["component"], props: r.props as unknown as Record<string, unknown>, meta: metadadosMoldura(r.props), layout: r.layout as unknown as EditLayout, textos: r.textos }
  }
  return null
}

/** The same checks as the PUT (§6.2), run on every change. */
export function checks(st: EditorStateV3, r: Resolved | null, doc: EditDocV3 | null): EditIssue[] {
  if (!r) return []
  return checarEdicao(r.layout as never, "kind" in st.source && st.source.kind === "auto-piece" ? (st.source as AutoPieceSource).guard as never : null, r.textos, st.facts, (isEmpty(doc) ? null : doc) as never) as unknown as EditIssue[]
}
export const canExport = (issues: EditIssue[]) => exportLiberado(issues as never)

// ───────────── doc edits (all immutable) ─────────────
const clone = (d: EditDocV3) => JSON.parse(JSON.stringify(d)) as EditDocV3
export function layerOf(d: EditDocV3, id: string): EditDocLayerV3 | undefined {
  let out: EditDocLayerV3 | undefined
  for (const l of d.layers) if (l.id === id) out = l
  return out
}
/** Patch the layer entry (text, style, visibility, fill). Geometry goes through `setGeometry` (per format). */
export function patchLayer(d: EditDocV3, id: string, p: DocLayerPatch): EditDocV3 {
  const n = clone(d)
  const prev = layerOf(n, id) ?? { id }
  const next: EditDocLayerV3 = { ...prev, ...p, id } as EditDocLayerV3
  if (p.style !== undefined) {
    if (p.style === null) delete next.style
    else next.style = { ...(prev.style ?? {}), ...p.style }
  }
  for (const k of Object.keys(next) as (keyof EditDocLayerV3)[]) if (next[k] === undefined) delete next[k]
  n.layers = [...n.layers.filter((l) => l.id !== id), next]
  return n
}
/** Geometry on the principal format → layers[]; on another format → formatOverrides[fmt] (§4 "Formatos"). */
export function setGeometry(d: EditDocV3, id: string, fmt: FormatCode, principal: FormatCode, g: { transform?: LayerTransform | null; rect?: Rect | null }): EditDocV3 {
  if (fmt === principal) return patchLayer(d, id, g)
  const n = clone(d)
  const fo = { ...(n.formatOverrides ?? {}) }
  const cur = fo[fmt] ?? { layers: [] }
  const prev = cur.layers.find((l) => l.id === id) ?? { id }
  fo[fmt] = { ...cur, layers: [...cur.layers.filter((l) => l.id !== id), { ...prev, ...g }] }
  n.formatOverrides = fo
  return n
}
export function geometryOf(d: EditDocV3, id: string, fmt: FormatCode, principal: FormatCode): { transform: LayerTransform | null; rect: Rect | null } {
  const l = fmt === principal ? layerOf(d, id) : d.formatOverrides?.[fmt]?.layers.find((x) => x.id === id)
  return { transform: l?.transform ?? null, rect: l?.rect ?? null }
}
export function setText(d: EditDocV3, path: string, text: string): EditDocV3 {
  if (path.startsWith("layer:")) return patchLayer(d, path.slice(6), { text })
  const m = /^item:(.+)\/([^/]+)$/.exec(path)
  if (!m) return d
  const n = clone(d)
  const items: Record<string, NonNullable<EditDocV3["items"]>[string]> = { ...(n.items ?? {}) } as never
  const list = items[m[1]] ?? []
  const prev = list.find((x) => x.id === m[2]) ?? { id: m[2] }
  items[m[1]] = [...list.filter((x) => x.id !== m[2]), { ...prev, text }]
  n.items = items as EditDocV3["items"]
  return n
}
export function setOpt(d: EditDocV3, key: string, value: string | boolean): EditDocV3 {
  const n = clone(d)
  n.templateOpts = { ...(n.templateOpts ?? {}), [key]: value }
  return n
}
export function confirmNumbers(d: EditDocV3, path: string, numbers: string[], byUserId: string): EditDocV3 {
  const n = clone(d)
  const prev = (n.confirmations ?? []).find((c) => c.path === path)
  const all = [...new Set([...(prev?.numbers ?? []), ...numbers])]
  n.confirmations = [...(n.confirmations ?? []).filter((c) => c.path !== path), { path, numbers: all, byUserId, at: new Date().toISOString() }]
  return n
}
/** Reset = the layer as the template made it, in every format: entry, overrides, items and their confirmations. */
export function resetLayer(d: EditDocV3, id: string): EditDocV3 {
  const n = clone(d)
  n.layers = n.layers.filter((l) => l.id !== id)
  if (n.items) delete n.items[id]
  n.confirmations = (n.confirmations ?? []).filter((c) => c.path !== `layer:${id}` && !c.path.startsWith(`item:${id}/`))
  for (const g of Object.values(n.formatOverrides ?? {})) if (g) g.layers = g.layers.filter((l) => l.id !== id)
  if (id === VIDEO_ID) {
    delete n.video
    for (const g of Object.values(n.formatOverrides ?? {})) if (g) delete g.video
  }
  return n
}

// ───────────── your video (§4: box + framing per format, trim in every format) ─────────────
export const VIDEO_ID = "video"
export const ZOOM_MIN = LIMITES_DOC_V3.zoomMin
export const ZOOM_MAX = LIMITES_DOC_V3.zoomMax
export const PAN_MAX = LIMITES_DOC_V3.panAbsMax
export const MIN_TRIM_SEC = LIMITES_DOC_V3.minTrimSec

export function videoGeo(d: EditDocV3, fmt: FormatCode, principal: FormatCode): { framing: VideoFraming | null; box: Rect | null } {
  const v = fmt === principal ? d.video : d.formatOverrides?.[fmt]?.video
  return { framing: v?.framing ?? null, box: v?.box ?? null }
}
/** One gesture on the box or the framing, stored by the engine's rule (handoff §2): a new box without a framing = auto reframe. */
export const setVideoGeo = (d: EditDocV3, fmt: FormatCode, principal: FormatCode, patch: { box?: Rect | null; framing?: VideoFraming | null }): EditDocV3 =>
  (comVideoEditado(d as never, patch, { format: fmt, principal }) as EditDocV3 | null) ?? emptyDoc()
/** Trim = seconds of the client's file. null = the whole video. One trim for every format. */
export const setTrim = (d: EditDocV3, trim: { inSec: number; outSec: number } | null): EditDocV3 =>
  (comVideoEditado(d as never, { trim }) as EditDocV3 | null) ?? emptyDoc()
/** The box always stays inside the canvas (§6.1 `video_box_out_of_canvas`). */
export function clampVideoBox(b: Rect): Rect {
  const w = clamp(b.w, LIMITES_DOC_V3.minBoxFrac, 1)
  const h = clamp(b.h, LIMITES_DOC_V3.minBoxFrac, 1)
  return { x: clamp(b.x, 0, 1 - w), y: clamp(b.y, 0, 1 - h), w, h }
}
export const clampFraming = (f: VideoFraming): VideoFraming => ({
  fit: f.fit, zoom: clamp(f.zoom, ZOOM_MIN, ZOOM_MAX), panX: clamp(f.panX, -PAN_MAX, PAN_MAX), panY: clamp(f.panY, -PAN_MAX, PAN_MAX),
})
/** The framing to start a gesture from: the one in this doc, or what the resolver is showing (`layout.video.framing`, also in auto). */
export const framingNow = (r: Resolved | null, d: EditDocV3, fmt: FormatCode, principal: FormatCode): VideoFraming =>
  videoGeo(d, fmt, principal).framing ?? r?.layout.video?.framing ?? { fit: "cover", zoom: 1, panX: 0, panY: 0 }
/** The Player's video file, for the ghost of the cropped part while reframing. */
export function videoUrlOf(r: Resolved | null): string | null {
  const p = r?.props as { video?: { source?: { videoUrl?: string } }; baseVideoUrl?: string } | undefined
  const u = p?.video?.source?.videoUrl ?? p?.baseVideoUrl ?? null
  return !u ? null : /^(https?:|blob:|data:|\/)/.test(u) ? u : `/${u}`
}

// ───────────── reading the layout / manifest ─────────────
export const layoutLayer = (r: Resolved | null, id: string): EditLayoutLayer | null => r?.layout.layers.find((l) => l.id === id) ?? null
export const canMove = (d: LayerDecl | undefined) => !!d && !d.lockedReason && (d.editable.move || d.editable.resize)
/**
 * How a layer stores its geometry (§4 "Coordenadas"): text with `rotate`/`style` (HEADLINE) = `transform` (center, scale,
 * line width); everything else = `rect`. Molduras scale their content by the same factor in both axes (uniform).
 */
export const geoMode = (st: EditorStateV3, d: LayerDecl): { mode: "transform" | "rect"; uniform: boolean } =>
  d.kind === "video" ? { mode: "rect", uniform: false } : st.templateKey === "headline" && d.kind === "text" ? { mode: "transform", uniform: true } : { mode: "rect", uniform: st.templateKey.startsWith("frame:") }

/** Text rows of the Content table (control `rows`): one per text layer + one per item of `itemsOf`, with path and limits. */
export interface Row { path: string; layerId: string; itemId: string | null; label: string; mark: string; text: string; maxChars: number | null; hidden: boolean }

export const timecode = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const visibleChars = (s: string) => s.replace(/\*/g, "").length
