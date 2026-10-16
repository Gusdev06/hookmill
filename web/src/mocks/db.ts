/**
 * In-browser mock of the HookMill API state (F1/F2, MSW). Not the real backend: it follows the
 * state machine in docs/contratos/modelo-de-dados.md closely enough for the UI and QA to exercise
 * every screen state, including the official mock triggers of api.md §17.
 *
 * Time-based: every async item stores t0/t1 and is advanced from Date.now(), so a reload
 * (state persisted in localStorage, shared by tabs) resumes where it was. `?mock=reset` restores the seed.
 */
import type {
  Action, AsyncErrorCode, CreativeDetail, CreativeEvent, CreativeRow, CreativeState, EditSettings, Engine, Face, FileRef, Job,
  LibraryItem, Offer, Render, Scene, SceneSwap, ScenesSummary, Script, ScriptBlock, Step, StepInfo, SwapResolution, SwapVoiceSource, Take, TakeKind, UserRef, VariationRef, VideoFormat, WinnerUsed,
} from "@/lib/api/types"
import { FACE_DESCRIPTION, SCRIPTS } from "./content"
import { LIBRARY, MEMBERS, OFFERS, SPEND, WORKSPACE } from "./fixtures"

// ───────────── model ─────────────
interface MScript extends Script { t0: number; t1: number; failCode: AsyncErrorCode | null; full: ScriptBlock[]; fullAngle: string; streamed: number }
interface MJob extends Job { t0: number; t1: number; offerId?: string; creativeId?: string; url?: string; pageText?: string; failCode?: AsyncErrorCode | null }
interface MFace extends Face { t0: number; t1: number; tone: number; art: number }
interface MScene extends Scene { t0: number; t1: number; failCode: AsyncErrorCode | null }
interface MRender extends Render { t0: number; t1: number; failAt: number | null; stale: boolean }
/** §13.5: the continuous lipsync clip. Its status lives in the slices (TAKE_SLICE scenes share the take's clock). */
interface MTake { id: string; kind: TakeKind; attempt: number; durationSec: number; sourceStartSec: number | null; sourceEndSec: number | null; regenUsd: number; emitted: string }
export interface MCreative {
  id: string; name: string; offerId: string; state: CreativeState; createdBy: UserRef; createdAt: number; updatedAt: number; savedAt: number
  scripts: MScript[]; scriptJob: MJob | null; selectedScriptId: string | null; winnersUsed: WinnerUsed[]
  faceDescription: string | null; batches: { batch: number; description: string; faces: MFace[] }[]; selectedFaceId: string | null
  engine: Engine | null; engineModel: string | null; voiceId: string | null; format: VideoFormat
  estimatedCostUsd: number | null; costUsd: number
  scenes: MScene[]; renders: MRender[]; editSettings: EditSettings | null; editDirty: boolean
  approvedAt: number | null; isWinner: boolean
  /** Feature 2: set when the creative was launched from a variation batch. */
  variation?: VariationRef | null
  /** §13.5: lipsync take of the current generation (null for Kling/Seedance and the written hook). */
  take?: MTake | null
  /** §13: keeps the champion's edit (template remix-keep). SWAP = new face over the champion; HOOK_TEXT = written hook, 1 SOURCE_CUT scene. */
  keep?: "SWAP" | "HOOK_TEXT" | null
}
interface DB {
  creatives: MCreative[]; offers: Offer[]; library: LibraryItem[]; jobs: MJob[]
  workspace: typeof WORKSPACE; members: typeof MEMBERS; spentUsd: number; uiLocale: "EN" | "PT_BR"; seq: number
}

const GUSTA: UserRef = { id: "u_gusta", name: "Gusta", initials: "G" }
const TORDAN: UserRef = { id: "u_tordan", name: "Tordan", initials: "T" }
export const ENGINE_LABEL: Record<string, string> = { "kling-3.0": "Kling 3.0", "seedance-1.0": "Seedance", "seedance-2.0": "Seedance 2.0", "pruna-lipsync": "Lipsync" }
const EST: Record<string, { cost: number; eta: number }> = {
  "kling-3.0": { cost: 3.8, eta: 540 }, "seedance-1.0": { cost: 2.9, eta: 420 }, "pruna-lipsync": { cost: 0.74, eta: 240 },
}
const FPS = 30
const STEP_ORDER: Step[] = ["offer", "scripts", "avatar", "engine", "generation", "edit", "review"]
export const TRIGGERS: AsyncErrorCode[] = ["SAFETY_BLOCK", "PROVIDER_ERROR", "PROVIDER_TIMEOUT", "CANCELLED"]
const LETTERS = ["A", "B", "C", "D", "E"]

const file = (url: string, mime: string, extra: Partial<FileRef> = {}): FileRef => ({ id: `f_${url.replace(/\W+/g, "_")}`, url, mimeType: mime, ...extra })
const art = (tone: number, face: number) => file(`/mock/art-${tone}-${face}.svg`, "image/svg+xml", { width: 360, height: 640 })
const VIDEO = file("/mock/render.mp4", "video/mp4", { width: 360, height: 640, durationSec: 27 })

// ───────────── seed ─────────────
let seq = 100
const id = (p: string) => `${p}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`

function scriptsFor(offerId: string, now: number, count = 4, readyAll = true): MScript[] {
  const seeds = SCRIPTS[offerId] ?? SCRIPTS.of_orbit
  return seeds.slice(0, count).map((s, i) => {
    const full = s.blocks.map(([label, startSec, endSec, speech, visualPrompt]) => ({ label, startSec, endSec, speech, visualPrompt }))
    return {
      id: id("sc"), letter: LETTERS[i], status: readyAll ? "READY" : "WRITING", angle: s.angle, rationale: s.rationale,
      durationSec: full[full.length - 1].endSec, blocks: readyAll ? full : [], editedByUser: false, selected: false, failReason: null,
      t0: now, t1: now, failCode: null, full, fullAngle: s.angle, streamed: readyAll ? 1e9 : 0,
    }
  })
}

export const FACE_UNIT_USD = 0.006 // Soul V2 1080p (§13.13 faceUnitPriceUsd)
function facesBatch(batch: number, description: string, t0: number, t1: number, status: Face["status"], tone = 0, count = 4): { batch: number; description: string; faces: MFace[] } {
  return {
    batch, description,
    faces: Array.from({ length: count }, (_, p) => p).map((p) => ({
      id: id("fa"), batch, position: p, status, image: status === "READY" ? art(tone, p) : null, failReason: null, errorCode: null, action: null,
      selected: false, t0: t0 + p * 300, t1: t1 + p * 600, tone, art: p,
    })),
  }
}

/** Kling/Seedance: one scene per block, one after the other. Lipsync (§13.5): the blocks are slices of ONE take, so they share its clock and fate. */
function scenesFrom(script: MScript, engine: Engine, faceArt: number, t0: number, gap = 3500, takeId: string | null = null): MScene[] {
  const slice = engine === "LIPSYNC" && takeId
  const takeFail = slice ? triggerIn(script.full.map((b) => `${b.speech} ${b.visualPrompt}`).join(" ")) : null
  return script.full.map((b, i) => ({
    id: id("sn"), index: i, label: b.label, startSec: b.startSec, endSec: b.endSec, speech: b.speech, visualPrompt: b.visualPrompt,
    status: "QUEUED", progress: 0, attempt: 1, failReason: null, errorCode: null, action: null, clip: null, thumbnail: null,
    pipeline: slice ? "TAKE_SLICE" : "SCENE_VIDEO",
    take: slice ? { id: takeId, startSec: b.startSec, endSec: b.endSec } : null, swap: null,
    t0: slice ? t0 : t0 + i * gap, t1: slice ? t0 + 2 * gap : t0 + (i + 1) * gap, failCode: slice ? takeFail : triggerIn(b.speech + " " + b.visualPrompt), _art: faceArt,
  } as MScene))
}

const TAKE_USD = { AUDIO_LIPSYNC: 0.025, TTS_LIPSYNC: 0.025 + 0.0006 + 0.002 }
function newTake(c: MCreative, kind: TakeKind, durationSec: number): MTake {
  c.take = {
    id: id("tk"), kind, attempt: 1, durationSec, sourceStartSec: kind === "AUDIO_LIPSYNC" ? 0 : null, sourceEndSec: kind === "AUDIO_LIPSYNC" ? durationSec : null,
    regenUsd: Math.round(Math.ceil(durationSec) * TAKE_USD[kind] * 100) / 100, emitted: "",
  }
  return c.take
}
/** §13.4 (a): the written hook keeps the champion's video as is: one SOURCE_CUT scene, no provider. */
function sourceCut(script: MScript, faceArt: number, t0: number, t1: number): MScene {
  const end = script.durationSec ?? 29
  return {
    id: id("sn"), index: 0, label: "Champion video", startSec: 0, endSec: end, speech: script.full.map((b) => b.speech).join(" "), visualPrompt: "Source cut of the champion (no generation)",
    status: "QUEUED", progress: 0, attempt: 1, failReason: null, errorCode: null, action: null, clip: null, thumbnail: null, pipeline: "SOURCE_CUT", take: null, swap: null,
    t0, t1, failCode: null, _art: faceArt,
  } as MScene
}

/** §13.15: Trocar avatar on Kling/Seedance. One SWAP_VIDEO scene per main stretch; stretches run in parallel, the windows of one stretch in sequence. */
export interface SwapPlan {
  engine: "KLING" | "SEEDANCE"; voiceSource: SwapVoiceSource; resolution: SwapResolution; fps: number
  spans: { startSec: number; endSec: number; speech: string; windows: { startSec: number; endSec: number; genSec: number }[]; regenUsd: number }[]
  /** web-mock trigger (champion or batch notes): fails the first stretch with this code */
  failCode: AsyncErrorCode | null
}
const SWAP_WINDOW_MS = 2600
function swapOf(p: SwapPlan, sp: SwapPlan["spans"][number], attempt: number): SceneSwap {
  return {
    engine: p.engine, voiceSource: p.voiceSource, startFrame: Math.round(sp.startSec * p.fps), endFrame: Math.round(sp.endSec * p.fps),
    windows: sp.windows.map((w, k) => ({ index: k, startSec: w.startSec, endSec: w.endSec, genSec: w.genSec, startImage: k ? "PREVIOUS_LAST_FRAME" : "FACE", resolution: p.resolution, status: "QUEUED", attempt, seed: 1000 + k * 17 + attempt, clip: null })),
    stage: "windows", fit: null, identityScore: null, regenerateEstimateUsd: sp.regenUsd,
  }
}
export function swapScenes(p: SwapPlan, faceArt: number, t0: number): MScene[] {
  return p.spans.map((sp, i) => ({
    id: id("sn"), index: i, label: `Stretch ${i + 1}`, startSec: sp.startSec, endSec: sp.endSec, speech: sp.speech,
    visualPrompt: "Locked tripod shot, same person first to last frame, talking to the camera", status: "QUEUED", progress: 0, attempt: 1,
    failReason: null, errorCode: null, action: null, clip: null, thumbnail: null, pipeline: "SWAP_VIDEO", take: null, swap: swapOf(p, sp, 1),
    t0: t0 + i * 400, t1: t0 + i * 400 + (sp.windows.length + 2) * SWAP_WINDOW_MS, failCode: i === 0 ? p.failCode : null, _art: faceArt,
  } as MScene))
}
/** Where a SWAP_VIDEO scene is in its chain (§13.15.3), worked out from its progress. */
function stepSwap(sc: MScene) {
  const sw = sc.swap
  if (!sw) return
  const B = sw.voiceSource === "ENGINE_VOICE"
  const p = sc.progress / 100
  const n = sw.windows.length
  const winShare = 0.55
  sw.windows = sw.windows.map((w, k) => {
    const a = (k / n) * winShare
    const b = ((k + 1) / n) * winShare
    const status = sc.status === "READY" || p >= b ? "READY" : sc.status === "GENERATING" && p >= a ? "GENERATING" : "QUEUED"
    return { ...w, status, clip: status === "READY" ? VIDEO : null }
  })
  const marks: [number, SceneSwap["stage"]][] = B
    ? [[winShare, "windows"], [0.62, "joining"], [0.72, "transcribing"], [0.85, "fitting"], [1.01, "checking"]]
    : [[winShare, "windows"], [0.62, "joining"], [0.88, "lipsync"], [1.01, "checking"]]
  sw.stage = sc.status === "READY" ? "done" : (marks.find(([m]) => p < m)?.[1] ?? "checking")
  if (sc.status === "READY") {
    sw.identityScore = 0.71
    const src = sc.endSec - sc.startSec
    if (B) sw.fit = { mode: "STRETCH", ratio: 1.04, sourceSec: +(src * 0.92).toFixed(2), voiceSec: +(src * 0.92 * 1.04).toFixed(2), cutStartSec: 0.12, cutEndSec: +(src * 1.04 + 0.1).toFixed(2) }
  }
}
function failSwap(sc: MScene) {
  const sw = sc.swap
  if (!sw) return
  const code = sc.failCode
  sw.windows = sw.windows.map((w) => ({ ...w, status: "READY", clip: VIDEO }))
  if (code === "VOICE_FIT_OUT_OF_RANGE") {
    sw.stage = "fitting"
  } else if (code === "IDENTITY_DRIFT" || code === "SPEECH_MISMATCH") {
    sw.stage = "checking"
    if (code === "IDENTITY_DRIFT") sw.identityScore = 0.28
  } else {
    sw.stage = "windows"
    sw.windows = sw.windows.map((w, k) => (k === 0 ? { ...w, status: "FAILED", clip: null } : { ...w, status: "QUEUED", clip: null }))
  }
}

export function takeView(c: MCreative): Take | null {
  const tk = c.take
  if (!tk) return null
  const sl = c.scenes.filter((s) => s.take?.id === tk.id)
  const failed = sl.find((s) => s.status === "FAILED")
  const status: Take["status"] = !sl.length ? "QUEUED" : failed ? "FAILED" : sl.every((s) => s.status === "READY") ? "READY" : sl.some((s) => s.status === "GENERATING") ? "GENERATING" : "QUEUED"
  const f = faceArtOf(c)
  return {
    id: tk.id, kind: tk.kind, status, progress: status === "READY" ? 100 : Math.round(sl.reduce((a, s) => a + s.progress, 0) / Math.max(1, sl.length)), attempt: tk.attempt,
    durationSec: tk.durationSec, sourceStartSec: tk.sourceStartSec, sourceEndSec: tk.sourceEndSec,
    clip: status === "READY" ? VIDEO : null, thumbnail: status === "READY" ? art(f?.tone ?? 0, f?.art ?? 0) : null,
    failReason: failed?.failReason ?? null, errorCode: failed?.errorCode ?? null, action: failed ? "regenerate" : null,
    regenerateEstimateUsd: tk.regenUsd,
  }
}

function defaultEdit(offer: Offer | undefined): EditSettings {
  return { templateId: "bold", captionStyle: "word", captionPosition: "bottom", headline: null, ctaText: offer?.cta ?? "Learn more", endCard: true }
}

function render(c: MCreative, t0: number, t1: number, status: Render["status"] = "RENDERING"): MRender {
  return {
    id: id("rn"), status, stage: null, progress: status === "READY" ? 100 : 0, frame: null, totalFrames: Math.round(duration(c) * FPS),
    failReason: null, failedFrame: null, action: null, video: status === "READY" ? VIDEO : null, durationSec: status === "READY" ? duration(c) : null,
    settings: { ...(c.editSettings ?? defaultEdit(undefined)) }, createdAt: new Date(t0).toISOString(), t0, t1, failAt: renderTrigger(c), stale: false,
    // editor-v1 §3.4: no EditDoc in the seed renders (the editor's export stamps them in handlers.ts)
    doc: null, editRevision: null,
  }
}

function seedCreative(p: {
  id: string; name: string; offerId: string; by: UserRef; ago: number; state: CreativeState; script?: number; face?: number; tone?: number
  model?: string; build?: (c: MCreative, now: number) => void
}, now: number): MCreative {
  const offer = OFFERS.find((o) => o.id === p.offerId)!
  const c: MCreative = {
    id: p.id, name: p.name, offerId: p.offerId, state: p.state, createdBy: p.by, createdAt: now - p.ago - 3_600_000, updatedAt: now - p.ago, savedAt: now - p.ago,
    scripts: scriptsFor(p.offerId, now - p.ago), scriptJob: null, selectedScriptId: null, winnersUsed: winnersFor(p.offerId),
    faceDescription: null, batches: [], selectedFaceId: null, engine: null, engineModel: null, voiceId: null, format: "VERTICAL_9_16",
    estimatedCostUsd: null, costUsd: 0.12, scenes: [], renders: [], editSettings: null, editDirty: false, approvedAt: null, isWinner: false,
  }
  if (p.script !== undefined) {
    const s = c.scripts[p.script]
    s.selected = true
    c.selectedScriptId = s.id
    c.faceDescription = FACE_DESCRIPTION[p.offerId]
  }
  if (p.face !== undefined) {
    const b = facesBatch(1, c.faceDescription!, now - p.ago, now - p.ago, "READY", p.tone ?? 0)
    c.batches = [b]
    if (p.face >= 0) {
      b.faces[p.face].selected = true
      c.selectedFaceId = b.faces[p.face].id
    }
    c.costUsd += 0.16
  }
  if (p.model) {
    c.engine = p.model === "pruna-lipsync" ? "LIPSYNC" : "SCENES"
    c.engineModel = p.model
    c.voiceId = c.engine === "LIPSYNC" ? "v_ava" : null
    c.estimatedCostUsd = EST[p.model].cost
  }
  p.build?.(c, now)
  c.editSettings ??= c.scenes.length ? defaultEdit(offer) : null
  return c
}

function readyScenes(c: MCreative, now: number) {
  const s = c.scripts.find((x) => x.id === c.selectedScriptId)!
  const face = c.batches[0]?.faces.find((f) => f.id === c.selectedFaceId)
  if (c.keep === "HOOK_TEXT") {
    c.take = null
    c.scenes = [{ ...sourceCut(s, face?.art ?? 0, now - 600_000, now - 590_000), status: "READY", progress: 100, clip: VIDEO, thumbnail: art(face?.tone ?? 0, face?.art ?? 0) }]
    return
  }
  const takeId = c.engine === "LIPSYNC" ? newTake(c, c.keep === "SWAP" ? "AUDIO_LIPSYNC" : "TTS_LIPSYNC", duration(c)).id : null
  c.scenes = scenesFrom(s, c.engine!, face?.art ?? 0, now - 600_000, 10_000, takeId).map((sc) => ({
    ...sc, failCode: null, status: "READY", progress: 100, clip: VIDEO, thumbnail: art(face?.tone ?? 0, face?.art ?? 0),
  }))
}

function seed(): DB {
  const now = Date.now()
  const m = 60_000
  const creatives = [
    seedCreative({ id: "cr_1", name: "Orbit — found money", offerId: "of_orbit", by: GUSTA, ago: 6 * m, state: "RENDER_READY", script: 0, face: 1, model: "kling-3.0",
      build: (c, n) => { readyScenes(c, n); c.costUsd = 3.86; c.editSettings = defaultEdit(OFFERS[0]); c.renders = [render(c, n - 8 * m, n - 7 * m, "READY")] } }, now),
    seedCreative({ id: "cr_2", name: "Quiet Mind — 3am thoughts", offerId: "of_quiet", by: TORDAN, ago: 18 * m, state: "SCRIPTS_READY" }, now),
    seedCreative({ id: "cr_5", name: "Orbit — subscription audit", offerId: "of_orbit", by: GUSTA, ago: 60 * m, state: "SCENES_FAILED", script: 3, face: 2, tone: 2, model: "kling-3.0",
      build: (c, n) => {
        readyScenes(c, n)
        const f = c.scenes[2]
        f.visualPrompt = "Over-the-shoulder shot of a phone screen with bank data, subscriptions listed with cancel buttons"
        Object.assign(f, { status: "FAILED", progress: 0, clip: null, thumbnail: null, errorCode: "SAFETY_BLOCK", action: "regenerate", failReason: REASON.SAFETY_BLOCK_SCENE })
        c.costUsd = 2.97
      } }, now),
    seedCreative({ id: "cr_3", name: "Orbit — receipts pile", offerId: "of_orbit", by: GUSTA, ago: 2 * m, state: "SCENES_GENERATING", script: 1, face: 3, tone: 3, model: "seedance-1.0",
      build: (c, n) => {
        const s = c.scripts.find((x) => x.id === c.selectedScriptId)!
        // long-running seed so the "in progress" state stays visible: scene 3 ends in ~4 min
        c.scenes = scenesFrom(s, "SCENES", 3, n - 5 * m, 1).map((sc, i) => ({ ...sc, failCode: null,
          t0: i < 2 ? n - 5 * m : i === 2 ? n - 3 * m : n + 4 * m, t1: i < 2 ? n - 4 * m : i === 2 ? n + 4 * m : n + 6 * m }))
        c.costUsd = 1.6
      } }, now),
    seedCreative({ id: "cr_4", name: "Brightside — morning routine", offerId: "of_bright", by: TORDAN, ago: 4 * m, state: "RENDERING", script: 0, face: 2, tone: 1, model: "pruna-lipsync",
      build: (c, n) => { readyScenes(c, n); c.costUsd = 0.9; c.editSettings = defaultEdit(OFFERS[2]); c.renders = [render(c, n - 3.2 * m, n + 1.8 * m)] } }, now),
    seedCreative({ id: "cr_6", name: "Quiet Mind — commute", offerId: "of_quiet", by: TORDAN, ago: 24 * 60 * m, state: "APPROVED", script: 0, face: 0, tone: 2, model: "pruna-lipsync",
      build: (c, n) => { readyScenes(c, n); c.costUsd = 0.81; c.editSettings = defaultEdit(OFFERS[1]); c.renders = [render(c, n - 25 * 60 * m, n - 25 * 60 * m + m, "READY")]; c.approvedAt = n - 24 * 60 * m } }, now),
    seedCreative({ id: "cr_7", name: "Orbit — couple argument", offerId: "of_orbit", by: GUSTA, ago: 9 * 24 * 60 * m, state: "AVATAR_PENDING", script: 2 }, now),
  ]
  return {
    creatives, offers: structuredClone(OFFERS), library: structuredClone(LIBRARY), jobs: [],
    workspace: structuredClone(WORKSPACE), members: structuredClone(MEMBERS), spentUsd: SPEND.spentUsd, uiLocale: "EN", seq,
  }
}

function winnersFor(offerId: string): WinnerUsed[] {
  return LIBRARY.filter((l) => l.isWinner && l.offer.id === offerId).map((l) => ({ creativeId: l.id, name: l.name, offerName: l.offer.name, sameOffer: true }))
}

// ───────────── persistence ─────────────
const KEY = "mock:db:v3"

function load(): DB {
  if (typeof window !== "undefined") {
    const reset = new URLSearchParams(window.location.search).get("mock") === "reset"
    if (reset) localStorage.removeItem(KEY)
    const raw = reset ? null : localStorage.getItem(KEY)
    if (raw) {
      try {
        const d = JSON.parse(raw) as DB
        seq = d.seq ?? seq
        // fase2-agencia: states saved before 12/10 lack the new workspace fields and adName
        d.workspace = { ...structuredClone(WORKSPACE), ...d.workspace }
        d.library = d.library.map((x) => ({ ...x, adName: x.adName ?? null }))
        return d
      } catch {}
    }
  }
  return seed()
}
let saveTimer: ReturnType<typeof setTimeout> | null = null
export function save() {
  if (typeof window === "undefined" || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    db.seq = seq
    localStorage.setItem(KEY, JSON.stringify(db))
  }, 200)
}

// ───────────── triggers (api.md §17) ─────────────
export function triggerIn(text: string | null | undefined): AsyncErrorCode | null {
  if (!text) return null
  for (const t of TRIGGERS) if (text.includes(`[mock:${t}]`)) return t
  return null
}
/** Web-mock-only (not in §17): put [mock:RENDER_ERROR] in the CTA text or headline to fail the render. */
function renderTrigger(c: MCreative): number | null {
  const s = c.editSettings
  return s && `${s.ctaText} ${s.headline ?? ""}`.includes("[mock:RENDER_ERROR]") ? Math.round(duration(c) * FPS * 0.48) : null
}

const REASON: Record<string, string> = {
  SAFETY_BLOCK_FACE: "The image service flagged the description as unsafe (it can misread words like “model”). Edit the description and generate again.",
  SAFETY_BLOCK_SCENE: "Kling flagged the prompt (“phone screen with bank data”). Edit the visual prompt or regenerate as is.",
  PROVIDER_ERROR: "The generation service returned an error. Try again.",
  PROVIDER_TIMEOUT: "The generation service took too long to answer. Try again.",
  CANCELLED: "The task was cancelled by the provider. Try again.",
  RATE_LIMITED: "The script service hit its rate limit.",
  PAGE_FORBIDDEN: "The site blocked our request (HTTP 403).",
  PAGE_UNREADABLE: "We couldn't find a sales page at that link.",
  RENDER_ERROR: "A scene file didn't download completely. Render again; it fetches the file fresh.",
  VOICE_FIT_OUT_OF_RANGE: "The engine spoke 15% slower than the original (ratio 1.15). Over 8% it can't be fitted without changing the edit.",
  SPEECH_MISMATCH: "The engine said something different from the script (72% of the words matched).",
  IDENTITY_DRIFT: "The face changed into someone else partway through the clip.",
}
const actionFor = (code: AsyncErrorCode, where: "face" | "scene"): Action =>
  code === "SAFETY_BLOCK" ? (where === "face" ? "change_description" : "regenerate") : "retry"

// ───────────── derived views ─────────────
const STEP_OF: Record<CreativeState, Step | "library"> = {
  SCRIPTS_WRITING: "scripts", SCRIPTS_READY: "scripts", SCRIPTS_FAILED: "scripts", AVATAR_PENDING: "avatar", FACES_GENERATING: "avatar",
  FACES_READY: "avatar", FACES_FAILED: "avatar", ENGINE_PENDING: "engine", SCENES_GENERATING: "generation", SCENES_FAILED: "generation",
  EDIT_PENDING: "edit", RENDERING: "edit", RENDER_FAILED: "edit", RENDER_READY: "review", APPROVED: "library",
}
function chip(c: MCreative): CreativeRow["status"] {
  const s = c.state
  if (s === "APPROVED") return "approved"
  if (s.endsWith("_FAILED")) return "failed"
  if (s === "SCRIPTS_WRITING" || s === "FACES_GENERATING" || s === "SCENES_GENERATING" || s === "RENDERING") return "progress"
  if ((s === "AVATAR_PENDING" || s === "ENGINE_PENDING") && Date.now() - c.updatedAt > 7 * 864e5) return "draft"
  return "waiting"
}
export const duration = (c: MCreative) => c.scripts.find((s) => s.id === c.selectedScriptId)?.durationSec ?? 27
export const latestRender = (c: MCreative) => c.renders[c.renders.length - 1] ?? null
export const offerOf = (c: MCreative) => db.offers.find((o) => o.id === c.offerId)!

export function scenesSummary(c: MCreative): ScenesSummary {
  const total = c.scenes.length
  const ready = c.scenes.filter((s) => s.status === "READY").length
  const failed = c.scenes.filter((s) => s.status === "FAILED").length
  const progress = total ? Math.round(c.scenes.reduce((a, s) => a + (s.status === "READY" ? 100 : s.status === "GENERATING" ? s.progress : 0), 0) / total) : 0
  const pending = c.scenes.filter((s) => s.status === "QUEUED" || s.status === "GENERATING")
  const etaSec = pending.length ? Math.max(0, Math.round((Math.max(...pending.map((s) => s.t1)) - Date.now()) / 1000)) : null
  return { ready, total, failed, progress, etaSec }
}

/** fase2-agencia.md §6 (simplified for mocks): CLIENT_PATH_MMDD_SCRIPT_FACE_FORMAT, frozen at the final OK. */
const FORMAT_CODE: Record<VideoFormat, string> = { VERTICAL_9_16: "9x16", PORTRAIT_4_5: "4x5", SQUARE_1_1: "1x1" }
export function mockAdName(c: MCreative): string | null {
  if (!c.approvedAt) return null
  const d = new Date(c.approvedAt)
  const mmdd = String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0")
  const letter = c.scripts.find((x) => x.id === c.selectedScriptId)?.letter ?? "A"
  const face = faceArtOf(c)
  return [db.workspace.shortCode, c.variation ? "ITER" : "NEW", mmdd, letter, face ? `F${face.art + 1}` : "ORIG", FORMAT_CODE[c.format]].join("_")
}

function faceArtOf(c: MCreative) {
  for (const b of c.batches) for (const f of b.faces) if (f.id === c.selectedFaceId) return f
  return null
}

export function toRow(c: MCreative): CreativeRow {
  const status = chip(c)
  const sum = scenesSummary(c)
  const r = latestRender(c)
  let statusParams: Record<string, number> = {}
  let progress: number | null = null
  if (c.state === "SCENES_GENERATING") { statusParams = { ready: sum.ready, total: sum.total }; progress = sum.progress }
  if (c.state === "SCENES_FAILED") statusParams = { failed: sum.failed, total: sum.total }
  if (c.state === "RENDERING" && r) { statusParams = { progress: r.progress }; progress = r.progress }
  if (c.state === "SCRIPTS_WRITING") progress = Math.round((c.scripts.filter((s) => s.status !== "WRITING").length / Math.max(1, c.scripts.length)) * 100)
  const face = faceArtOf(c)
  const finalReady = c.renders.filter((x) => x.status === "READY").length > 0
  return {
    id: c.id, name: c.name, offer: { id: c.offerId, name: offerOf(c).name }, state: c.state, step: STEP_OF[c.state], status,
    statusKey: status === "draft" ? "status.draft" : `status.${c.state.toLowerCase()}`, statusParams, progress: status === "progress" ? progress : null,
    engine: c.engine, engineModel: c.engineModel,
    thumbnail: finalReady && face ? art(face.tone, face.art) : face?.image ?? null,
    createdBy: c.createdBy, updatedAt: new Date(c.updatedAt).toISOString(),
    variation: c.variation ?? null,
    // editor-v1 §5.1 (D1): the current READY render went out with a non-empty EditDoc
    editedInEditor: !![...c.renders].reverse().find((x) => x.status === "READY" && !x.stale)?.doc,
  }
}

export function toDetail(c: MCreative): CreativeDetail {
  const row = toRow(c)
  const cur = row.step === "library" ? 7 : STEP_ORDER.indexOf(row.step)
  const steps: StepInfo[] = STEP_ORDER.map((step, i) => ({
    step,
    state: i < cur ? "done" : i > cur ? "todo" : row.status === "progress" ? "progress" : row.status === "failed" ? "failed" : "current",
  }))
  const s = c.scripts.find((x) => x.id === c.selectedScriptId)
  const face = faceArtOf(c)
  const finals = c.renders.filter((r) => r.status === "READY" && !r.stale)
  return {
    ...row, language: offerOf(c).language, format: c.format, voiceId: c.voiceId, steps,
    summary: { scriptLetter: s?.letter ?? null, scriptDurationSec: s?.durationSec ?? null, face: face?.image ?? null, engineLabel: c.engineModel ? ENGINE_LABEL[c.engineModel] : null },
    faceDescription: c.faceDescription, editSettings: c.editSettings, editDirty: c.editDirty,
    estimatedCostUsd: c.estimatedCostUsd, costUsd: Math.round(c.costUsd * 100) / 100,
    finalRender: finals.length ? strip(finals[finals.length - 1]) : null, take: takeView(c),
    approvedAt: c.approvedAt ? new Date(c.approvedAt).toISOString() : null, isWinner: c.isWinner, savedAt: new Date(c.savedAt).toISOString(),
    adName: mockAdName(c),
  }
}

export function strip<T extends object>(x: T): T {
  const { t0, t1, failCode, full, fullAngle, streamed, failAt, stale, tone, art: _a, _art, offerId, creativeId, url, pageText, ...rest } = x as Record<string, unknown>
  void t0; void t1; void failCode; void full; void fullAngle; void streamed; void failAt; void stale; void tone; void _a; void _art; void offerId; void creativeId; void url; void pageText
  return rest as T
}

// ───────────── events bus ─────────────
type Listener = (e: CreativeEvent) => void
const listeners = new Map<string, Set<Listener>>()
export function subscribe(cid: string, l: Listener) {
  const set = listeners.get(cid) ?? new Set()
  set.add(l)
  listeners.set(cid, set)
  return () => set.delete(l)
}
export function emit(cid: string, e: CreativeEvent) {
  listeners.get(cid)?.forEach((l) => l(e))
}
export function touch(c: MCreative) {
  c.updatedAt = c.savedAt = Date.now()
  save()
}
export function setState(c: MCreative, s: CreativeState) {
  c.state = s
  touch(c)
  const d = toDetail(c)
  emit(c.id, { event: "creative.updated", data: { id: d.id, state: d.state, step: d.step, status: d.status, statusKey: d.statusKey, statusParams: d.statusParams, progress: d.progress, savedAt: d.savedAt } })
}
export const emitTo = emit

// ───────────── async actions ─────────────
export function startScripts(c: MCreative, count: number, replace: boolean) {
  const now = Date.now()
  const offer = offerOf(c)
  if (replace) c.scripts = []
  else c.scripts = c.scripts.filter((s) => s.status !== "FAILED")
  const used = new Set(c.scripts.map((s) => s.letter))
  const free = LETTERS.filter((l) => !used.has(l)).slice(0, count)
  const pool = SCRIPTS[c.offerId] ?? SCRIPTS.of_orbit
  const notes = offer.notes ?? ""
  const failAll = notes.includes("[mock:fail-all]")
  const failSlots = [...notes.matchAll(/\[mock:fail-slot:(\d+)\]/g)].map((m) => Number(m[1]))
  const offset = replace && c.createdAt < now - 5000 ? 1 + Math.floor(Math.random() * 3) : 0
  const fresh = free.map((letter, i) => {
    const seedIdx = (LETTERS.indexOf(letter) + offset) % pool.length
    const s = scriptsFor(c.offerId, now, 4, false)[seedIdx]
    const t0 = now + 1600 + i * 1400
    return { ...s, letter, t0, t1: t0 + 2600, failCode: failAll || failSlots.includes(i) ? ("RATE_LIMITED" as const) : null }
  })
  c.scripts = [...c.scripts, ...fresh].sort((a, b) => a.letter.localeCompare(b.letter))
  c.scriptJob = {
    id: id("job"), type: "SCRIPTS_GENERATE", status: "RUNNING", stage: "reading_brief", progress: 0, etaSec: 6,
    checklist: [{ key: "reading_brief", done: false }, { key: "studying_winners", done: false }, { key: "writing", done: false }],
    errorCode: null, failReason: null, action: null, output: null, t0: now, t1: Math.max(...fresh.map((s) => s.t1)), creativeId: c.id,
  }
  setState(c, "SCRIPTS_WRITING")
  return fresh
}

export function regenerateScript(c: MCreative, s: MScript) {
  const now = Date.now()
  const pool = SCRIPTS[c.offerId] ?? SCRIPTS.of_orbit
  const alt = pool[(LETTERS.indexOf(s.letter) + 1 + Math.floor(Math.random() * 3)) % pool.length]
  const full = alt.blocks.map(([label, startSec, endSec, speech, visualPrompt]) => ({ label, startSec, endSec, speech, visualPrompt }))
  Object.assign(s, { status: "WRITING", blocks: [], full, fullAngle: alt.angle, angle: alt.angle, rationale: alt.rationale, durationSec: full[full.length - 1].endSec,
    streamed: 0, t0: now + 300, t1: now + 3200, failCode: null, failReason: null, editedByUser: false, selected: false })
  c.scriptJob = { ...(c.scriptJob as MJob), id: id("job"), type: "SCRIPT_REGENERATE", status: "RUNNING", stage: "writing", t0: now, t1: s.t1,
    checklist: [{ key: "reading_brief", done: true }, { key: "studying_winners", done: true }, { key: "writing", done: false }], errorCode: null, failReason: null }
  if (c.selectedScriptId === s.id) c.selectedScriptId = null
  setState(c, "SCRIPTS_WRITING")
}

export function startFaces(c: MCreative, description: string, count = 4) {
  const now = Date.now()
  const batch = (c.batches[0]?.batch ?? 0) + 1
  const b = facesBatch(batch, description, now + 400, now + 3200, "QUEUED", 0, count)
  const code = triggerIn(description)
  for (const f of b.faces) (f as MFace & { failCode?: AsyncErrorCode | null }).errorCode = null
  ;(b as unknown as { failCode: AsyncErrorCode | null }).failCode = code
  c.batches.unshift(b)
  c.faceDescription = description
  db.spentUsd += count * FACE_UNIT_USD
  setState(c, "FACES_GENERATING")
  return b
}

export function startGeneration(c: MCreative) {
  const now = Date.now()
  const s = c.scripts.find((x) => x.id === c.selectedScriptId)!
  const face = faceArtOf(c)
  const takeId = c.engine === "LIPSYNC" ? newTake(c, "TTS_LIPSYNC", duration(c)).id : null
  if (!takeId) c.take = null
  c.scenes = scenesFrom(s, c.engine!, face?.art ?? 0, now + 500, 3200, takeId)
  c.renders.forEach((r) => (r.stale = true))
  c.editSettings = null
  c.editDirty = false
  setState(c, "SCENES_GENERATING")
}

export function regenerateScene(c: MCreative, sc: MScene, body: { visualPrompt?: string; speech?: string }) {
  const now = Date.now()
  if (sc.swap) {
    // §13.15: redo only this stretch (every window + lipsync/transcription), attempt + 1, new seed; the mock trigger fires once
    const n = sc.swap.windows.length
    sc.swap = { ...sc.swap, stage: "windows", fit: null, identityScore: null, windows: sc.swap.windows.map((w) => ({ ...w, status: "QUEUED", clip: null, attempt: sc.attempt + 1, seed: w.seed + 101 })) }
    Object.assign(sc, { status: "QUEUED", progress: 0, attempt: sc.attempt + 1, failReason: null, errorCode: null, action: null, clip: null, thumbnail: null,
      t0: now + 400, t1: now + 400 + (n + 2) * SWAP_WINDOW_MS, failCode: null })
    c.renders.forEach((r) => (r.stale = true))
    setState(c, "SCENES_GENERATING")
    emit(c.id, { event: "scene.updated", data: { ...strip(sc), summary: scenesSummary(c) } })
    return
  }
  if (body.visualPrompt !== undefined) sc.visualPrompt = body.visualPrompt
  if (body.speech !== undefined) sc.speech = body.speech
  Object.assign(sc, { status: "QUEUED", progress: 0, attempt: sc.attempt + 1, failReason: null, errorCode: null, action: null, clip: null, thumbnail: null,
    t0: now + 400, t1: now + 4000, failCode: triggerIn(`${sc.speech} ${sc.visualPrompt}`) })
  c.renders.forEach((r) => (r.stale = true))
  setState(c, "SCENES_GENERATING")
  emit(c.id, { event: "scene.updated", data: { ...strip(sc), summary: scenesSummary(c) } })
}

/** §13.5: redo the whole take (new attempt, new seed); every slice goes back to the queue together. */
export function regenerateTake(c: MCreative, speech?: { index: number; text: string }) {
  const tk = c.take
  if (!tk) return
  const now = Date.now()
  tk.attempt += 1
  if (speech) {
    const sc = c.scenes.find((x) => x.index === speech.index)
    if (sc) sc.speech = speech.text
  }
  for (const sc of c.scenes) {
    if (sc.take?.id !== tk.id) continue
    Object.assign(sc, { status: "QUEUED", progress: 0, attempt: tk.attempt, failReason: null, errorCode: null, action: null, clip: null, thumbnail: null, t0: now + 400, t1: now + 7000, failCode: null })
  }
  c.renders.forEach((r) => (r.stale = true))
  setState(c, "SCENES_GENERATING")
  for (const sc of c.scenes) emit(c.id, { event: "scene.updated", data: { ...strip(sc), summary: scenesSummary(c) } })
  emitTake(c)
}
function emitTake(c: MCreative) {
  const tv = takeView(c)
  if (!tv || !c.take) return
  const key = `${tv.status}:${tv.progress}:${tv.attempt}`
  if (key === c.take.emitted) return
  c.take.emitted = key
  emit(c.id, { event: "take.updated", data: { ...tv, summary: scenesSummary(c) } })
}

export function startRender(c: MCreative) {
  const now = Date.now()
  const r = render(c, now + 300, now + 9000)
  r.status = "QUEUED"
  c.renders.push(r)
  c.editDirty = false
  setState(c, "RENDERING")
  emit(c.id, { event: "render.updated", data: strip(r) })
  return r
}

export function newExtractJob(input: { url?: string; pageText?: string; offerId?: string }) {
  const now = Date.now()
  const u = input.url ?? ""
  const failCode: AsyncErrorCode | null = input.pageText ? null : u.includes("mock-403") ? "PAGE_FORBIDDEN" : u.includes("mock-unreadable") ? "PAGE_UNREADABLE" : u.includes("mock-429") ? "RATE_LIMITED" : null
  const job: MJob = {
    id: id("job"), type: "OFFER_EXTRACT", status: "QUEUED", stage: "fetching_page", progress: 0, etaSec: 5,
    checklist: ["fetching_page", "extracting", "detecting_language"].map((key) => ({ key, done: false })),
    errorCode: null, failReason: null, action: null, output: null, t0: now, t1: now + 4500, url: input.url, pageText: input.pageText, offerId: input.offerId, failCode,
  }
  db.jobs.push(job)
  save()
  return job
}

// ───────────── the clock ─────────────
const frac = (now: number, t0: number, t1: number) => (t1 <= t0 ? 1 : Math.min(1, Math.max(0, (now - t0) / (t1 - t0))))

export function advanceJob(j: MJob, now = Date.now()) {
  if (j.status === "SUCCEEDED" || j.status === "FAILED" || j.status === "PARTIAL") return j
  if (j.type !== "OFFER_EXTRACT") return j
  const el = now - j.t0
  const done = Math.min(3, Math.floor(el / 1500))
  j.checklist = j.checklist.map((c, i) => ({ ...c, done: i < done }))
  j.stage = j.checklist[Math.min(done, 2)].key
  j.progress = Math.round((done / 3) * 100)
  j.etaSec = Math.max(0, Math.ceil((j.t1 - now) / 1000))
  j.status = "RUNNING"
  if (j.failCode && done >= 1) {
    j.status = "FAILED"
    j.errorCode = j.failCode
    j.failReason = REASON[j.failCode]
    j.action = j.failCode === "PAGE_FORBIDDEN" ? "paste_page_text" : j.failCode === "PAGE_UNREADABLE" ? "fill_manually" : "retry"
  } else if (done >= 3) {
    j.status = "SUCCEEDED"
    j.stage = null
    j.output = extractOutput(j)
  }
  save()
  return j
}

function extractOutput(j: MJob) {
  const host = (() => {
    try { return new URL(j.url ?? "").host } catch { return "" }
  })()
  const known = db.offers.find((o) => (j.offerId ? o.id === j.offerId : host && o.sourceUrl?.includes(host)))
  const fromPage = { what: "page", audience: "page", promise: "page", pains: "page", proof: "page", offerAndPrice: "page", cta: "page", name: "page", language: "page" } as const
  if (known) {
    return {
      name: known.name, language: known.language, sourceUrl: known.sourceUrl,
      brief: { kind: known.kind, what: known.what, audience: known.audience, promise: j.offerId ? known.promise?.replace(/\.$/, ", without a spreadsheet.") ?? null : known.promise, pains: known.pains, proof: known.proof, offerAndPrice: known.offerAndPrice, cta: known.cta, notes: known.notes },
      fieldSources: fromPage,
    }
  }
  const name = host ? host.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "New offer"
  return {
    name, language: "en", sourceUrl: j.url ?? null,
    brief: {
      kind: "Digital product",
      what: j.pageText ? j.pageText.slice(0, 160) : `${name} helps people get a specific result faster.`,
      audience: "Adults who already tried to solve this problem on their own.",
      promise: "Get the result in days, not months.", pains: "Wasted time and money on things that didn't work.",
      proof: "Customer reviews on the sales page.", offerAndPrice: "One-time payment.", cta: "Get started", notes: null,
    },
    fieldSources: fromPage,
    // link read (not pasted text): pretend the API also read the checkout subdomain
    relatedUrls: host && !j.pageText ? [`https://checkout.${host.replace(/^www\./, "")}/`] : [],
  }
}

export function advance(c: MCreative, now = Date.now()) {
  const before = c.state
  // scripts
  if (c.state === "SCRIPTS_WRITING" && c.scriptJob) {
    const j = c.scriptJob
    const el = now - j.t0
    const cl = [el > 700, el > 1400, c.scripts.every((s) => s.status !== "WRITING")]
    if (cl.some((d, i) => d !== j.checklist[i].done)) {
      j.checklist = j.checklist.map((x, i) => ({ ...x, done: x.done || cl[i] }))
      j.stage = j.checklist.find((x) => !x.done)?.key ?? null
      emit(c.id, { event: "job.updated", data: strip(j) })
    }
    for (const s of c.scripts) {
      if (s.status !== "WRITING" || now < s.t0) continue
      const hook = s.full[0].speech
      if (now >= s.t1) {
        if (s.failCode) {
          Object.assign(s, { status: "FAILED", blocks: [], failReason: REASON[s.failCode], streamed: hook.length })
        } else {
          Object.assign(s, { status: "READY", blocks: s.full, angle: s.fullAngle, streamed: hook.length })
          c.costUsd += 0.03
          db.spentUsd += 0.03
        }
        emit(c.id, { event: "script.updated", data: strip(s) })
        continue
      }
      const want = s.failCode ? Math.floor(hook.length * 0.3) : Math.floor(hook.length * frac(now, s.t0, s.t1 - 600))
      if (want > s.streamed) {
        if (!s.blocks.length) s.blocks = [{ ...s.full[0], speech: "" }]
        const text = hook.slice(s.streamed, want)
        s.blocks[0].speech += text
        s.streamed = want
        emit(c.id, { event: "script.delta", data: { scriptId: s.id, letter: s.letter, blockIndex: 0, field: "speech", text } })
      }
    }
    if (c.scripts.every((s) => s.status !== "WRITING")) {
      const ok = c.scripts.filter((s) => s.status === "READY").length
      const failed = c.scripts.filter((s) => s.status === "FAILED").length
      j.status = !ok ? "FAILED" : failed ? "PARTIAL" : "SUCCEEDED"
      j.checklist = j.checklist.map((x) => ({ ...x, done: true }))
      j.stage = null
      j.progress = 100
      if (failed) { j.errorCode = "RATE_LIMITED"; j.failReason = REASON.RATE_LIMITED; j.action = "retry" }
      emit(c.id, { event: "job.updated", data: strip(j) })
      setState(c, ok ? "SCRIPTS_READY" : "SCRIPTS_FAILED")
    }
  }
  // faces
  if (c.state === "FACES_GENERATING" && c.batches[0]) {
    const b = c.batches[0]
    const code = (b as unknown as { failCode: AsyncErrorCode | null }).failCode
    for (const f of b.faces) {
      const prev = f.status
      if (f.status === "QUEUED" && now >= f.t0) f.status = "GENERATING"
      if (f.status === "GENERATING" && now >= f.t1) {
        if (code) Object.assign(f, { status: "FAILED", errorCode: code, failReason: REASON[code === "SAFETY_BLOCK" ? "SAFETY_BLOCK_FACE" : code], action: actionFor(code, "face") })
        else Object.assign(f, { status: "READY", image: art(f.tone, f.art) })
      }
      if (f.status !== prev) emit(c.id, { event: "face.updated", data: strip(f) })
    }
    if (b.faces.every((f) => f.status === "READY" || f.status === "FAILED")) {
      setState(c, b.faces.some((f) => f.status === "READY") ? "FACES_READY" : "FACES_FAILED")
    }
  }
  // scenes
  if (c.state === "SCENES_GENERATING") {
    const per = (c.estimatedCostUsd ?? 3) / Math.max(1, c.scenes.length)
    for (const sc of c.scenes) {
      const prevStatus = sc.status
      const prevPct = sc.progress
      if (sc.status === "QUEUED" && now >= sc.t0) sc.status = "GENERATING"
      if (sc.status === "GENERATING") {
        sc.progress = Math.round(frac(now, sc.t0, sc.t1) * 100)
        // §13.15 failures happen at their own step of the chain (fit after transcribing, identity at the check)
        const swapFailAt = sc.swap && sc.failCode ? (sc.failCode === "VOICE_FIT_OUT_OF_RANGE" ? 0.8 : sc.failCode === "IDENTITY_DRIFT" || sc.failCode === "SPEECH_MISMATCH" ? 0.92 : 0.2) : 1
        if (now >= sc.t1 || (sc.failCode && sc.swap && sc.progress >= swapFailAt * 100)) {
          if (sc.failCode) {
            Object.assign(sc, { status: "FAILED", progress: 0, errorCode: sc.failCode, action: sc.swap ? "regenerate" : actionFor(sc.failCode, "scene"),
              failReason: REASON[sc.failCode === "SAFETY_BLOCK" ? (sc.swap ? "PROVIDER_ERROR" : "SAFETY_BLOCK_SCENE") : sc.failCode] })
            failSwap(sc)
          } else {
            const f = faceArtOf(c)
            Object.assign(sc, { status: "READY", progress: 100, clip: VIDEO, thumbnail: art(f?.tone ?? 0, f?.art ?? 0) })
            c.costUsd += per
            db.spentUsd += per
            emit(c.id, { event: "cost.updated", data: { costUsd: Math.round(c.costUsd * 100) / 100 } })
          }
        }
      }
      if (sc.swap && sc.status !== "FAILED") stepSwap(sc)
      if (sc.status !== prevStatus || Math.abs(sc.progress - prevPct) >= 2) emit(c.id, { event: "scene.updated", data: { ...strip(sc), summary: scenesSummary(c) } })
    }
    emitTake(c)
    const pending = c.scenes.some((s) => s.status === "QUEUED" || s.status === "GENERATING")
    if (!pending) {
      if (c.scenes.every((s) => s.status === "READY")) {
        c.editSettings ??= defaultEdit(offerOf(c))
        const r = render(c, now + 300, now + 9000)
        r.status = "QUEUED"
        c.renders.push(r)
        setState(c, "RENDERING")
      } else setState(c, "SCENES_FAILED")
    }
  }
  // render
  if (c.state === "RENDERING") {
    const r = latestRender(c)!
    const total = r.totalFrames ?? 810
    const f = frac(now, r.t0, r.t1)
    const frame = Math.round(total * f)
    const prev = `${r.status}:${r.progress}`
    if (r.status === "QUEUED" && now >= r.t0) r.status = "RENDERING"
    if (r.status === "RENDERING") {
      r.progress = Math.round(f * 100)
      r.frame = frame
      r.stage = f < 0.08 ? "bundling" : f < 0.9 ? "rendering" : "encoding"
      if (r.failAt !== null && frame >= r.failAt) {
        Object.assign(r, { status: "FAILED", failedFrame: r.failAt, frame: r.failAt, failReason: REASON.RENDER_ERROR, action: "render_again" })
        emit(c.id, { event: "render.updated", data: strip(r) })
        setState(c, "RENDER_FAILED")
      } else if (f >= 1) {
        Object.assign(r, { status: "READY", progress: 100, stage: null, video: VIDEO, durationSec: duration(c) })
        emit(c.id, { event: "render.updated", data: strip(r) })
        setState(c, c.editDirty ? "EDIT_PENDING" : "RENDER_READY")
      }
    }
    if (c.state === "RENDERING" && prev !== `${r.status}:${r.progress}`) emit(c.id, { event: "render.updated", data: strip(r) })
  }
  if (c.state !== before) save()
}

export function advanceAll() {
  const now = Date.now()
  for (const c of db.creatives) advance(c, now)
}

if (typeof window !== "undefined") {
  setInterval(() => {
    for (const cid of listeners.keys()) {
      if (!listeners.get(cid)?.size) continue
      const c = db.creatives.find((x) => x.id === cid)
      if (c) advance(c)
    }
  }, 400)
}

export function newCreative(offer: Offer, by: UserRef, scriptCount: number) {
  const n = db.creatives.filter((c) => c.offerId === offer.id).length + 1
  const now = Date.now()
  const c: MCreative = {
    id: id("cr"), name: `${offer.name} · ${n}`, offerId: offer.id, state: "SCRIPTS_WRITING", createdBy: by, createdAt: now, updatedAt: now, savedAt: now,
    scripts: [], scriptJob: null, selectedScriptId: null, winnersUsed: winnersFor(offer.id),
    faceDescription: null, batches: [], selectedFaceId: null, engine: null, engineModel: null, voiceId: null, format: "VERTICAL_9_16",
    estimatedCostUsd: null, costUsd: 0, scenes: [], renders: [], editSettings: null, editDirty: false, approvedAt: null, isWinner: false,
  }
  db.creatives.unshift(c)
  startScripts(c, scriptCount, true)
  return c
}

export function estimateFor(c: MCreative, engine: Engine, model: string, voiceId?: string) {
  const e = EST[model] ?? EST["kling-3.0"]
  const sceneCount = engine === "LIPSYNC" ? 1 : (c.scripts.find((s) => s.id === c.selectedScriptId)?.full.length ?? 4)
  const dur = duration(c)
  const lines = engine === "LIPSYNC"
    ? [
        { kind: "TTS" as const, units: dur, unit: "second", unitPriceUsd: 0.0006, amountUsd: +(dur * 0.0006).toFixed(4) },
        { kind: "LIPSYNC" as const, units: dur, unit: "second", unitPriceUsd: 0.025, amountUsd: +(dur * 0.025).toFixed(4) },
        { kind: "TRANSCRIBE" as const, units: 1, unit: "clip", unitPriceUsd: 0.0034, amountUsd: 0.0034 },
      ]
    : [
        { kind: "VIDEO" as const, units: dur, unit: "second", unitPriceUsd: +(e.cost / dur).toFixed(4), amountUsd: +(e.cost - 0.01).toFixed(4) },
        { kind: "TRANSCRIBE" as const, units: sceneCount, unit: "clip", unitPriceUsd: 0.0025, amountUsd: 0.01 },
      ]
  const costUsd = +lines.reduce((a, l) => a + l.amountUsd, 0).toFixed(2)
  const desc = (c.faceDescription ?? "").toLowerCase()
  const voice = VOICES.find((v) => v.id === voiceId)
  const faceGender = /\bwoman\b|\bmulher\b/.test(desc) ? "female" : /\bman\b|\bhomem\b/.test(desc) ? "male" : null
  const warnings = engine === "LIPSYNC" && voice && faceGender && voice.gender !== faceGender ? (["voice_gender_mismatch"] as const) : []
  return {
    costUsd, etaSec: e.eta, sceneCount, lines,
    spend: { monthUsd: +db.spentUsd.toFixed(2), capUsd: db.workspace.monthlySpendCapUsd, afterUsd: +(db.spentUsd + costUsd).toFixed(2) },
    warnings: [...warnings],
  }
}

export const VOICES = [
  { id: "v_ava", name: "Ava · warm", language: "en", gender: "female" as const },
  { id: "v_maya", name: "Maya · bright", language: "en", gender: "female" as const },
  { id: "v_claire", name: "Claire · calm", language: "en", gender: "female" as const },
  { id: "v_noah", name: "Noah · steady", language: "en", gender: "male" as const },
  { id: "v_ana", name: "Ana · acolhedora", language: "pt-BR", gender: "female" as const },
  { id: "v_bia", name: "Bia · animada", language: "pt-BR", gender: "female" as const },
  { id: "v_caio", name: "Caio · calmo", language: "pt-BR", gender: "male" as const },
]

// ───────────── feature 2: creatives born from a variation batch (launch) ─────────────
export const mockId = (p: string) => id(p)
export const mockArt = art
export const MOCK_VIDEO = VIDEO
export { defaultEdit }

/**
 * Builds the Creative a batch launch creates (feature-2 §3.3): script A READY and selected, the casting's face selected,
 * LIPSYNC (Pruna), voice/format/edit of the batch, entering SCENES_GENERATING. `state` lets the seed start further along.
 */
export function newVariationCreative(p: {
  offerId: string; name: string; by: UserRef; blocks: ScriptBlock[]; angle: string | null; rationale: string | null
  face: { tone: number; art: number; description: string }; voiceId: string | null; format: VideoFormat; edit: EditSettings
  estimatedCostUsd: number; variation: VariationRef; state?: "SCENES_GENERATING" | "RENDER_READY" | "APPROVED"; ago?: number; sceneMs?: number
  keep?: "SWAP" | "HOOK_TEXT" | null; takeFail?: AsyncErrorCode | null
  /** §13.15: Trocar avatar on Kling/Seedance (no take; one SWAP_VIDEO scene per main stretch) */
  swap?: SwapPlan | null
}): MCreative {
  const now = Date.now()
  const at = now - (p.ago ?? 0)
  const durationSec = p.blocks[p.blocks.length - 1]?.endSec ?? 27
  const script: MScript = {
    id: id("sc"), letter: "A", status: "READY", angle: p.angle, rationale: p.rationale, durationSec, blocks: p.blocks, editedByUser: false, selected: true,
    failReason: null, t0: at, t1: at, failCode: null, full: p.blocks, fullAngle: p.angle ?? "", streamed: 1e9,
  }
  const fb = facesBatch(1, p.face.description, at, at, "READY", p.face.tone)
  const face = fb.faces[p.face.art % 4]
  face.selected = true
  fb.faces = [face]
  const c: MCreative = {
    id: id("cr"), name: p.name, offerId: p.offerId, state: "SCENES_GENERATING", createdBy: p.by, createdAt: at, updatedAt: at, savedAt: at,
    scripts: [script], scriptJob: null, selectedScriptId: script.id, winnersUsed: [],
    faceDescription: p.face.description, batches: [fb], selectedFaceId: face.id, engine: p.swap ? "SCENES" : "LIPSYNC", engineModel: p.swap ? (p.swap.engine === "KLING" ? "kling-3.0" : "seedance-2.0") : "pruna-lipsync", voiceId: p.voiceId, format: p.format,
    estimatedCostUsd: p.estimatedCostUsd, costUsd: 0, scenes: [], renders: [], editSettings: { ...p.edit }, editDirty: false, approvedAt: null, isWinner: false,
    variation: p.variation, keep: p.keep ?? null, take: null,
  }
  const state = p.state ?? "SCENES_GENERATING"
  if (state === "SCENES_GENERATING") {
    if (p.keep === "HOOK_TEXT") c.scenes = [sourceCut(script, face.art, now + 300, now + 300 + Math.min(p.sceneMs ?? 1800, 1800))]
    else if (p.swap) c.scenes = swapScenes(p.swap, face.art, now + 500)
    else {
      const tk = newTake(c, p.keep === "SWAP" ? "AUDIO_LIPSYNC" : "TTS_LIPSYNC", durationSec)
      c.scenes = scenesFrom(script, "LIPSYNC", face.art, now + 500, p.sceneMs ?? 3200, tk.id)
      if (p.takeFail) for (const sc of c.scenes) sc.failCode = p.takeFail
    }
  } else {
    readyScenes(c, at)
    c.costUsd = p.estimatedCostUsd
    c.renders = [render(c, at - 60_000, at - 30_000, "READY")]
    c.state = state
    if (state === "APPROVED") {
      c.approvedAt = at
      db.library.unshift({
        id: c.id, name: c.name, offer: { id: c.offerId, name: offerOf(c).name }, engineLabel: ENGINE_LABEL["pruna-lipsync"], durationSec,
        video: VIDEO, thumbnail: art(face.tone, face.art), isWinner: false, approvedAt: new Date(at).toISOString(), approvedBy: p.by, variation: p.variation,
        editedInEditor: false, adName: mockAdName(c),
      })
    }
  }
  db.creatives.unshift(c)
  save()
  return c
}

/** Created last: the seed uses helpers declared above (const arrows are not hoisted). */
export const db: DB = load()

export type { MScript, MJob, MFace, MScene, MRender, MTake }
