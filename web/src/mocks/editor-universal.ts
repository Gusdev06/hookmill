import {
  FONT_CATALOG, checarEdicao, frameLayout, manifestoDe, reframeNaCaixa, resolverPropsHeadline, resolverPropsMoldura,
  type FontId, type FrameTemplateId, type FrameTextsMap, type MolduraProps, type RemixKeepProps,
} from "@maquina/video/player"
import type {
  AutoPieceSource, EditDocV3, EditIssue, EditManifest, EditTemplateKey, EditorExportView, EditorStateV3, FormatCode, PieceEditorView, TextProvenance, UserRef,
} from "@/lib/api/types"
import { ME } from "./fixtures"

/**
 * Mock of the editor universal v1 (docs/contratos/editor-universal-v1.md §7, F-U1) for AUTO pieces (FRAME + HEADLINE),
 * until the backend answers on :3001. Base props are built like video/src/molduras/demo.ts (local fixtures, nothing paid)
 * with the real `frameLayout`/`reframeNaCaixa`; manifest, resolvers and checks are the real @maquina/video functions.
 * Store in localStorage (shared by tabs, so two tabs really conflict). Scenario switches in sessionStorage:
 *   mock:editor-u:fail = "1"      → the next export fails the caption check at 0:04.2 (Retry check passes)
 *   mock:editor-u:conflict = "1"  → the next PUT answers EDIT_CONFLICT (Tordan saved first)
 */

// ───────────── source (real-take-legenda.mp4: 960×960, burned caption "THIS IS THE ORIGINAL CAPTION") ─────────────
const SRC = { videoUrl: "fixtures/real-take-legenda.mp4", width: 960, height: 960, fps: 24, durationSec: 12, hasAudio: true }
const BAND = { x: 90, y: 768, w: 780, h: 100, startSec: 0, endSec: 12 }
const FACE = { x: 0.385, y: 0.23, w: 0.3, h: 0.27 }
const FACE_TRACK = [{ startFrame: 0, endFrame: 288, region: { x: 0, y: 0, w: 960, h: 960 }, faceInRegion: [{ atFrame: 0, box: FACE }] }]
const EDIT_MAP = { width: 960, height: 960, frameCount: 288, layers: [], faceTrack: FACE_TRACK }
const KLING = { videoUrl: "fixtures/real-kling-2.mp4", width: 1080, height: 1920, durationSec: 11.04 }
const FMT = { "9x16": "VERTICAL_9_16", "4x5": "PORTRAIT_4_5", "1x1": "SQUARE_1_1" } as const
const FORMATS: FormatCode[] = ["9x16", "4x5", "1x1"]
const BRAND_COLOR = "#3B5BFF"
/** numbers said in the ad or in the Brain (proof, offer, price), normalized to digits like numerosDoTexto */
const FACTS = ["400", "3", "499", "7"]

const TEXTS: Partial<FrameTextsMap> = {
  news: { topic: "Money", headline: { lead: "Budget app users say:", highlight: "now they see every dollar" }, dek: "One check-in a day shows where your money goes.", cta: "Tap the button and see" },
  split_stack: { headline: "Stop guessing *where your money goes*" },
  question_box: { question: "Why do I *never know* where my money went?" },
  direct_offer: { promise: "Your money, *finally clear*", price: { from: "$9.99", to: "$4.99" }, cta: "Tap the button and start" },
  ranking: { title: "What drains your budget", items: ["Forgotten subscriptions", "Daily coffee runs", "Impulse buys", "Late fees", "No weekly check-in"] },
  cinema: { question: "What if it's *not your salary*?", subtitle: "One check-in a day shows where every dollar goes." },
  meme: { pov: "you open your bank app and have no idea where it all went", cta: "Tap the button and try" },
  gossip_white: { headline: "See how she *saved $400* in 3 weeks without a spreadsheet" },
  gossip_page: { pageName: "Money Daily", headline: "She quit every budget app. *Then one check-in a day changed it.* See what she does now:" },
  gossip_pink: { headline: "She thought it was her salary. *It was the subscriptions.*" },
  split_torn: { headline: "Your budget needs *one check-in*, not a miracle" },
  call: { title: "Daily check-in · Pocketwise", slideTitle: "Day 1: *see every dollar*", slideSteps: ["Open the app", "Check today's spend", "Fix one thing"] },
  call_dialog: { title: "Talking about money", names: ["You", "Coach"] },
  post_card: { copy: "Nobody told you, but the money you lose at the end of the month *goes at the start of it.*" },
  story: { question: "Why is my account always empty?", headline: "It has a name. And a way out.", support: "One check-in a day. *No spreadsheet.*", copy: "You pay, you tap, you forget. Pocketwise shows where every dollar goes, so you *keep more of it*." },
  read_caption: { headline: "The detail that *decides your month*", primaryText: "The money you miss at the end of the month goes at the start of it. Pocketwise shows where every dollar goes. Tap Learn more and try it today." },
  pov_testimonial: { pov: "you checked your spending for a week and finally saw where it goes", cta: "Tap the button to try" },
  live: {},
}
const textsOf = (id: FrameTemplateId) => (TEXTS[id] ?? { headline: "Stop guessing *where your money goes*" }) as FrameTextsMap[FrameTemplateId]

function frameBase(id: FrameTemplateId, f: FormatCode): MolduraProps {
  const format = FMT[f]
  const texts = textsOf(id)
  const L = frameLayout(id, format, texts, "en")
  const box2 = L.secondBox ?? L.videoBox
  return {
    format, language: "en",
    frame: { id, texts, brand: { name: "Pocketwise", handle: "@pocketwise", initials: "PW", color: BRAND_COLOR } } as MolduraProps["frame"],
    video: { source: SRC, timeline: [{ startSec: 0, endSec: 8 }], joinFadeMs: 40, reframe: reframeNaCaixa(L.videoBox, SRC, EDIT_MAP), protectedBands: [BAND] },
    second: { kind: "clip", videoUrl: KLING.videoUrl, width: KLING.width, height: KLING.height, durationSec: KLING.durationSec, startSec: 0, reframe: reframeNaCaixa(box2, KLING, null) },
    face: { kind: "face_crop", atSec: 2, box: FACE },
    safeArea: { top: L.safe.top, bottom: L.safe.bottom },
  } as MolduraProps
}

/** HEADLINE `replace`: an opaque plate over the champion's headline (as buildHeadlineInput), champion grid 960×960. */
const HEADLINE_BASE: RemixKeepProps = {
  canvas: { width: 960, height: 960, fps: 24, frameCount: 192 },
  baseVideoUrl: SRC.videoUrl,
  overlays: [],
  language: "en",
  textLayers: [
    {
      id: "headline-nova", startFrame: 0, endFrame: 192, box: { x: 58, y: 70, w: 844, h: 120 },
      background: { kind: "solid", color: "#ffffff", box: { x: 39, y: 51, w: 882, h: 158 }, radius: 8 },
      style: { fontId: "inter-800", uppercase: false, fontSizePx: 54, lineHeight: 1.1, color: "#111111", highlightColor: "#D7261E", strokeColor: null, strokeWidthPx: 0, shadow: false, align: "center" },
      content: { kind: "static", text: "I quit every budget app *until this one*" },
    },
  ],
  outputProtectedBands: [{ kind: "original", ...BAND }],
} as RemixKeepProps

// ───────────── which pieces open ─────────────
export interface MockPieceRef { creativeId: string; type: string; frame: FrameTemplateId | null; batchId: string; pieceId: string; code: string; name: string }
/** The 4 pieces of the approved prototype (news ≈ Breaking news, split screen, question box, headline) + one approved (read-only). */
export const DEMO_PIECES: MockPieceRef[] = [
  { creativeId: "cr_ed_news", type: "FRAME", frame: "news", batchId: "ib_ed_demo", pieceId: "vi_ed_1", code: "FRAME-NEWS", name: "News" },
  { creativeId: "cr_ed_split", type: "FRAME", frame: "split_stack", batchId: "ib_ed_demo", pieceId: "vi_ed_2", code: "FRAME-SPLIT", name: "Split screen" },
  { creativeId: "cr_ed_qbox", type: "FRAME", frame: "question_box", batchId: "ib_ed_demo", pieceId: "vi_ed_3", code: "FRAME-QBOX", name: "Question box" },
  { creativeId: "cr_ed_headline", type: "HEADLINE", frame: null, batchId: "ib_ed_demo", pieceId: "vi_ed_4", code: "HEADLINE-1", name: "Headline" },
  { creativeId: "cr_ed_approved", type: "FRAME", frame: "direct_offer", batchId: "ib_ed_demo", pieceId: "vi_ed_5", code: "FRAME-OFFER", name: "Direct offer" },
]
export const editableType = (type: string) => type === "FRAME" || type === "HEADLINE"
const keyOf = (r: MockPieceRef): EditTemplateKey => (r.type === "HEADLINE" || !r.frame ? "headline" : (`frame:${r.frame}` as EditTemplateKey))

// ───────────── store ─────────────
interface ExportJob { renderId: string; revision: number; startAt: number; fail: boolean; recheck: boolean }
interface Entry {
  doc: EditDocV3 | null; revision: number; savedAt: string; savedBy: UserRef
  exported: { revision: number; at: string } | null
  job: ExportJob | null
  failed: (EditorExportView & { failedAt: number }) | null
  openedAt: number | null
}
const KEY = "mock:editor-u"
type Store = Record<string, Entry>
const read = (): Store => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store } catch { return {} }
}
const write = (s: Store) => localStorage.setItem(KEY, JSON.stringify(s))
const blank = (): Entry => ({ doc: null, revision: 0, savedAt: new Date(0).toISOString(), savedBy: ME, exported: null, job: null, failed: null, openedAt: null })
export function entryOf(cid: string): Entry {
  return read()[cid] ?? blank()
}
export function putEntry(cid: string, e: Entry) {
  const s = read()
  s[cid] = e
  write(s)
}
export const flag = (k: string) => typeof window !== "undefined" && sessionStorage.getItem(`mock:editor-u:${k}`) === "1"
export const clearFlag = (k: string) => sessionStorage.removeItem(`mock:editor-u:${k}`)

// export timeline (ms): saving → rendering (4 s) → caption check → text check → done
const T_SAVE = 600, T_RENDER = 4200, T_CAP = 1300, T_TEXT = 1000
/** Moves the export forward by the clock. Done → the piece is Edited (-ED), the job ends. Failure → kept for the banner. */
export function advance(cid: string, onDone?: () => void): Entry {
  const e = entryOf(cid)
  const j = e.job
  if (!j) return e
  const t = Date.now() - j.startAt
  const capEnd = j.recheck ? T_CAP : T_SAVE + T_RENDER + T_CAP
  if (j.fail && t >= capEnd) {
    e.failed = { renderId: j.renderId, revision: j.revision, stage: "failed", progress: 100, startedAt: new Date(j.startAt).toISOString(), failedAt: Date.now(), error: { code: "CAPTION_COVERED", atSec: 4.2, layerId: null, canRecheck: true } }
    e.job = null
    putEntry(cid, e)
    return e
  }
  if (t >= capEnd + T_TEXT) {
    e.exported = { revision: j.revision, at: new Date().toISOString() }
    e.job = null
    e.failed = null
    putEntry(cid, e)
    onDone?.()
  }
  return e
}
export function exportView(e: Entry): EditorExportView | null {
  const j = e.job
  if (!j) return e.failed ? { ...e.failed, failedAt: undefined } as unknown as EditorExportView : null
  const t = Date.now() - j.startAt
  const startedAt = new Date(j.startAt).toISOString()
  const base = { renderId: j.renderId, revision: j.revision, error: null, startedAt }
  if (j.recheck) return { ...base, stage: t < T_CAP ? "caption_check" : "text_check", progress: 100 }
  if (t < T_SAVE) return { ...base, stage: "saving", progress: 0 }
  if (t < T_SAVE + T_RENDER) return { ...base, stage: "rendering", progress: Math.round(((t - T_SAVE) / T_RENDER) * 100) }
  if (t < T_SAVE + T_RENDER + T_CAP) return { ...base, stage: "caption_check", progress: 100 }
  return { ...base, stage: "text_check", progress: 100 }
}

// ───────────── state (GET /creatives/:id/editor) ─────────────
interface Built {
  key: EditTemplateKey
  manifest: EditManifest
  bases: { format: FormatCode; supported: boolean; base: MolduraProps | RemixKeepProps | null }[]
}
export function build(r: MockPieceRef): Built {
  const key = keyOf(r)
  if (key === "headline") {
    const manifest = manifestoDe("headline", HEADLINE_BASE, { headlineMaxChars: 60 }) as unknown as EditManifest
    return { key, manifest, bases: FORMATS.map((f) => ({ format: f, supported: manifest.formats.includes(f), base: manifest.formats.includes(f) ? HEADLINE_BASE : null })) }
  }
  const b916 = frameBase(r.frame!, "9x16")
  const manifest = manifestoDe(key, b916) as unknown as EditManifest
  return { key, manifest, bases: FORMATS.map((f) => ({ format: f, supported: manifest.formats.includes(f), base: manifest.formats.includes(f) ? frameBase(r.frame!, f) : null })) }
}

/** Checks of the principal format (the same function the web runs and the PUT/export run). */
export function issuesOf(b: Built, doc: EditDocV3 | null): EditIssue[] {
  const fmt = b.manifest.formats[0]
  const base = b.bases.find((x) => x.format === fmt)!.base!
  const guard = { source: { width: SRC.width, height: SRC.height, fps: SRC.fps }, protectedBands: [BAND], faceTrack: FACE_TRACK }
  const r = b.key === "headline"
    ? resolverPropsHeadline(base as RemixKeepProps, doc as never, { format: fmt, principal: fmt })
    : resolverPropsMoldura(base as MolduraProps, doc as never, { format: fmt, principal: fmt })
  return checarEdicao(r.layout, guard, r.textos, { numbers: FACTS }, doc as never) as unknown as EditIssue[]
}

function provenanceOf(b: Built): Record<string, TextProvenance> {
  const out: Record<string, TextProvenance> = {}
  const base = b.bases.find((x) => x.format === b.manifest.formats[0])!.base!
  const r = b.key === "headline"
    ? resolverPropsHeadline(base as RemixKeepProps, null, { format: b.manifest.formats[0] })
    : resolverPropsMoldura(base as MolduraProps, null, { format: b.manifest.formats[0] })
  r.textos.forEach((t, i) => {
    const kinds: TextProvenance["source"][] = ["transcript", "brain", "both", "template"]
    const source = kinds[i % kinds.length]
    out[t.path] = {
      source,
      field: source === "brain" || source === "both" ? "proof" : null,
      quote: source === "template" ? null : source === "brain" ? "Saved $400 in the first 3 weeks" : "“I tried every budget app out there and quit all of them.”",
      anchorWordIndex: null,
      original: t.text,
    } as TextProvenance
  })
  return out
}

export function stateOf(r: MockPieceRef, e: Entry): EditorStateV3 {
  const b = build(r)
  const source: AutoPieceSource = {
    kind: "auto-piece", fps: SRC.fps, durationSec: SRC.durationSec, language: "en",
    formats: b.bases.map((x) => ({ format: x.format, supported: x.supported, base: x.base as unknown as Record<string, unknown> | null })),
    guard: {
      source: { width: SRC.width, height: SRC.height, fps: SRC.fps },
      protectedBands: [BAND],
      faceTrack: FACE_TRACK.map((s) => ({ ...s, fullFrame: true, facesMax: 1, minScore: 0.9 })),
    },
    words: [],
  }
  const exp = exportView(e)
  const edited = !!e.exported
  const building = e.openedAt !== null && Date.now() - e.openedAt < 3000
  return {
    version: 3, revision: e.revision, base: "auto-piece", composition: b.key === "headline" ? "RemixKeep" : "Moldura", templateKey: b.key,
    manifest: b.manifest, doc: e.doc, source, settings: null, facts: { numbers: FACTS }, provenance: provenanceOf(b),
    issues: issuesOf(b, e.doc), proxy: building ? { status: "building", etaSec: 3 } : { status: "ready", etaSec: null },
    urlsExpireAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
    fonts: (Object.keys(FONT_CATALOG) as FontId[]).map((id) => ({ id, label: FONT_CATALOG[id].label })),
    brandColor: BRAND_COLOR,
    readOnly: r.creativeId === "cr_ed_approved" ? { reason: "published" } : null,
    dirty: e.revision !== (e.exported?.revision ?? 0),
    exported: e.exported, export: exp, editedInEditor: edited,
    code: edited ? `${r.code}-ED` : r.code, baseCode: r.code,
    // demo pieces live outside any mock batch: no "back to batch" (the real API always sends the piece)
    piece: r.batchId === "ib_ed_demo" ? null : { id: r.pieceId, batchId: r.batchId },
  }
}

/** IteratePiece.editor (§7.5) for the batch card. */
export function pieceEditorView(cid: string | null, type: string, ready: boolean): PieceEditorView | null {
  if (!cid) return null
  const e = entryOf(cid)
  return {
    available: ready && editableType(type),
    reason: !editableType(type) ? "auto_type_not_editable" : !ready ? "piece_not_ready" : null,
    edited: !!e.exported,
    pendingExport: e.revision > (e.exported?.revision ?? 0) && (!!e.doc || !!e.exported),
    export: exportView(e),
  }
}
