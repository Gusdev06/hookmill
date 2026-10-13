// Editor no vídeo v1 (docs/contratos/editor-v1.md). Pure helpers over EditDoc + ScratchSource: no React, no fetch.
// The preview props come from `resolverProps` (@maquina/video, the SAME function the API renders with); this file only
// derives what the UI needs around it (timeline, layer views, transcript) and builds the next EditDoc for a gesture.
import { layoutPadrao, type PadraoDaCamada } from "@maquina/video/player"
import type { CaptionWordFix, EditClip, EditDoc, EditDocLayer, EditSettings, LayerStyle, LayerTransform, ScratchSource } from "@/lib/api/types"

export const FPS = 30
export const MIN_CLIP_SEC = 0.3
export const MIN_VIDEO_SEC = 1
export const END_CARD_SEC = 2.5 // = END_CARD_SEC of @maquina/video (formatos.ts)
export type LayerKey = "hook" | "caption" | "cta"
export const LAYER_KEYS: readonly LayerKey[] = ["hook", "caption", "cta"]

export type Scene = ScratchSource["scenes"][number]
export type Sel = { k: LayerKey | "end" } | { k: "scene"; id: string } | null

export const emptyDoc = (): EditDoc => ({ version: 1, clips: [], trim: null, layers: [], captionWords: [] })
export const docOrEmpty = (d: EditDoc | null | undefined): EditDoc => d ?? emptyDoc()
export const isEmptyDoc = (d: EditDoc | null | undefined) => !d || (!d.clips.length && !d.layers.length && !d.captionWords.length && !d.trim)

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const toFrame = (sec: number) => Math.round(sec * FPS) / FPS
export { clamp }

// ───────────── scenes ─────────────
/** Every current scene once, in the doc's order (missing = appended enabled; stale attempt = whole clip), = cenasDoDoc. */
export function fullClips(src: ScratchSource, doc: EditDoc): EditClip[] {
  const order = [...src.scenes].sort((a, b) => a.index - b.index)
  const byId = new Map(src.scenes.map((s) => [s.sceneId, s]))
  const seen = new Set<string>()
  const out: EditClip[] = []
  for (const c of doc.clips) {
    const s = byId.get(c.sceneId)
    if (!s || seen.has(s.sceneId)) continue
    seen.add(s.sceneId)
    const fresh = c.attempt === s.attempt
    out.push({ sceneId: s.sceneId, enabled: c.enabled !== false, attempt: s.attempt, inSec: fresh ? clamp(c.inSec, 0, s.durationSec) : 0, outSec: fresh ? clamp(c.outSec, 0, s.durationSec) : s.durationSec })
  }
  for (const s of order) if (!seen.has(s.sceneId)) out.push({ sceneId: s.sceneId, enabled: true, attempt: s.attempt, inSec: 0, outSec: s.durationSec })
  if (!out.some((c) => c.enabled)) return out.map((c) => ({ ...c, enabled: true }))
  return out
}

export interface Placed { clip: EditClip; scene: Scene; start: number; end: number; dur: number; pos: number }
/** Enabled clips on the output timeline (seconds). */
export function placeScenes(src: ScratchSource, clips: EditClip[]): Placed[] {
  const byId = new Map(src.scenes.map((s) => [s.sceneId, s]))
  let t = 0
  const out: Placed[] = []
  for (const clip of clips) {
    const scene = byId.get(clip.sceneId)
    if (!scene || !clip.enabled) continue
    const dur = Math.max(1 / FPS, toFrame(clip.outSec) - toFrame(clip.inSec))
    out.push({ clip, scene, start: t, end: t + dur, dur, pos: out.length })
    t += dur
  }
  return out
}

export const withClips = (doc: EditDoc, clips: EditClip[]): EditDoc => ({ ...doc, clips })

// Video length rules of §2 (same numbers as validarDoc: clip_too_short / video_too_short), in frames to match its rounding.
const frames = (sec: number) => Math.round(sec * FPS)
const othersSec = (placed: Placed[], sceneId: string) => placed.reduce((a, p) => (p.scene.sceneId === sceneId ? a : a + p.dur), 0)
/** Shortest this scene can be cut to: 0.3 s, or more if the other active scenes don't reach the 1 s of video. */
export function minClipFor(placed: Placed[], sceneId: string): number {
  const need = Math.max(frames(MIN_CLIP_SEC), frames(MIN_VIDEO_SEC) - frames(othersSec(placed, sceneId)))
  return need / FPS
}
/** Deleting this scene keeps ≥ 1 active scene and ≥ 1 s of video. null = can delete; otherwise the rule it would break. */
export function deleteBlock(placed: Placed[], sceneId: string): "last_scene" | "video_too_short" | null {
  if (placed.length <= 1) return "last_scene"
  return frames(othersSec(placed, sceneId)) < frames(MIN_VIDEO_SEC) ? "video_too_short" : null
}

// ───────────── layers ─────────────
export interface LayerView {
  key: LayerKey
  exists: boolean // template/settings draw it at all (hook needs a headline template + text, caption needs captions on, CTA needs text)
  visible: boolean
  transform: LayerTransform
  hasTransform: boolean
  from: number
  to: number
  auto: boolean
  style: LayerStyle
  styleChanged: boolean
  text: string
  fontPx: number
}

export function docLayer(doc: EditDoc, key: LayerKey): EditDocLayer | undefined {
  return doc.layers.find((l) => l.id === key)
}

export function defaultsFor(settings: EditSettings, src: ScratchSource, cenasSec: number): Record<LayerKey, PadraoDaCamada> | null {
  const tpl = settings.templateId
  if (tpl !== "clean" && tpl !== "bold" && tpl !== "headline") return null
  return layoutPadrao(tpl, src.format, settings, cenasSec)
}

export function layerViews(doc: EditDoc, settings: EditSettings, src: ScratchSource, cenasSec: number): Record<LayerKey, LayerView> | null {
  const def = defaultsFor(settings, src, cenasSec)
  if (!def) return null
  const out = {} as Record<LayerKey, LayerView>
  for (const key of LAYER_KEYS) {
    const d = def[key]
    const l = docLayer(doc, key)
    const timing = l?.timing ?? null
    const from = timing ? clamp(toFrame(timing.fromSec), 0, Math.max(0, cenasSec - 1 / FPS)) : d.timing.fromSec
    const to = timing ? clamp(toFrame(timing.fromSec + timing.durationSec), from + 1 / FPS, cenasSec) : d.timing.fromSec + d.timing.durationSec
    const style: LayerStyle = { ...d.style, ...(l?.style ?? {}), background: { ...d.style.background, ...(l?.style?.background ?? {}) } }
    const text = key === "hook" ? (settings.headline ?? "") : key === "cta" ? settings.ctaText : ""
    const exists = key === "hook" ? d.text !== null : key === "cta" ? !!settings.ctaText.trim() : settings.captionStyle !== "off"
    out[key] = {
      key, exists, visible: l?.visible !== false, transform: l?.transform ?? d.transform, hasTransform: !!l?.transform,
      from, to, auto: !timing, style, styleChanged: !!l?.style && Object.keys(l.style).length > 0, text, fontPx: d.fontPx,
    }
  }
  return out
}

/** Next doc with one layer patched (style merges; `null` fields remove). Layer without anything left is dropped. */
export function patchLayer(doc: EditDoc, key: LayerKey, patch: Omit<Partial<EditDocLayer>, "style"> & { style?: Partial<LayerStyle> | null }): EditDoc {
  const cur = docLayer(doc, key) ?? { id: key }
  const next: EditDocLayer = { ...cur }
  if ("visible" in patch) {
    if (patch.visible === false) next.visible = false
    else delete next.visible
  }
  if ("transform" in patch) {
    if (patch.transform) next.transform = patch.transform
    else delete next.transform
  }
  if ("timing" in patch) {
    if (patch.timing) next.timing = patch.timing
    else delete next.timing
  }
  if ("style" in patch) {
    if (patch.style) next.style = { ...(cur.style ?? {}), ...patch.style }
    else delete next.style
  }
  const layers = doc.layers.filter((l) => l.id !== key)
  if (Object.keys(next).length > 1) layers.push(next)
  return { ...doc, layers }
}

// ───────────── words ─────────────
export const wordKey = (sceneId: string, attempt: number, i: number) => `${sceneId}@${attempt}:${i}`

export interface WordView {
  key: string
  sceneId: string
  index: number
  original: string
  text: string // after the fix ('' = hidden)
  fixed: boolean
  hidden: boolean
  cut: boolean // outside the scene's cut or the scene is deleted
  abs: number | null // output-timeline start (null when cut)
  absEnd: number | null
  low: boolean
  suggestion: string | null
}

export interface LineView { id: string; sceneId: string; words: WordView[]; abs: number | null; cut: boolean; low: boolean }

const norm = (w: string) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "")

/** Transcript vs the scene's script line (GET /scenes speech): a word the voice/transcription got different is "low",
 *  with the script word as suggestion. Token alignment (edit distance), not a confidence score from the API. */
export function suspicious(words: string[], speech: string | null | undefined): ({ suggestion: string } | null)[] {
  const out: ({ suggestion: string } | null)[] = words.map(() => null)
  if (!speech) return out
  const a = words.map(norm)
  const raw = speech.split(/\s+/).filter(Boolean)
  const b = raw.map(norm)
  if (!a.length || !b.length || a.length * b.length > 40_000) return out
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1] && a[i - 1] && b[j - 1]) out[i - 1] = { suggestion: raw[j - 1].replace(/[^\p{L}\p{N}'’-]+$/u, "").replace(/^[^\p{L}\p{N}]+/u, "") }
      i--
      j--
    } else if (dp[i][j] === dp[i - 1][j] + 1) i--
    else j--
  }
  return out
}

/** Words of every scene (source order) with fix/cut/output time; lines = up to 5 words or a sentence end, per scene. */
export function transcript(src: ScratchSource, doc: EditDoc, placed: Placed[], speechBySceneId: Map<string, string>): LineView[] {
  const fixes = new Map(doc.captionWords.map((f) => [f.key, f.text]))
  const placedById = new Map(placed.map((p) => [p.scene.sceneId, p]))
  const lines: LineView[] = []
  for (const s of [...src.scenes].sort((x, y) => x.index - y.index)) {
    const p = placedById.get(s.sceneId)
    const sus = suspicious(s.words.map((w) => w.word), speechBySceneId.get(s.sceneId))
    let cur: WordView[] = []
    const flush = () => {
      if (!cur.length) return
      const live = cur.filter((w) => !w.cut)
      lines.push({ id: cur[0].key, sceneId: s.sceneId, words: cur, abs: live.length ? live[0].abs : null, cut: !live.length, low: cur.some((w) => w.low) })
      cur = []
    }
    s.words.forEach((w, i) => {
      const key = wordKey(s.sceneId, s.attempt, i)
      const fixed = fixes.has(key)
      const text = fixed ? fixes.get(key)! : w.word
      const inCut = !!p && !(w.endSec <= p.clip.inSec || w.startSec >= p.clip.outSec)
      const abs = inCut ? p!.start + Math.max(0, w.startSec - p!.clip.inSec) : null
      const absEnd = inCut ? p!.start + Math.min(p!.clip.outSec, w.endSec) - p!.clip.inSec : null
      cur.push({
        key, sceneId: s.sceneId, index: i, original: w.word, text, fixed, hidden: fixed && !text.trim(), cut: !inCut, abs, absEnd,
        low: !fixed && !!sus[i], suggestion: sus[i]?.suggestion ?? null,
      })
      if (cur.length >= 5 || /[.!?…]$/.test(w.word)) flush()
    })
    flush()
  }
  return lines
}

/** Fix a word everywhere the same original word appears (spec §2.11: one CaptionWordFix per occurrence). */
export function fixWordEverywhere(doc: EditDoc, src: ScratchSource, original: string, text: string): EditDoc {
  const target = norm(original)
  const map = new Map(doc.captionWords.map((f) => [f.key, f]))
  for (const s of src.scenes) {
    s.words.forEach((w, i) => {
      if (norm(w.word) !== target) return
      const key = wordKey(s.sceneId, s.attempt, i)
      if (text === w.word) map.delete(key)
      else map.set(key, { key, text })
    })
  }
  return { ...doc, captionWords: [...map.values()] }
}

export function setWord(doc: EditDoc, key: string, text: string | null): EditDoc {
  const list: CaptionWordFix[] = doc.captionWords.filter((f) => f.key !== key)
  if (text !== null) list.push({ key, text })
  return { ...doc, captionWords: list }
}

// ───────────── time format ─────────────
export function timecode(sec: number) {
  const f = Math.round(Math.max(0, sec) * FPS)
  const m = Math.floor(f / (FPS * 60))
  const s = Math.floor(f / FPS) % 60
  const ff = f % FPS
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(ff).padStart(2, "0")}`
}

// ───────────── safe zones (9:16 only; approximate until the video agent confirms the table, spec note) ─────────────
export const SAFE = {
  reels: { t: 0.14, b: 0.2, l: 0.06, r: 0.14, name: "Reels" },
  tiktok: { t: 0.1, b: 0.22, l: 0.06, r: 0.16, name: "TikTok" },
} as const
export type Platform = keyof typeof SAFE

/** Color swatches = the template palettes (video/src/estilos.ts). */
export const SWATCHES = ["#FFFFFF", "#0A0A0A", "#FFE14D", "#7CF29A", "#E5484D", "#52A8FF"] as const
export const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
