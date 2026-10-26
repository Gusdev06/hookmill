/**
 * In-browser mock of feature 2 (variar campeão): uploads, champions + teardown, variation batches.
 * Follows docs/contratos/feature-2-variar-campeao.md §2-§4 (state machines §3.1/§3.2, limits §2, mock triggers §4.6).
 * Same rules as db.ts: time-based (t0 + step), advanced on read, persisted in localStorage (own key), `?mock=reset` reseeds.
 *
 * Web-mock-only triggers (not in §4.6, for QA of the screens), in the uploaded file NAME:
 *   mock-short / mock-long → 422 MEDIA_TOO_SHORT / MEDIA_TOO_LONG on complete · mock-invalid → 422 MEDIA_INVALID (undecodable)
 *   mock-noaudio → warning no_audio + champion without speech (NO_SPEECH) · mock-lowres → warning low_resolution
 *   mock-expired → 410 UPLOAD_EXPIRED on complete
 * `?adlib=off` (remembered for the tab, `?adlib=on` clears) → GET /champions/config says the Ad Library reader is down (quota, back 2026-10-19).
 */
import type {
  Action, AdLibraryMeta, AsyncErrorCode, BatchEstimate, BatchSettings, CastingStyle, ChampionConfig, ChampionDetail, ChampionRights, ChampionRow, ChampionStatus,
  CreativeRow, EditMap, EstimateLine, Face, FaceCount, FileRef, Job, KeepEditAvailability, KeepEditBlockerHit, SwapEngine, SwapQuote, SwapQuoteWarning, SwapResolution, SwapVoiceSource, Teardown, TeardownSectionKey, TeardownSections, UploadWarning, UserRef, VariationBatch, VariationBatchStatus,
  VariationCasting, VariationItem, VariationKind,
} from "@/lib/api/types"
import { API_URL } from "@/lib/api/client"
import { AD_META, HOOKS, MATCH_CASTINGS, measurements, scriptBlocks, sections, SHARED_CASTING, SHARED_CASTING_MATCH, structure, SWAP_CASTINGS, SWAP_RATIONALE, words } from "./content-variar"
import { type SwapPlan, advance, db, defaultEdit, MOCK_VIDEO, mockArt, mockId, newVariationCreative, offerOf, save as saveDb, strip, toRow, triggerIn, VOICES } from "./db"

// ───────────── limits (feature-2 §2) ─────────────
// variacao-auto-v1 §2: the spec limits (500 MB, 4 s to 3 min) apply to the old flow too
export const LIMITS = { maxBytes: 524_288_000, minSec: 4, maxSec: 180, mimeTypes: ["video/mp4", "video/quicktime"] }
const USD_PER_SEC = 0.01 // analysis: Whisper + Claude with frames ≈ US$ 0.30 for 30 s (§7)
const ENABLED: VariationKind[] = ["SWAP_AVATAR", "NEW_HOOKS"]
const ALL_KINDS: VariationKind[] = ["SWAP_AVATAR", "NEW_HOOKS", "COPY_NEW", "REMIX_EDIT"]
export const COUNT_RANGE: Record<VariationKind, [number, number]> = { SWAP_AVATAR: [1, 4], NEW_HOOKS: [2, 5], COPY_NEW: [1, 4], REMIX_EDIT: [1, 4], AUTO_EDIT: [0, 0] }
const PRICE = { lipsync: 0.025, tts: 0.0006, transcribe: 0.002, face: 0.006 }
/** §13.15.5 unit prices (per second): Kling 3.0 1080p mute / with sound, Seedance 2.0 480p / 720p (audio included), v2v lipsync. */
const SWAP_PRICE = { klingMute: 0.112, klingSound: 0.168, seedance480: 0.108, seedance720: 0.24, v2v: 0.05 }
const KIND_LABEL: Record<VariationKind, string> = { SWAP_AVATAR: "Avatar", NEW_HOOKS: "Hook", COPY_NEW: "Copy", REMIX_EDIT: "Layout", AUTO_EDIT: "Auto" }

export const ADLIB_KEY = "mock:adlib"
/** §13.15 (Gusta, 08/10): "engine voice" is released on Seedance; on Kling it stays off (the voice changes between stretches). */
const engineVoiceOn = (engine: SwapEngine) => engine === "SEEDANCE"
export function adLibrary(): ChampionConfig["adLibrary"] {
  const off = typeof window !== "undefined" && sessionStorage.getItem(ADLIB_KEY) === "off"
  return off ? { available: false, reason: "quota", retryAfter: "2026-10-19" } : { available: true, reason: null, retryAfter: null }
}
export function config(): ChampionConfig {
  return { ...LIMITS, adLibrary: adLibrary(), analysisUsdPerSec: USD_PER_SEC, kinds: ALL_KINDS.map((kind) => ({ kind, enabled: ENABLED.includes(kind) })) }
}

// ───────────── model ─────────────
export interface MUpload {
  id: string; filename: string; mimeType: string; sizeBytes: number; status: "PENDING" | "READY" | "FAILED" | "EXPIRED"
  expiresAt: number; sent: boolean; durationSec: number | null; width: number | null; height: number | null; warnings: UploadWarning[]
}
interface MStepJob {
  id: string; type: "CHAMPION_RESOLVE" | "CHAMPION_ANALYZE"; keys: string[]; t0: number; stepMs: number; startStep: number
  failAt: number | null; failCode: AsyncErrorCode | null
}
export interface MChampion {
  id: string; name: string; offerId: string; status: ChampionStatus; rights: ChampionRights; notes: string | null
  adLibraryUrl: string | null; adMeta: AdLibraryMeta | null; uploadId: string | null
  durationSec: number | null; width: number; height: number; hasAudio: boolean; hasSpeech: boolean; lowRes: boolean; tone: number; face: number
  job: MStepJob | null; reached: number; errorCode: AsyncErrorCode | null; failReason: string | null; action: Action | null
  analyzedAt: number | null; overrides: Partial<TeardownSections>; wordFixes: Record<number, string>; editedSections: TeardownSectionKey[]
  costUsd: number; createdBy: UserRef; createdAt: number; updatedAt: number; archived: boolean
  /** legenda-protegida-v1 §2.3: version without the burned-in captions */
  cleanUploadId?: string | null
}
type MFace = Face & { t0: number; t1: number; tone: number; art: number; failCode: AsyncErrorCode | null }
interface MCasting { id: string; scope: "SHARED" | "ITEM"; description: string; rounds: { batch: number; faces: MFace[] }[]; selectedFaceId: string | null }
interface MItem {
  id: string; kind: VariationKind; index: number; isControl: boolean; included: boolean; t0: number; t1: number; failCode: AsyncErrorCode | null
  done: boolean; lever: string | null; rationale: string | null; hook: { speech: string; onScreenText: string | null } | null
  castingId: string | null; creativeId: string | null; failed: boolean
}
export interface MBatch {
  id: string; championId: string; offerId: string; status: VariationBatchStatus; language: string
  requests: { kind: VariationKind; count: number }[]; settings: BatchSettings; notes: string | null; castingStyle: CastingStyle
  jobId: string; t0: number; items: MItem[]; castings: MCasting[]
  estimatedCostUsd: number | null; costUsd: number; launchedAt: number | null; createdBy: UserRef; createdAt: number
}
interface Store { uploads: MUpload[]; champions: MChampion[]; batches: MBatch[] }

const GUSTA: UserRef = { id: "u_gusta", name: "Gusta", initials: "G" }
const ANALYZE_KEYS = ["reading_video", "extracting_audio", "transcribing", "measuring", "mapping_edit", "diagnosing"]
const RESOLVE_KEYS = ["fetching_ad", "downloading_video"]
const REASON: Partial<Record<AsyncErrorCode, string>> = {
  AD_LIBRARY_UNAVAILABLE: "The Ad Library reader hit its monthly limit. It is back on Oct 19. Download the video from the ad and upload the file.",
  AD_NOT_FOUND: "We couldn't find that ad in the Ad Library. It may have been removed. Upload the video file instead.",
  AD_HAS_NO_VIDEO: "That ad is an image, not a video. Upload a video file instead.",
  MEDIA_INVALID: "The video didn't decode to the end (the file may be cut short). Upload it again.",
  PROVIDER_ERROR: "The diagnosis service returned an error. The transcript and measurements are saved; analyze again to finish.",
  INTERRUPTED: "The analysis was interrupted. Analyze again; finished steps are reused.",
  SAFETY_BLOCK: "The image service flagged the description as unsafe. Edit the description and generate again.",
  PROVIDER_TIMEOUT: "The image service took too long to answer. Try again.",
  CANCELLED: "The task was cancelled by the provider. Try again.",
  RATE_LIMITED: "The script service hit its rate limit. Write this one again.",
}

/** Uploaded bytes live only in memory (object URL), so the player shows the user's own video until a reload. */
const blobs = new Map<string, string>()
export function keepBlob(uploadId: string, blob: Blob) {
  const prev = blobs.get(uploadId)
  if (prev) URL.revokeObjectURL(prev)
  blobs.set(uploadId, URL.createObjectURL(blob))
}
export const blobUrl = (uploadId: string | null) => (uploadId ? blobs.get(uploadId) ?? null : null)

// ───────────── persistence ─────────────
const KEY = "mock:f2:v2"
function load(): Store {
  if (typeof window !== "undefined") {
    const reset = new URLSearchParams(window.location.search).get("mock") === "reset"
    if (reset) localStorage.removeItem(KEY)
    const raw = reset ? null : localStorage.getItem(KEY)
    if (raw) {
      try { return JSON.parse(raw) as Store } catch {}
    }
  }
  return { uploads: [], champions: [], batches: [] }
}
let timer: ReturnType<typeof setTimeout> | null = null
export function save() {
  if (typeof window === "undefined" || timer) return
  timer = setTimeout(() => {
    timer = null
    localStorage.setItem(KEY, JSON.stringify(f2))
  }, 200)
}

// ───────────── uploads ─────────────
export function newUpload(b: { filename: string; mimeType: string; sizeBytes: number }): MUpload {
  const u: MUpload = { id: mockId("up"), ...b, status: "PENDING", expiresAt: Date.now() + 30 * 60_000, sent: false, durationSec: null, width: null, height: null, warnings: [] }
  f2.uploads.push(u)
  save()
  return u
}
export const uploadTarget = (u: MUpload) => ({
  uploadId: u.id, method: "PUT" as const, url: `${API_URL}/uploads/${u.id}/content`, headers: { "Content-Type": u.mimeType }, expiresAt: new Date(u.expiresAt).toISOString(),
})
/** Reads duration and size from the bytes with a <video> element (stand-in for ffprobe). */
export function probe(uploadId: string): Promise<{ durationSec: number; width: number; height: number } | null> {
  const url = blobs.get(uploadId)
  if (!url || typeof document === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    const v = document.createElement("video")
    const t = setTimeout(() => resolve(null), 3000)
    v.preload = "metadata"
    v.muted = true
    v.onloadedmetadata = () => { clearTimeout(t); resolve(Number.isFinite(v.duration) ? { durationSec: Math.round(v.duration * 100) / 100, width: v.videoWidth, height: v.videoHeight } : null) }
    v.onerror = () => { clearTimeout(t); resolve(null) }
    v.src = url
  })
}
export function uploadFile(u: MUpload): FileRef {
  return { id: `f_${u.id}`, url: blobs.get(u.id) ?? MOCK_VIDEO.url, mimeType: u.mimeType, width: u.width ?? 1080, height: u.height ?? 1920, durationSec: u.durationSec ?? 29 }
}

// ───────────── champions ─────────────
const frame = (c: MChampion) => (i: number) => mockArt((c.tone + Math.floor(i / 4)) % 4, (c.face + i) % 4)
export const offerName = (offerId: string) => db.offers.find((o) => o.id === offerId)?.name ?? "—"

function stepJob(type: MStepJob["type"], startStep = 0, failAt: number | null = null, failCode: AsyncErrorCode | null = null, stepMs?: number): MStepJob {
  return { id: mockId("job"), type, keys: type === "CHAMPION_RESOLVE" ? RESOLVE_KEYS : ANALYZE_KEYS, t0: Date.now(), stepMs: stepMs ?? (type === "CHAMPION_RESOLVE" ? 2000 : 2600), startStep, failAt, failCode }
}
function jobStep(j: MStepJob, now: number) {
  return Math.min(j.keys.length, j.startStep + Math.floor((now - j.t0) / j.stepMs))
}
function jobView(j: MStepJob, c: MChampion, now = Date.now()): Job {
  const step = jobStep(j, now)
  const failed = j.failAt !== null && step >= j.failAt
  const at = failed ? j.failAt! : step
  const done = !failed && step >= j.keys.length
  const remaining = (j.keys.length - at) * j.stepMs - ((now - j.t0) % j.stepMs)
  return {
    id: j.id, type: j.type, status: failed ? "FAILED" : done ? "SUCCEEDED" : "RUNNING", stage: failed || done ? null : j.keys[at],
    progress: Math.round((at / j.keys.length) * 100), etaSec: failed || done ? null : Math.max(1, Math.ceil(remaining / 1000)),
    checklist: j.keys.map((key, i) => ({ key, done: i < at })),
    errorCode: failed ? j.failCode : null, failReason: failed ? c.failReason : null, action: failed ? c.action : null, output: null,
  }
}

export function newChampion(p: { offerId: string; name?: string; upload: MUpload | null; adLibraryUrl: string | null; rights: ChampionRights; notes: string | null }): MChampion {
  const now = Date.now()
  const u = p.upload
  const n = f2.champions.filter((c) => c.offerId === p.offerId).length + 1
  const c: MChampion = {
    id: mockId("ch"), name: p.name?.trim() || (u ? u.filename.replace(/\.[^.]+$/, "") : `${offerName(p.offerId)} · winner ${n}`), offerId: p.offerId,
    status: u ? "ANALYZING" : "RESOLVING", rights: p.rights, notes: p.notes, adLibraryUrl: p.adLibraryUrl, adMeta: null, uploadId: u?.id ?? null,
    durationSec: u?.durationSec ?? null, width: u?.width ?? 1080, height: u?.height ?? 1920, hasAudio: !u?.warnings.includes("no_audio"),
    hasSpeech: false, lowRes: !!u?.warnings.includes("low_resolution"), tone: n % 4, face: (n + 1) % 4,
    job: null, reached: 0, errorCode: null, failReason: null, action: null, analyzedAt: null, overrides: {}, wordFixes: {}, editedSections: [],
    costUsd: 0, createdBy: GUSTA, createdAt: now, updatedAt: now, archived: false,
  }
  if (u) {
    if (p.adLibraryUrl) c.adMeta = linkMeta(p.adLibraryUrl)
    startAnalysis(c)
  } else {
    const url = p.adLibraryUrl ?? ""
    const failCode: AsyncErrorCode | null = url.includes("mock-ad-notfound") ? "AD_NOT_FOUND" : url.includes("mock-ad-novideo") ? "AD_HAS_NO_VIDEO" : null
    c.job = stepJob("CHAMPION_RESOLVE", 0, failCode ? 1 : null, failCode)
    if (failCode) { c.failReason = REASON[failCode]!; c.action = "upload_video" }
  }
  f2.champions.unshift(c)
  save()
  return c
}

const adId = (url: string) => /[?&]id=(\d+)/.exec(url)?.[1] ?? "0"
function linkMeta(url: string): AdLibraryMeta {
  const base = AD_META(adId(url))
  if (url.includes("mock-ad-notfound")) return { ...base, status: "not_found", pageName: null, primaryText: null, headline: null, ctaText: null, linkUrl: null, daysRunning: null, isActive: null, collationCount: null }
  return base
}

export function startAnalysis(c: MChampion, reuse = false) {
  const failCode: AsyncErrorCode | null = (c.notes ?? "").includes("[mock:analysis-fail]") ? "PROVIDER_ERROR" : null
  // A retry reuses what was already done (transcript, measurements): it resumes where the last run stopped (§3.1).
  const startStep = reuse ? Math.min(c.reached, ANALYZE_KEYS.length - 1) : 0
  c.job = stepJob("CHAMPION_ANALYZE", startStep, failCode ? 5 : null, failCode)
  c.status = "ANALYZING"
  c.errorCode = null
  c.failReason = failCode ? REASON.PROVIDER_ERROR! : null
  c.action = failCode ? "analyze_again" : null
  c.updatedAt = Date.now()
}

/** Advances the champion's job by the clock (§3.1). */
export function advanceChampion(c: MChampion, now = Date.now()) {
  if (!c.job || (c.status !== "RESOLVING" && c.status !== "ANALYZING")) return c
  const j = c.job
  const step = jobStep(j, now)
  if (c.status === "RESOLVING") {
    if (j.failAt !== null && step >= j.failAt) {
      Object.assign(c, { status: "FAILED", errorCode: j.failCode, adMeta: linkMeta(c.adLibraryUrl ?? ""), updatedAt: now })
      if (j.failCode === "AD_HAS_NO_VIDEO") c.adMeta = { ...linkMeta(c.adLibraryUrl ?? ""), status: "no_video" }
    } else if (step >= j.keys.length) {
      // §4.6: any other ?id= resolves with a synthetic 20 s video with speech
      Object.assign(c, { adMeta: linkMeta(c.adLibraryUrl ?? ""), durationSec: 20, width: 1080, height: 1920, hasAudio: true })
      c.costUsd += 0.01
      db.spentUsd += 0.01
      startAnalysis(c)
    }
  } else if (c.status === "ANALYZING") {
    c.reached = Math.max(c.reached, j.failAt !== null ? Math.min(step, j.failAt) : step)
    if (j.failAt !== null && step >= j.failAt) {
      Object.assign(c, { status: "FAILED", errorCode: j.failCode, updatedAt: now })
      addCost(c, (c.durationSec ?? 29) * PRICE.transcribe)
    } else if (step >= j.keys.length) {
      c.durationSec ??= 29
      Object.assign(c, { status: "READY", hasSpeech: c.hasAudio, analyzedAt: now, updatedAt: now, errorCode: null, failReason: null, action: null })
      addCost(c, c.durationSec * USD_PER_SEC)
    }
  }
  save()
  return c
}
function addCost(c: MChampion, usd: number) {
  c.costUsd = Math.round((c.costUsd + usd) * 100) / 100
  db.spentUsd += usd
  saveDb()
}

export function teardownOf(c: MChampion): Teardown | null {
  if (c.status !== "READY" && !(c.status === "FAILED" && c.analyzedAt)) return null
  const dur = c.durationSec ?? 29
  const ws = words(dur, c.hasSpeech).map((w, i) => (c.wordFixes[i] !== undefined ? { ...w, word: c.wordFixes[i] } : w))
  return {
    id: `td_${c.id}`, language: "en", analyzedAt: new Date(c.analyzedAt ?? c.updatedAt).toISOString(), editedSections: c.editedSections,
    transcript: { text: ws.map((w) => w.word).join(" "), words: ws, wpm: ws.length ? Math.round((ws.length / dur) * 60) : 0 },
    measurements: measurements({ durationSec: dur, width: c.width, height: c.height, hasAudio: c.hasAudio, frame: frame(c) }),
    sections: { ...sections({ durationSec: dur, width: c.width, height: c.height, hasSpeech: c.hasSpeech, adMeta: c.adMeta }), ...c.overrides },
    editMap: editMapFor(c),
  }
}

/**
 * §13.1-13.2 EditMap of the mock champion (the layout of content-variar: full-frame head, then head on top 58% + phone panel, then full frame).
 * Web-mock-only triggers in the champion NOTES: [mock:not-mapped] (analyzed before mapping_edit) · [mock:keep-two-faces] (multiple_faces in
 * the split segment) · [mock:keep-overlay] (overlay_over_face in the proof block) · [mock:keep-straddle] (caption_straddles_face) ·
 * [mock:hook-over-video] (headline drawn straight on the video → NEW_HOOKS TEXT blocked).
 */
const MAP_FPS = 30
export function editMapFor(c: MChampion): EditMap | null {
  if (c.status !== "READY" && !(c.status === "FAILED" && c.analyzedAt)) return null
  const notes = c.notes ?? ""
  if (notes.includes("[mock:not-mapped]")) return null
  const dur = c.durationSec ?? 29
  const W = c.width
  const H = c.height
  const k = dur / 29
  const fr = (sec: number) => Math.round(sec * MAP_FPS)
  const frameCount = fr(dur)
  const a = fr(11 * k)
  const b = fr(19 * k)
  const blocks = structure(dur)
  const hookEnd = fr(blocks[0].endSec)
  const proof = blocks.find((x) => x.function === "proof") ?? blocks[blocks.length - 2]
  const full = { x: 0, y: 0, w: W, h: H }
  const top = { x: 0, y: 0, w: W, h: Math.round(H * 0.58) }
  const box = (x: number, y: number, w: number, h: number) => ({ x: Math.round(W * x), y: Math.round(H * y), w: Math.round(W * w), h: Math.round(H * h) })
  const twoFaces = notes.includes("[mock:keep-two-faces]")
  const overVideo = notes.includes("[mock:hook-over-video]")
  const headlineBox = box(0.08, 0.07, 0.84, 0.075)
  const base = { fontId: "montserrat-900" as const, uppercase: true, lineHeight: 1.05, strokeColor: null, strokeWidthPx: 0, shadow: false, align: "center" as const, highlightColor: null }
  const map: EditMap = {
    version: 1, width: W, height: H, fps: MAP_FPS, frameCount,
    cells: [
      { startFrame: 0, endFrame: a, cells: [full] },
      { startFrame: a, endFrame: b, cells: [top, { x: 0, y: top.h, w: W, h: H - top.h }] },
      { startFrame: b, endFrame: frameCount, cells: [full] },
    ],
    faceTrack: [
      { startFrame: 0, endFrame: a, region: full, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.31, y: 0.2, w: 0.38, h: 0.24 } }], facesMax: 1, minScore: 0.94 },
      { startFrame: a, endFrame: b, region: top, fullFrame: false, faceInRegion: [{ atFrame: a, box: { x: 0.33, y: 0.18, w: 0.34, h: 0.38 } }], facesMax: twoFaces ? 2 : 1, minScore: 0.91 },
      { startFrame: b, endFrame: frameCount, region: full, fullFrame: true, faceInRegion: [{ atFrame: b, box: { x: 0.31, y: 0.2, w: 0.38, h: 0.24 } }], facesMax: 1, minScore: 0.93 },
    ],
    layers: [
      {
        id: "ly_headline", kind: "headline", startFrame: 0, endFrame: hookEnd, box: headlineBox,
        background: overVideo ? { kind: "none", color: null, box: null } : { kind: "solid", color: "#F5F5F0", box: headlineBox },
        style: { ...base, fontSizePx: Math.round(H * 0.034), color: overVideo ? "#FFFFFF" : "#16130F", strokeColor: overVideo ? "#000000" : null, strokeWidthPx: overVideo ? 4 : 0 },
        text: blocks[0].onScreen, wordsPerPage: null, source: "vision+pixel",
      },
      {
        id: "ly_caption", kind: "caption", startFrame: fr(0.1), endFrame: frameCount, box: box(0.1, 0.64, 0.8, 0.08),
        background: { kind: "none", color: null, box: null },
        style: { ...base, fontId: "anton-400", fontSizePx: Math.round(H * 0.04), color: "#FFFFFF", highlightColor: "#FFD84A", strokeColor: "#000000", strokeWidthPx: 5, shadow: true },
        text: null, wordsPerPage: 3, source: "vision",
      },
      {
        id: "ly_rating", kind: "text", startFrame: fr(proof.startSec), endFrame: fr(proof.endSec), box: box(0.25, 0.78, 0.5, 0.05),
        background: { kind: "pill", color: "#FFD84A", box: box(0.24, 0.775, 0.52, 0.06) },
        style: { ...base, fontId: "poppins-800", uppercase: false, fontSizePx: Math.round(H * 0.026), color: "#16130F" },
        text: proof.onScreen, wordsPerPage: null, source: "vision+pixel",
      },
    ],
    overlaysOverFace: notes.includes("[mock:keep-overlay]") ? [{ startFrame: fr(proof.startSec), endFrame: fr(proof.endSec), description: "Rating card slides over the lower half of the face" }] : [],
    profile: {
      gender: "male", ageBand: "30-40", ethnicity: "latino", hair: "short dark hair", clothing: "grey crewneck", setting: "bright apartment kitchen",
      lighting: "natural window light", framing: "chest-up, face at ~24% of the frame height", pose: "facing the camera, phone in hand",
    },
    keepEdit: { SWAP_AVATAR: { available: true, blockers: [] }, NEW_HOOKS: { available: true, blockers: [] } },
    // §13.14: a 1.5 s b-roll right after the cut to the split screen, so the swap has two main stretches
    timeline: [
      { startFrame: 0, endFrame: a, kind: "main" },
      { startFrame: a, endFrame: a + fr(1.5), kind: "broll" },
      { startFrame: a + fr(1.5), endFrame: frameCount, kind: "main" },
    ],
  }
  const sec = (f: number) => Math.round((f / MAP_FPS) * 100) / 100
  const swap: KeepEditBlockerHit[] = []
  if (twoFaces) swap.push({ reason: "multiple_faces", startSec: sec(a), endSec: sec(b) })
  if (map.overlaysOverFace.length) swap.push({ reason: "overlay_over_face", startSec: proof.startSec, endSec: proof.endSec })
  if (notes.includes("[mock:keep-straddle]")) swap.push({ reason: "caption_straddles_face", startSec: sec(a), endSec: sec(b) })
  const hooks: KeepEditBlockerHit[] = overVideo ? [{ reason: "hook_text_over_video", startSec: 0, endSec: blocks[0].endSec }] : []
  map.keepEdit = { SWAP_AVATAR: { available: !swap.length, blockers: swap }, NEW_HOOKS: { available: !hooks.length, blockers: hooks } }
  return map
}

const NOT_MAPPED: KeepEditAvailability = { available: false, blockers: [{ reason: "not_mapped", startSec: null, endSec: null }] }
export function keepEditOf(c: MChampion): ChampionDetail["keepEdit"] {
  return editMapFor(c)?.keepEdit ?? { SWAP_AVATAR: NOT_MAPPED, NEW_HOOKS: NOT_MAPPED }
}

/** §13.15.1 (B) availability. Web-mock trigger in the champion notes: [mock:caption-unredrawable] (bare karaoke over a main stretch, outside the face). */
export function engineVoiceOf(c: MChampion): KeepEditAvailability {
  const map = editMapFor(c)
  if (!map) return NOT_MAPPED
  if (!map.keepEdit.SWAP_AVATAR.available) return map.keepEdit.SWAP_AVATAR
  if ((c.notes ?? "").includes("[mock:caption-unredrawable]")) {
    const k = (c.durationSec ?? 29) / 29
    return { available: false, blockers: [{ reason: "caption_unredrawable", startSec: Math.round(12.5 * k * 100) / 100, endSec: Math.round(19 * k * 100) / 100 }] }
  }
  return { available: true, blockers: [] }
}

/** Main stretches (§13.15.2) of the mock champion, in seconds, with the words spoken in each (relative to the video). */
function mainSpans(c: MChampion) {
  const map = editMapFor(c)
  const dur = c.durationSec ?? 29
  const spans = map?.timeline?.filter((x) => x.kind === "main").map((x) => ({ startSec: x.startFrame / map.fps, endSec: x.endFrame / map.fps })) ?? [{ startSec: 0, endSec: dur }]
  const ws = words(dur, c.hasSpeech)
  return spans.map((sp) => ({ ...sp, speech: ws.filter((w) => w.startSec >= sp.startSec && w.startSec < sp.endSec).map((w) => w.word).join(" ") }))
}
const r2 = (n: number) => Math.round(n * 100) / 100
/** planSwapWindows (§13.15.2), simplified for the mock: equal windows under the source limit, genSec by the formula. */
function swapWindows(len: number, engine: "KLING" | "SEEDANCE", voice: SwapVoiceSource) {
  const B = voice === "ENGINE_VOICE"
  const limit = B ? 12.5 : 14.5
  const min = engine === "KLING" ? 3 : 4
  const n = Math.max(1, Math.ceil(len / limit))
  const w = len / n
  return Array.from({ length: n }, (_, k) => ({
    startSec: r2(k * w), endSec: r2((k + 1) * w),
    genSec: Math.min(15, Math.max(min, Math.ceil(B ? w * 1.15 + 0.3 : w + 0.2))),
  }))
}
/** Seedance resolution by the biggest region (§13.15.2): the mock champion's main stretches are full frame → 720p; Kling is always 1080p. */
const swapResolution = (engine: SwapEngine): SwapResolution | null => (engine === "KLING" ? "1080p" : engine === "SEEDANCE" ? "720p" : null)

function quoteFor(c: MChampion, b: MBatch, engine: SwapEngine, voice: SwapVoiceSource, nItems: number): SwapQuote {
  const spans = mainSpans(c)
  const B = voice === "ENGINE_VOICE"
  const resolution = swapResolution(engine)
  let lines: EstimateLine[]
  let etaSec: number
  const warnings: SwapQuoteWarning[] = []
  if (engine === "LIPSYNC") {
    const take = spans[spans.length - 1].endSec - spans[0].startSec
    lines = [line("LIPSYNC", take, PRICE.lipsync)]
    etaSec = 360
  } else {
    const wins = spans.map((sp) => swapWindows(sp.endSec - sp.startSec, engine, voice))
    const gen = wins.flat().reduce((a, w) => a + w.genSec, 0)
    const main = spans.reduce((a, sp) => a + sp.endSec - sp.startSec, 0)
    const unit = engine === "KLING" ? (B ? SWAP_PRICE.klingSound : SWAP_PRICE.klingMute) : resolution === "480p" ? SWAP_PRICE.seedance480 : SWAP_PRICE.seedance720
    lines = [line("VIDEO", gen, unit), B ? line("TRANSCRIBE", main, PRICE.transcribe) : line("LIPSYNC", main, SWAP_PRICE.v2v)]
    etaSec = Math.max(...wins.map((w) => w.length)) * 150 + 110
    if (B) warnings.push("voice_may_vary")
    if (spans.some((sp) => sp.endSec - sp.startSec < (engine === "KLING" ? 3 : 4))) warnings.push("short_segment_padded")
  }
  const perItemUsd = r2(lines.reduce((a, l) => a + l.amountUsd, 0))
  const ev = engineVoiceOf(c)
  const notEnabled = B && !engineVoiceOn(engine)
  const blockers = B ? ev.blockers : engine === "LIPSYNC" ? [] : keepEditOf(c).SWAP_AVATAR.blockers
  const valid = b.settings.keepEdit || engine === "LIPSYNC"
  return {
    engine, voiceSource: voice, available: valid && !notEnabled && !blockers.length, blockers, notEnabled,
    selected: (b.settings.swapEngine ?? "LIPSYNC") === engine && (engine === "LIPSYNC" ? b.settings.voiceSource !== "ENGINE_VOICE" : b.settings.voiceSource === voice),
    resolution, perItemUsd, costUsd: r2(perItemUsd * nItems), etaSec, lines, warnings,
  }
}
/** 5 rows (§13.15.6): LIPSYNC/CHAMPION_AUDIO, KLING ×2, SEEDANCE ×2. */
function swapQuotesOf(c: MChampion, b: MBatch, nItems: number): SwapQuote[] {
  return [
    quoteFor(c, b, "LIPSYNC", "CHAMPION_AUDIO", nItems),
    quoteFor(c, b, "KLING", "CHAMPION_AUDIO", nItems), quoteFor(c, b, "KLING", "ENGINE_VOICE", nItems),
    quoteFor(c, b, "SEEDANCE", "CHAMPION_AUDIO", nItems), quoteFor(c, b, "SEEDANCE", "ENGINE_VOICE", nItems),
  ]
}
/** §13.15.1: what PATCH/POST settings refuse. null = valid. */
export function swapSettingsError(c: MChampion, s: BatchSettings): { field: string; rule: string } | { blockers: KeepEditBlockerHit[] } | null {
  const engine = s.swapEngine ?? "LIPSYNC"
  if (engine === "LIPSYNC" && s.voiceSource === "ENGINE_VOICE") return { field: "settings.voiceSource", rule: "engine_voice_needs_video_engine" }
  if (engine !== "LIPSYNC" && !s.keepEdit) return { field: "settings.swapEngine", rule: "video_engine_needs_keep_edit" }
  if (engine !== "LIPSYNC" && s.voiceSource === "CATALOG") return { field: "settings.voiceSource", rule: "catalog_voice_not_in_keep_edit" }
  if (s.voiceSource === "ENGINE_VOICE" && !engineVoiceOn(engine)) return { field: "settings.voiceSource", rule: "engine_voice_not_enabled" }
  if (s.voiceSource === "ENGINE_VOICE") {
    const ev = engineVoiceOf(c)
    if (!ev.available) return { blockers: ev.blockers }
  }
  return null
}

const batchesOf = (c: MChampion) => f2.batches.filter((b) => b.championId === c.id)
function creativesOf(c: MChampion) {
  const ids = new Set(batchesOf(c).flatMap((b) => b.items.map((i) => i.creativeId).filter(Boolean)))
  return db.creatives.filter((x) => ids.has(x.id))
}

export function championRow(c: MChampion): ChampionRow {
  advanceChampion(c)
  const created = creativesOf(c)
  return {
    id: c.id, name: c.name, offer: { id: c.offerId, name: offerName(c.offerId) }, status: c.status, rights: c.rights,
    sources: [...(c.uploadId ? (["UPLOAD"] as const) : []), ...(c.adLibraryUrl ? (["AD_LIBRARY"] as const) : [])],
    thumbnail: c.durationSec ? mockArt(c.tone, c.face) : null, durationSec: c.durationSec, language: c.status === "READY" ? "en" : null,
    batchesCount: batchesOf(c).length, variationsCount: created.length, winnersCount: created.filter((x) => x.isWinner).length,
    createdBy: c.createdBy, updatedAt: new Date(c.updatedAt).toISOString(),
  }
}

export function availableKinds(c: MChampion): ChampionDetail["availableKinds"] {
  return ALL_KINDS.map((kind) => {
    if (!ENABLED.includes(kind)) return { kind, available: false, reason: "NOT_ENABLED" as const }
    if (c.status === "READY" && !c.hasSpeech) return { kind, available: false, reason: "NO_SPEECH" as const }
    return { kind, available: c.status === "READY", reason: null }
  })
}

export function championDetail(c: MChampion): ChampionDetail {
  const row = championRow(c)
  const video: FileRef | null = c.durationSec
    ? { id: `f_video_${c.id}`, url: blobUrl(c.uploadId) ?? MOCK_VIDEO.url, mimeType: "video/mp4", width: c.width, height: c.height, durationSec: c.durationSec }
    : null
  return {
    ...row, video, adLibraryUrl: c.adLibraryUrl, adMeta: c.adMeta, notes: c.notes,
    job: c.job ? jobView(c.job, c) : null,
    errorCode: c.status === "FAILED" ? c.errorCode : null, failReason: c.status === "FAILED" ? c.failReason : null, action: c.status === "FAILED" ? c.action : null,
    teardown: teardownOf(c), availableKinds: availableKinds(c), keepEdit: keepEditOf(c), engineVoice: engineVoiceOf(c), costUsd: c.costUsd,
    metaAd: null,
    cleanVideo: cleanFileOf(c.cleanUploadId),
  }
}
/** legenda-protegida §2.3: the clean version as a FileRef (null = none) */
export function cleanFileOf(uploadId: string | null | undefined): FileRef | null {
  const up = uploadId ? f2.uploads.find((x) => x.id === uploadId) : null
  return up ? { ...uploadFile(up), id: `f_clean_${up.id}` } : null
}
/** web-mock: a file named `mock-mismatch…` is not the same video (422 CLEAN_VERSION_MISMATCH) */
export const cleanMismatch = (uploadId: string) => {
  const up = f2.uploads.find((x) => x.id === uploadId)
  return up?.filename.includes("mock-mismatch") ? ("duration" as const) : null
}

// ───────────── batches ─────────────
const voiceFor = (language: string) => VOICES.find((v) => v.language === language)?.id ?? VOICES[0].id

function newCasting(scope: MCasting["scope"], description: string, tone: number, t0: number): MCasting {
  // like the API: the plan writes who appears; faces come when the user asks (POST …/faces/generate)
  void tone
  void t0
  return { id: mockId("cs"), scope, description, rounds: [], selectedFaceId: null }
}
function faceRound(batch: number, description: string, tone: number, t0: number, count: FaceCount) {
  const failCode = triggerIn(description)
  return {
    batch,
    faces: Array.from({ length: count }, (_, p) => p).map((p): MFace => ({
      id: mockId("fa"), batch, position: p, status: "QUEUED", image: null, failReason: null, errorCode: null, action: null, selected: false,
      t0: t0 + p * 300, t1: t0 + 2600 + p * 500, tone, art: p, failCode,
    })),
  }
}

export function newBatch(c: MChampion, requests: { kind: VariationKind; count: number }[], settings: Partial<BatchSettings> | undefined, notes: string | null, castingStyle: CastingStyle = "DIVERSE"): MBatch {
  const now = Date.now()
  const b: MBatch = {
    id: mockId("vb"), championId: c.id, offerId: c.offerId, status: "PLANNING", language: "en", requests,
    settings: {
      format: c.height > c.width ? (c.height / c.width > 1.6 ? "VERTICAL_9_16" : "PORTRAIT_4_5") : "SQUARE_1_1",
      voiceId: null, voiceSource: "CHAMPION_AUDIO", engine: null, engineModel: null, edit: defaultEdit(offerOf({ offerId: c.offerId } as never)),
      // §13: on by default when every requested kind can keep the edit
      keepEdit: requests.every((r) => (r.kind === "SWAP_AVATAR" || r.kind === "NEW_HOOKS") && keepEditOf(c)[r.kind].available), hookMode: "TEXT",
      swapEngine: "LIPSYNC",
      ...settings,
    },
    notes, castingStyle, jobId: mockId("job"), t0: now, items: [], castings: [], estimatedCostUsd: null, costUsd: 0, launchedAt: null, createdBy: GUSTA, createdAt: now,
  }
  plan(b, c)
  f2.batches.unshift(b)
  save()
  return b
}

/** Writes the plan: one lever per item; NEW_HOOKS gets an automatic control sharing one casting (§1.2). */
function plan(b: MBatch, c: MChampion) {
  const now = Date.now()
  const notes = b.notes ?? ""
  const failAll = notes.includes("[mock:fail-all]")
  const failOne = [...notes.matchAll(/\[mock:fail-item:([A-Z_]+):(\d+)\]/g)].map((m) => `${m[1]}:${m[2]}`)
  b.t0 = now
  b.jobId = mockId("job")
  b.status = "PLANNING"
  b.items = []
  b.castings = []
  let slot = 0
  const at = () => now + 1500 + slot++ * 1100
  for (const r of b.requests) {
    if (r.kind === "SWAP_AVATAR") {
      for (let i = 0; i < r.count; i++) {
        const cast = newCasting("ITEM", (b.castingStyle === "DIVERSE" ? SWAP_CASTINGS : MATCH_CASTINGS)[i % SWAP_CASTINGS.length], (i + 1) % 4, now + 1200)
        b.castings.push(cast)
        const t0 = at()
        b.items.push(item(r.kind, i, false, t0, failAll || failOne.includes(`${r.kind}:${i}`), { lever: "avatar", rationale: SWAP_RATIONALE[i % SWAP_RATIONALE.length], castingId: cast.id }))
      }
    }
    if (r.kind === "NEW_HOOKS" && b.settings.keepEdit) {
      // §13.4 (a): written hook on the champion's own video. No control (the champion is the control), no casting, speech stays the original.
      const og = teardownOf(c)?.sections.hook.data
      for (let i = 0; i < r.count; i++) {
        const h = HOOKS[i % HOOKS.length]
        b.items.push(item(r.kind, i, false, at(), failAll || failOne.includes(`${r.kind}:${i}`), {
          lever: h.lever, rationale: h.rationale, hook: { speech: og?.spoken ?? "", onScreenText: h.onScreenText },
        }))
      }
      continue
    }
    if (r.kind === "NEW_HOOKS") {
      const cast = newCasting("SHARED", b.castingStyle === "DIVERSE" ? SHARED_CASTING : SHARED_CASTING_MATCH, 3, now + 1200)
      b.castings.push(cast)
      const td = teardownOf(c)
      const og = td?.sections.hook.data
      b.items.push(item(r.kind, -1, true, at(), failAll, {
        lever: "control: original hook", rationale: "Same face, voice and edit as the new hooks, with the champion's own first seconds. The baseline the hooks are measured against.",
        castingId: cast.id, hook: { speech: og?.spoken ?? "", onScreenText: og?.onScreenText?.split(" · ")[0] ?? null },
      }))
      for (let i = 0; i < r.count; i++) {
        const h = HOOKS[i % HOOKS.length]
        b.items.push(item(r.kind, i, false, at(), failAll || failOne.includes(`${r.kind}:${i}`), {
          lever: h.lever, rationale: h.rationale, castingId: cast.id, hook: { speech: h.speech, onScreenText: h.onScreenText },
        }))
      }
    }
  }
}
function item(kind: VariationKind, index: number, isControl: boolean, t0: number, fail: boolean, p: Partial<MItem>): MItem {
  return {
    id: mockId("vi"), kind, index, isControl, included: true, t0, t1: t0 + 2200, failCode: fail ? "RATE_LIMITED" : null, done: false,
    lever: null, rationale: null, hook: null, castingId: null, creativeId: null, failed: false, ...p,
  }
}

export function regenerateItem(b: MBatch, it: MItem) {
  const now = Date.now()
  Object.assign(it, { t0: now + 300, t1: now + 2800, done: false, failed: false, failCode: null })
  if (it.kind === "NEW_HOOKS" && !it.isControl) {
    const used = new Set(b.items.map((x) => x.hook?.speech))
    const h = HOOKS.find((x) => !used.has(x.speech)) ?? HOOKS[(it.index + 1) % HOOKS.length]
    Object.assign(it, { lever: h.lever, rationale: h.rationale, hook: { speech: h.speech, onScreenText: h.onScreenText } })
  }
  save()
}

export const FACE_UNIT_USD = PRICE.face
export function newFaceRound(b: MBatch, cast: MCasting, description: string, count: FaceCount = 1) {
  cast.description = description
  const round = faceRound((cast.rounds[0]?.batch ?? 0) + 1, description, (cast.rounds.length + 1) % 4, Date.now() + 300, count)
  cast.rounds.unshift(round)
  const usd = count * PRICE.face
  b.costUsd += usd
  db.spentUsd += usd
  saveDb()
  save()
  return round
}

/** Advances plan items and casting faces by the clock (§3.2). */
export function advanceBatch(b: MBatch, now = Date.now()) {
  for (const cast of b.castings) {
    for (const r of cast.rounds) {
      for (const f of r.faces) {
        if (f.status === "QUEUED" && now >= f.t0) f.status = "GENERATING"
        if (f.status === "GENERATING" && now >= f.t1) {
          if (f.failCode) Object.assign(f, { status: "FAILED", errorCode: f.failCode, failReason: REASON[f.failCode] ?? REASON.PROVIDER_ERROR, action: f.failCode === "SAFETY_BLOCK" ? "change_description" : "retry" })
          else Object.assign(f, { status: "READY", image: mockArt(f.tone, f.art) })
        }
      }
    }
  }
  for (const it of b.items) {
    if (it.done || now < it.t1) continue
    it.done = true
    it.failed = !!it.failCode
    if (!it.failed) { b.costUsd += 0.04; db.spentUsd += 0.04 }
  }
  if (b.status === "PLANNING" && b.items.every((i) => i.done)) b.status = b.items.some((i) => !i.failed) ? "PLAN_READY" : "PLAN_FAILED"
  if (b.status === "LAUNCHED") for (const it of b.items) {
    const cr = it.creativeId ? db.creatives.find((x) => x.id === it.creativeId) : null
    if (cr) advance(cr, now)
  }
  save()
  return b
}

const itemStatus = (it: MItem) => (!it.done ? "WRITING" : it.failed ? "FAILED" : "READY") as VariationItem["status"]

export function itemView(b: MBatch, it: MItem): VariationItem {
  const c = f2.champions.find((x) => x.id === b.championId)!
  const status = itemStatus(it)
  const cr = it.creativeId ? db.creatives.find((x) => x.id === it.creativeId) : null
  return {
    id: it.id, kind: it.kind, index: it.index, isControl: it.isControl, included: it.included, status,
    lever: status === "WRITING" ? null : it.lever, rationale: status === "WRITING" ? null : it.rationale,
    hook: status === "READY" ? it.hook : null,
    blocks: status === "READY" ? scriptBlocks(c.durationSec ?? 29, castingOf(b, it)?.description ?? "", it.hook?.speech) : null,
    layoutTemplateId: null, castingId: it.castingId,
    errorCode: status === "FAILED" ? it.failCode : null, failReason: status === "FAILED" ? REASON[it.failCode!] ?? null : null, action: status === "FAILED" ? "regenerate" : null,
    creative: cr ? toRow(cr) : null,
  }
}
const castingOf = (b: MBatch, it: MItem) => b.castings.find((x) => x.id === it.castingId) ?? null

export function castingView(cast: MCasting): VariationCasting {
  return {
    id: cast.id, scope: cast.scope, description: cast.description, selectedFaceId: cast.selectedFaceId,
    batches: cast.rounds.map((r) => ({ batch: r.batch, faces: r.faces.map((f) => ({ ...strip(f), selected: f.id === cast.selectedFaceId })) })),
  }
}

function planJob(b: MBatch, now = Date.now()): Job {
  const writing = b.items.filter((i) => !i.done)
  const read = now - b.t0 > 1200
  const failed = b.status === "PLAN_FAILED"
  const partial = b.status === "PLAN_READY" && b.items.some((i) => i.failed)
  return {
    id: b.jobId, type: "VARIATIONS_PLAN", status: b.status === "PLANNING" ? "RUNNING" : failed ? "FAILED" : partial ? "PARTIAL" : "SUCCEEDED",
    stage: b.status === "PLANNING" ? (read ? "writing" : "reading_teardown") : null,
    progress: Math.round(((b.items.length - writing.length) / Math.max(1, b.items.length)) * 100),
    etaSec: writing.length ? Math.max(1, Math.ceil((Math.max(...writing.map((i) => i.t1)) - now) / 1000)) : null,
    checklist: [{ key: "reading_teardown", done: read }, { key: "writing", done: !writing.length }],
    errorCode: failed || partial ? "RATE_LIMITED" : null, failReason: failed || partial ? REASON.RATE_LIMITED! : null, action: failed ? "retry" : partial ? "regenerate" : null, output: null,
  }
}

export function batchView(b: MBatch): VariationBatch {
  advanceBatch(b)
  const c = f2.champions.find((x) => x.id === b.championId)!
  const rows: CreativeRow[] = b.items.map((i) => (i.creativeId ? db.creatives.find((x) => x.id === i.creativeId) : null)).filter((x) => !!x).map((x) => toRow(x!))
  return {
    id: b.id, champion: { id: c.id, name: c.name }, offer: { id: b.offerId, name: offerName(b.offerId) }, status: b.status, language: b.language,
    requests: b.requests, settings: { ...b.settings, swapEngine: b.settings.swapEngine ?? "LIPSYNC" }, notes: b.notes, castingStyle: b.castingStyle ?? "MATCH_ORIGINAL", faceUnitPriceUsd: PRICE.face,
    job: b.status === "LAUNCHED" ? null : planJob(b), items: b.items.map((i) => itemView(b, i)), castings: b.castings.map(castingView),
    estimatedCostUsd: b.estimatedCostUsd, costUsd: Math.round((b.costUsd + rows.reduce((a, r) => a + (db.creatives.find((x) => x.id === r.id)?.costUsd ?? 0), 0)) * 100) / 100,
    launchedAt: b.launchedAt ? new Date(b.launchedAt).toISOString() : null,
    progress: b.status === "LAUNCHED" ? {
      total: rows.length, generating: rows.filter((r) => r.status === "progress").length, waiting: rows.filter((r) => r.status === "waiting").length,
      failed: rows.filter((r) => r.status === "failed").length, approved: rows.filter((r) => r.status === "approved").length,
    } : null,
    createdBy: b.createdBy, createdAt: new Date(b.createdAt).toISOString(),
  }
}

// ───────────── estimate + launch ─────────────
type Missing = { castingId: string; reason: "face_not_selected" } | { itemId: string; reason: "not_ready" } | { field: "voiceId" }

export function missingFor(b: MBatch): Missing[] {
  const inc = b.items.filter((i) => i.included)
  const out: Missing[] = []
  for (const it of inc) if (itemStatus(it) !== "READY") out.push({ itemId: it.id, reason: "not_ready" })
  for (const id of new Set(inc.map((i) => i.castingId).filter(Boolean) as string[])) {
    const cast = b.castings.find((x) => x.id === id)
    if (cast && !cast.selectedFaceId) out.push({ castingId: id, reason: "face_not_selected" })
  }
  const needsVoice = !b.settings.keepEdit && inc.some((i) => i.kind === "NEW_HOOKS" || (i.kind === "SWAP_AVATAR" && b.settings.voiceSource === "CATALOG"))
  if (needsVoice && !b.settings.voiceId) out.push({ field: "voiceId" })
  return out
}

const line = (kind: string, units: number, unitPriceUsd: number): EstimateLine => ({ kind, units: Math.round(units * 100) / 100, unit: "second", unitPriceUsd, amountUsd: Math.round(units * unitPriceUsd * 10_000) / 10_000 })
const speechLines = (sec: number) => [line("TTS", sec, PRICE.tts), line("LIPSYNC", sec, PRICE.lipsync), line("TRANSCRIBE", sec, PRICE.transcribe)]

export function estimateOf(b: MBatch): BatchEstimate {
  const c = f2.champions.find((x) => x.id === b.championId)!
  const dur = c.durationSec ?? 29
  const hookSec = structure(dur)[0].endSec
  const body = dur - hookSec
  const ready = b.items.filter((i) => i.included && itemStatus(i) === "READY")
  const hasControl = ready.some((i) => i.kind === "NEW_HOOKS" && i.isControl)
  const nSwap = ready.filter((i) => i.kind === "SWAP_AVATAR").length
  const quotes = nSwap ? swapQuotesOf(c, b, nSwap) : null
  const picked = quotes?.find((q) => q.selected)
  const items = ready.map((it) => {
    let lines: EstimateLine[]
    if (it.kind === "SWAP_AVATAR" && picked && picked.engine !== "LIPSYNC") lines = picked.lines // §13.15: stretches on Kling/Seedance
    else if (b.settings.keepEdit) lines = it.kind === "SWAP_AVATAR" ? [line("LIPSYNC", dur, PRICE.lipsync)] : [] // §13: 1 AUDIO_LIPSYNC take · written hook = US$ 0
    else if (it.kind === "SWAP_AVATAR") lines = b.settings.voiceSource === "CHAMPION_AUDIO" ? [line("LIPSYNC", dur, PRICE.lipsync)] : speechLines(dur)
    else lines = speechLines(it.isControl || !hasControl ? dur : hookSec) // body clips are generated once by the control and reused (§5.2)
    return { itemId: it.id, kind: it.kind, costUsd: Math.round(lines.reduce((a, l) => a + l.amountUsd, 0) * 100) / 100, lines }
  })
  const followers = ready.filter((i) => i.kind === "NEW_HOOKS" && !i.isControl).length
  const costUsd = Math.round(items.reduce((a, i) => a + i.costUsd, 0) * 100) / 100
  const cap = db.workspace.monthlySpendCapUsd
  return {
    costUsd, etaSec: picked && picked.engine !== "LIPSYNC" ? picked.etaSec : ready.some((i) => i.kind === "SWAP_AVATAR") ? 360 : 240,
    savedByReuseUsd: hasControl && !b.settings.keepEdit ? Math.round(followers * body * (PRICE.tts + PRICE.lipsync + PRICE.transcribe) * 100) / 100 : 0,
    items, spend: { monthUsd: +db.spentUsd.toFixed(2), capUsd: cap, afterUsd: +(db.spentUsd + costUsd).toFixed(2) },
    warnings: c.lowRes ? ["low_resolution"] : [],
    swapQuotes: quotes,
  }
}

const voiceLabel = (b: MBatch) => (b.settings.voiceSource === "CHAMPION_AUDIO" ? null : b.settings.voiceId)

export function launch(b: MBatch, opts: { states?: ("SCENES_GENERATING" | "RENDER_READY" | "APPROVED")[]; ago?: number; sceneMs?: number } = {}) {
  const c = f2.champions.find((x) => x.id === b.championId)!
  const dur = c.durationSec ?? 29
  const est = estimateOf(b)
  const perItem = new Map(est.items.map((i) => [i.itemId, i.costUsd]))
  let k = 0
  const counters: Partial<Record<VariationKind, number>> = {}
  for (const it of b.items) {
    if (!it.included || itemStatus(it) !== "READY") continue
    const cast = castingOf(b, it)
    const face = cast?.rounds.flatMap((r) => r.faces).find((f) => f.id === cast.selectedFaceId) ?? { tone: c.tone, art: c.face }
    const keep = b.settings.keepEdit ? (it.kind === "SWAP_AVATAR" ? "SWAP" : "HOOK_TEXT") : null
    const engine = b.settings.swapEngine ?? "LIPSYNC"
    let swap: SwapPlan | null = null
    if (it.kind === "SWAP_AVATAR" && keep && engine !== "LIPSYNC") {
      const voice: SwapVoiceSource = b.settings.voiceSource === "ENGINE_VOICE" ? "ENGINE_VOICE" : "CHAMPION_AUDIO"
      const q = quoteFor(c, b, engine, voice, 1)
      // §13.15.6 mock triggers, in the champion or the batch notes
      const notes = `${c.notes ?? ""} ${b.notes ?? ""}`
      const failCode: AsyncErrorCode | null = notes.includes("[mock:identity-drift]") ? "IDENTITY_DRIFT"
        : voice === "ENGINE_VOICE" && notes.includes("[mock:voice-fit-out]") ? "VOICE_FIT_OUT_OF_RANGE"
        : voice === "ENGINE_VOICE" && notes.includes("[mock:speech-mismatch]") ? "SPEECH_MISMATCH" : null
      const spans = mainSpans(c)
      const unit = q.lines[0].unitPriceUsd
      swap = {
        engine, voiceSource: voice, resolution: q.resolution ?? "1080p", fps: MAP_FPS, failCode,
        spans: spans.map((sp) => {
          const windows = swapWindows(sp.endSec - sp.startSec, engine, voice)
          const len = sp.endSec - sp.startSec
          return { ...sp, startSec: r2(sp.startSec), endSec: r2(sp.endSec), windows, regenUsd: r2(windows.reduce((a, w) => a + w.genSec, 0) * unit + len * (voice === "ENGINE_VOICE" ? PRICE.transcribe : SWAP_PRICE.v2v)) }
        }),
      }
    }
    const n = it.isControl ? 0 : (counters[it.kind] = (counters[it.kind] ?? 0) + 1)
    const cr = newVariationCreative({
      offerId: b.offerId, name: `${c.name} · ${it.isControl ? "Control" : `${KIND_LABEL[it.kind]} ${n}`}`, by: b.createdBy,
      blocks: scriptBlocks(dur, cast?.description ?? "", it.kind === "NEW_HOOKS" && !keep ? it.hook?.speech : undefined), angle: it.lever, rationale: it.rationale,
      face: { tone: face.tone, art: face.art, description: cast?.description ?? "The champion's own video" }, voiceId: keep ? null : voiceLabel(b), format: b.settings.format,
      edit: keep
        ? { ...b.settings.edit, templateId: "remix-keep", headline: it.kind === "NEW_HOOKS" ? it.hook?.onScreenText ?? null : null }
        : { ...b.settings.edit, headline: it.kind === "NEW_HOOKS" ? it.hook?.onScreenText ?? null : b.settings.edit.headline },
      keep, swap, takeFail: (c.notes ?? "").includes("[mock:take-fail]") ? "PROVIDER_ERROR" : null,
      estimatedCostUsd: perItem.get(it.id) ?? 0.8,
      variation: { kind: it.kind, championId: c.id, championName: c.name, batchId: b.id, lever: it.lever, isControl: it.isControl },
      state: opts.states?.[k++], ago: opts.ago, sceneMs: opts.sceneMs,
    })
    it.creativeId = cr.id
  }
  b.status = "LAUNCHED"
  b.estimatedCostUsd = est.costUsd
  b.launchedAt = Date.now() - (opts.ago ?? 0)
  c.updatedAt = Date.now()
  save()
  return b
}

// ───────────── seed ─────────────
/** One READY winner with a launched batch (Home / Library badges) and one link-only champion that failed (reader at its limit). */
function seed(s: Store) {
  const now = Date.now()
  const m = 60_000
  const orbit: MChampion = {
    id: "ch_orbit", name: "Orbit — the $9 question", offerId: "of_orbit", status: "READY", rights: "OWN", notes: null,
    adLibraryUrl: "https://www.facebook.com/ads/library/?id=1209847733", adMeta: AD_META("1209847733"), uploadId: "up_seed_orbit",
    durationSec: 29, width: 1080, height: 1920, hasAudio: true, hasSpeech: true, lowRes: false, tone: 0, face: 1,
    job: { id: "job_seed_an", type: "CHAMPION_ANALYZE", keys: ANALYZE_KEYS, t0: now - 3 * 60 * m, stepMs: 2600, startStep: 0, failAt: null, failCode: null },
    reached: 6, errorCode: null, failReason: null, action: null, analyzedAt: now - 3 * 60 * m + 13_000, overrides: {}, wordFixes: {}, editedSections: [],
    costUsd: 0.3, createdBy: GUSTA, createdAt: now - 3 * 60 * m, updatedAt: now - 2 * 60 * m, archived: false,
  }
  const penny: MChampion = {
    ...orbit, id: "ch_penny", name: "Penny Pilot · ad 1209847733", offerId: "of_orbit", status: "FAILED", rights: "THIRD_PARTY", uploadId: null,
    adLibraryUrl: "https://www.facebook.com/ads/library/?id=1209847733", adMeta: { ...AD_META("1209847733"), status: "unavailable", pageName: null, primaryText: null, headline: null, ctaText: null, linkUrl: null, daysRunning: null, isActive: null, collationCount: null, fetchedAt: null },
    durationSec: null, hasSpeech: false, tone: 1, face: 3,
    job: { id: "job_seed_rs", type: "CHAMPION_RESOLVE", keys: RESOLVE_KEYS, t0: now - 40 * m, stepMs: 2000, startStep: 0, failAt: 0, failCode: "AD_LIBRARY_UNAVAILABLE" },
    reached: 0, errorCode: "AD_LIBRARY_UNAVAILABLE", failReason: REASON.AD_LIBRARY_UNAVAILABLE!, action: "upload_video", analyzedAt: null,
    costUsd: 0, createdAt: now - 40 * m, updatedAt: now - 40 * m,
  }
  s.champions.push(orbit, penny)
  const b = newBatch(orbit, [{ kind: "SWAP_AVATAR", count: 2 }, { kind: "NEW_HOOKS", count: 2 }], undefined, null, "MATCH_ORIGINAL") // before 07/10: §13.13
  b.t0 = now - 2 * 60 * m
  for (const it of b.items) Object.assign(it, { t0: now - 2 * 60 * m, t1: now - 2 * 60 * m + 3000, done: true })
  b.settings.voiceId = voiceFor("en")
  for (const [ci, cast] of b.castings.entries()) {
    cast.rounds = [faceRound(1, cast.description, (ci + 1) % 4, now - 2 * 60 * m, 4)]
    for (const f of cast.rounds[0].faces) Object.assign(f, { status: "READY", image: mockArt(f.tone, f.art), t0: now - 2 * 60 * m, t1: now - 2 * 60 * m })
    cast.selectedFaceId = cast.rounds[0].faces[cast.scope === "ITEM" ? 2 : 1].id
  }
  b.status = "PLAN_READY"
  b.costUsd = 0.2
  // keeps the edit (§13): SWAP 1 approved · SWAP 2's take still generating (long seed so "in progress" stays visible) · 2 written hooks waiting for review
  launch(b, { states: ["APPROVED", "SCENES_GENERATING", "RENDER_READY", "RENDER_READY"], ago: 90 * m, sceneMs: 6 * m })
  s.batches = f2.batches
}

/** Created last: helpers above are const arrows. A fresh store (first run or `?mock=reset`) gets the seed. */
export const f2: Store = load()
if (typeof window !== "undefined" && !localStorage.getItem(KEY)) {
  seed(f2)
  save()
}

export type { MItem, MCasting }
