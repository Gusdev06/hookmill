/**
 * In-browser mock of the automatic variation (docs/contratos/variacao-auto-v1.md §3-§10), until the API of B1/B2 exists.
 * Same rules as db.ts / variar.ts: time-based (t0 + step), derived on read, persisted in localStorage (own key), `?mock=reset` reseeds.
 *
 * Contract triggers (§10), in the offer NOTES: [mock:auto-fail:reading] · [mock:auto-fail:planning] · [mock:auto-plan-invalid]
 *   · [mock:page-403] (SPLIT-LP swapped, flags.pageCaptured false) · [mock:render-fail:<TYPE>] (1st try of that type's 4:5 fails, retry passes)
 * Web-mock-only triggers (QA of the screens), in the uploaded file NAME:
 *   mock-truncated → MEDIA_INVALID at decode ("stops at 0:11 of 0:32", nothing charged) · mock-nobrain → Brain empty
 *   mock-onebeat → short video (one shot, smaller batch) · mock-page403 → SPLIT-LP fails with PAGE_FORBIDDEN (retry with photo)
 *   mock-planfail → PROVIDER_ERROR while planning (cents charged, try again)
 */
import type {
  AutoInsight, AutoVariationType, BlockFn, BrainField, FormatCode, IterateBatch, IterateConfig, IteratePiece, IterateStatus, LibraryItem, PieceFile, PieceStatus,
  SwapReason, UserRef, VariationAxis, WhyLine,
} from "@/lib/api/types"
import type { LibraryItemV, WaitingBatchRefV } from "@/lib/api/types"
import { db, mockArt, mockId, MOCK_VIDEO, save as saveDb } from "./db"
import { blobUrl } from "./variar"

// ───────────── constants ─────────────
const KEYS = ["decode", "transcribe", "cuts", "edit_map", "blocks", "audience", "offer", "proof", "page", "planning"] as const
const READING_END = 5 // keys 0-4 = reading, 5-8 = brain, 9 = planning
const STEP_MS = 1400
const RENDER_MS = 1500
const STILL_MS = 600
const USD_PER_SEC = 0.01 // transcription + teardown with frames (mock)
const PLAN_USD = 0.02
const FORMATS: FormatCode[] = ["9x16", "4x5", "1x1"]
const AXIS: Record<AutoVariationType, VariationAxis> = {
  CUT: "ITERATION", COLD_OPEN: "ITERATION", HOOK_TEXT: "ITERATION", ENDCARD: "ITERATION",
  SPLIT_LP: "DIVERSITY", STORY: "DIVERSITY", REVIEW: "DIVERSITY", NATIVE_SEARCH: "DIVERSITY", STATIC: "DIVERSITY",
}
export const ITER_LIMITS = { maxBytes: 524_288_000, minSec: 4, maxSec: 180, mimeTypes: ["video/mp4", "video/quicktime"] }

// ───────────── model ─────────────
interface MPiece {
  id: string; index: number; type: AutoVariationType; variant: string; n: number
  change: { en: string; pt: string }
  inZip: boolean; leftOutAt: number | null; creativeId: string | null; inLibrary: boolean
  /** first attempt of this format fails with this code */
  failFirst: { format: FormatCode; code: string } | null
  sec: number
}
interface MRenderJob { pieceId: string; format: FormatCode; startAt: number; endAt: number; fail: string | null }
interface MIter {
  id: string; championId: string; sourceCreativeId: string | null; uploadId: string | null; name: string; fromLibrary: boolean
  durationSec: number; width: number; height: number; tone: number; offerId: string; codeLang: "EN" | "PT"
  brainEmpty: boolean; shortVideo: boolean; pageCaptured: boolean; page403Render: boolean; renderFailType: AutoVariationType | null
  t0: number; startIndex: number; failAt: { index: number; code: string } | null; retries: number
  pieces: MPiece[]; launchedAt: number | null; jobs: MRenderJob[]
  zip: { status: "none" | "building" | "ready"; t0: number; key: string; sizeBytes: number | null }
  downloadedAt: number | null; createdBy: UserRef; createdAt: number; archived: boolean
}
interface Store { batches: MIter[]; lastOfferId: string | null }

const GUSTA: UserRef = { id: "u_gusta", name: "Gusta", initials: "G" }

// ───────────── persistence ─────────────
const KEY = "mock:iter:v1"
function load(): Store {
  if (typeof window !== "undefined") {
    const reset = new URLSearchParams(window.location.search).get("mock") === "reset"
    if (reset) localStorage.removeItem(KEY)
    const raw = reset ? null : localStorage.getItem(KEY)
    if (raw) {
      try { return JSON.parse(raw) as Store } catch {}
    }
  }
  return { batches: [], lastOfferId: null }
}
let timer: ReturnType<typeof setTimeout> | null = null
export function saveIter() {
  if (typeof window === "undefined" || timer) return
  timer = setTimeout(() => {
    timer = null
    localStorage.setItem(KEY, JSON.stringify(it))
  }, 200)
}

// ───────────── helpers ─────────────
const pt = () => db.uiLocale === "PT_BR"
const L = (en: string, ptText: string) => (pt() ? ptText : en)
const offerOf = (b: MIter) => db.offers.find((o) => o.id === b.offerId)
const notesOf = (offerId: string) => db.offers.find((o) => o.id === offerId)?.notes ?? ""
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
const ratioLabel = (w: number, h: number) => { const r = h / w; return r > 1.6 ? "9:16" : r > 1.15 ? "4:5" : r > 0.9 ? "1:1" : "16:9" }

/** codeFor(type, variant, n, lang) — the web never builds codes; this is the mock of the backend's pure function (§6.1). */
function codeFor(type: AutoVariationType, variant: string, n: number, lang: "EN" | "PT") {
  const P = lang === "PT"
  switch (type) {
    case "CUT": return `${P ? "CORTE" : "CUT"}-${variant}S`
    case "COLD_OPEN": return "COLD-OPEN"
    case "HOOK_TEXT": return `${P ? "GANCHO-TEXTO" : "HOOK-TEXT"}-${n + 1}`
    case "ENDCARD": return `ENDCARD-${P ? ({ offer: "OFERTA", guarantee: "GARANTIA", price: "PRECO", cta: "CTA" } as Record<string, string>)[variant] : variant.toUpperCase()}`
    case "SPLIT_LP": return "LAYOUT-SPLIT-LP"
    case "STORY": return "LAYOUT-STORY"
    case "REVIEW": return "LAYOUT-REVIEW"
    case "NATIVE_SEARCH": return `${P ? "NATIVO-BUSCA" : "NATIVE-SEARCH"}${n > 0 ? `-${n + 1}` : ""}`
    case "STATIC": return `${P ? "ESTATICO" : "STATIC"}-F${n + 1}`
  }
}
const code = (b: MIter, p: MPiece) => codeFor(p.type, p.variant, p.n, b.codeLang)

type Row = [AutoVariationType, string, string, string, number?] // type, variant, change EN, change PT, n
function planRows(b: MIter): Row[] {
  const d = b.durationSec
  if (b.shortVideo) {
    return [
      ["HOOK_TEXT", "", "New headline over the first 3 seconds. Same voice.", "Headline nova nos 3 primeiros segundos. Mesma voz.", 1],
      ["HOOK_TEXT", "", "A second headline, from the proof angle. Same voice.", "Uma segunda headline, pelo ângulo da prova. Mesma voz.", 2],
      ["ENDCARD", "offer", "Ends on a 2 s card with the offer from the Brain.", "Termina num cartão de 2 s com a oferta do Brain."],
      ["NATIVE_SEARCH", "", "Opens on a search for the problem, then the video.", "Abre numa busca pelo problema, depois o vídeo."],
      ["STORY", "", "The video inside a story frame.", "O vídeo dentro de uma moldura de story."],
      ["STATIC", "", "Best frame + one headline. Image.", "O melhor frame + uma headline. Imagem."],
    ]
  }
  if (b.brainEmpty) {
    return [
      ["CUT", "15", `Only the length changes: hook, proof, CTA. ${mmss(d)} becomes 0:15.`, `Só a duração muda: gancho, prova, CTA. ${mmss(d)} vira 0:15.`],
      ["COLD_OPEN", "", "Opens on the proof moment, then plays from the start.", "Abre no momento da prova, depois toca do início."],
      ["HOOK_TEXT", "", "New headline over the first 3 seconds. Same voice.", "Headline nova nos 3 primeiros segundos. Mesma voz.", 1],
      ["ENDCARD", "cta", "Ends on a 2 s card with the spoken CTA.", "Termina num cartão de 2 s com o CTA falado."],
      ["NATIVE_SEARCH", "", "Opens on a search for the problem, then the video.", "Abre numa busca pelo problema, depois o vídeo."],
      ["STORY", "", "The video inside a story frame.", "O vídeo dentro de uma moldura de story."],
      ["STATIC", "", "Frame from the proof moment + headline. Image.", "Frame do momento da prova + headline. Imagem."],
      ["STATIC", "", "Opening frame + a second headline. Image.", "Frame de abertura + uma segunda headline. Imagem.", 1],
    ]
  }
  const rows: Row[] = [
    ["CUT", "15", `Only the length changes: hook, proof, CTA. ${mmss(d)} becomes 0:15.`, `Só a duração muda: gancho, prova, CTA. ${mmss(d)} vira 0:15.`],
    ["CUT", "20", `Hook, problem, proof and CTA. ${mmss(d)} becomes 0:20.`, `Gancho, problema, prova e CTA. ${mmss(d)} vira 0:20.`],
    ["COLD_OPEN", "", "Opens on the proof moment, then plays from the start.", "Abre no momento da prova, depois toca do início."],
    ["HOOK_TEXT", "", "New headline over the first 3 seconds. Same voice.", "Headline nova nos 3 primeiros segundos. Mesma voz.", 1],
    ["ENDCARD", "offer", "Ends on a 2 s card with the offer from the Brain.", "Termina num cartão de 2 s com a oferta do Brain."],
  ]
  rows.push(b.pageCaptured
    ? ["SPLIT_LP", "", "Top half shows the product page; the video plays below.", "Metade de cima mostra a página do produto; o vídeo toca embaixo."]
    : ["STORY", "", "The video inside a story frame.", "O vídeo dentro de uma moldura de story."])
  rows.push(
    ["REVIEW", "", "A review from Brain › Proof sits on top of the video.", "Um depoimento do Brain › Prova fica em cima do vídeo."],
    ["NATIVE_SEARCH", "", "Opens on a search for the problem, then the video.", "Abre numa busca pelo problema, depois o vídeo."],
    ["STATIC", "", "Frame from the proof moment + headline. Image.", "Frame do momento da prova + headline. Imagem."],
  )
  if (b.pageCaptured) rows.push(["STORY", "", "The video inside a story frame.", "O vídeo dentro de uma moldura de story."])
  return rows
}
function buildPieces(b: MIter): MPiece[] {
  const counts: Partial<Record<AutoVariationType, number>> = {}
  return planRows(b).map(([type, variant, en, ptText, n], index) => {
    const k = counts[type] ?? 0
    counts[type] = k + 1
    const sec = type === "CUT" ? Number(variant) : type === "COLD_OPEN" ? b.durationSec + 2.5 : type === "ENDCARD" ? b.durationSec + 2 : b.durationSec
    const failFirst = type === b.renderFailType ? { format: "4x5" as FormatCode, code: "RENDER_ERROR" }
      : type === "SPLIT_LP" && b.page403Render ? { format: "9x16" as FormatCode, code: "PAGE_FORBIDDEN" } : null
    return { id: mockId("vi"), index, type, variant, n: n ?? k, change: { en, pt: ptText }, inZip: true, leftOutAt: null, creativeId: null, inLibrary: false, failFirst, sec }
  })
}

// ───────────── analysis clock ─────────────
function keyIndex(b: MIter, now: number) {
  return Math.min(KEYS.length, b.startIndex + Math.floor((now - b.t0) / STEP_MS))
}
function statusOf(b: MIter, now = Date.now()): IterateStatus {
  if (b.launchedAt) return "LAUNCHED"
  const i = keyIndex(b, now)
  if (b.failAt && i >= b.failAt.index) return "ANALYSIS_FAILED"
  if (i < READING_END) return "ANALYZING"
  if (i < KEYS.length) return "PLANNING"
  return "PLAN_READY"
}

// ───────────── renders ─────────────
const msOf = (p: MPiece) => (p.type === "STATIC" ? STILL_MS : RENDER_MS)
function lastJob(b: MIter, pieceId: string, f: FormatCode) {
  let j: MRenderJob | null = null
  for (const x of b.jobs) if (x.pieceId === pieceId && x.format === f) j = x
  return j
}
function pieceStatus(b: MIter, p: MPiece, now: number): PieceStatus {
  if (!b.launchedAt) return "planned"
  if (p.leftOutAt) return "left_out"
  const jobs = FORMATS.map((f) => lastJob(b, p.id, f))
  if (jobs.some((j) => j && j.endAt <= now && j.fail)) return "failed"
  if (jobs.every((j) => j && j.endAt <= now)) return "ready"
  if (jobs.some((j) => j && j.startAt <= now && now < j.endAt)) return "rendering"
  return "queued"
}

function pieceFiles(b: MIter, p: MPiece, now: number): PieceFile[] {
  const client = db.workspace.shortCode || "WS"
  const d = new Date(b.launchedAt ?? now)
  const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
  const still = p.type === "STATIC"
  const video = sourceVideo(b)
  return FORMATS.flatMap((f) => {
    const j = lastJob(b, p.id, f)
    if (!j || j.endAt > now || j.fail) return []
    return [{
      format: f, name: `${client}_${mmdd}_${code(b, p)}_${f}.${still ? "png" : "mp4"}`,
      url: still ? mockArt((b.tone + 2) % 4, p.index % 4).url : video, mimeType: still ? "image/png" as const : "video/mp4" as const,
      sizeBytes: still ? 420_000 + p.index * 13_000 : Math.round(p.sec * (f === "9x16" ? 610_000 : f === "4x5" ? 520_000 : 440_000)), durationSec: still ? null : p.sec,
    }]
  })
}
function sourceVideo(b: MIter) {
  return blobUrl(b.uploadId) ?? MOCK_VIDEO.url
}

/** Ready pieces go to the Library by themselves (§3.3 AUTO_APPROVE): a LibraryItem per piece, once. */
function toLibrary(b: MIter, p: MPiece, now: number) {
  if (p.inLibrary) return
  const files = pieceFiles(b, p, now)
  const f916 = files.find((f) => f.format === "9x16")
  if (!f916) return
  p.creativeId ??= mockId("cr")
  p.inLibrary = true
  const of = offerOf(b)
  const adName = f916.name.replace(/_9x16\.(mp4|png)$/, "")
  const still = p.type === "STATIC"
  const item: LibraryItemV = {
    id: p.creativeId, name: adName, offer: { id: b.offerId, name: of?.name ?? "—" }, engineLabel: L("Edited", "Editado"), durationSec: still ? 0 : p.sec,
    video: { id: `f_${p.id}_9x16`, url: f916.url, mimeType: f916.mimeType, width: 1080, height: 1920, durationSec: still ? undefined : p.sec },
    thumbnail: mockArt((b.tone + p.index) % 4, p.index % 4), isWinner: false, approvedAt: new Date(now).toISOString(), approvedBy: b.createdBy,
    variation: { kind: "AUTO_EDIT", championId: b.championId, championName: b.name, batchId: b.id, lever: null, isControl: false, code: code(b, p), axis: AXIS[p.type] },
    editedInEditor: false, adName, media: still ? "image" : "video",
    formats: files.map((x) => ({ format: x.format, file: { id: `f_${p.id}_${x.format}`, url: x.url, mimeType: x.mimeType } })),
  }
  db.library.unshift(item as LibraryItem)
  saveDb()
}

// ───────────── view (GET /iterate/:id) ─────────────
const BLOCKS: [string, string, BlockFn, number, boolean][] = [
  ["Hook", "Gancho", "hook", 0.1, true], ["Problem", "Problema", "problem", 0.22, false], ["Product", "Produto", "mechanism", 0.13, false],
  ["Proof", "Prova", "proof", 0.3, true], ["CTA", "CTA", "cta", 0.25, true],
]
function insightOf(b: MIter, status: IterateStatus): AutoInsight | null {
  if (status === "ANALYZING" || (status === "ANALYSIS_FAILED" && b.failAt!.index < READING_END)) return null
  const d = b.durationSec
  let at = 0
  const full = status === "PLAN_READY" || status === "LAUNCHED"
  const blocks = b.shortVideo
    ? [{ index: 0, label: L("One shot · no clear blocks", "Um plano só · sem blocos claros"), fn: null, startSec: 0, endSec: d, kept: true }]
    : BLOCKS.map(([en, ptText, fn, w, kept], index) => {
        const startSec = Math.round(at * 10) / 10
        at = index === BLOCKS.length - 1 ? d : at + w * d
        return { index, label: L(en, ptText), fn: full ? fn : null, startSec, endSec: Math.round(at * 10) / 10, kept: full && kept }
      })
  const flags = { brainEmpty: b.brainEmpty, shortVideo: b.shortVideo, metaConnected: false as const, pageCaptured: b.pageCaptured, smallBatch: b.pieces.length < 8 }
  const swaps: { from: AutoVariationType; to: AutoVariationType; reason: SwapReason }[] = []
  if (b.brainEmpty) swaps.push({ from: "SPLIT_LP", to: "STORY", reason: "no_page" }, { from: "REVIEW", to: "STATIC", reason: "no_proof" })
  else if (!b.pageCaptured) swaps.push({ from: "SPLIT_LP", to: "STORY", reason: "no_page" })
  if (b.shortVideo) swaps.push({ from: "CUT", to: "HOOK_TEXT", reason: "short_video" }, { from: "COLD_OPEN", to: "STATIC", reason: "short_video" })
  if (!full) return { blocks, why: [], kept: [], flags, swaps: [] }
  const of = offerOf(b)
  const brain = (key: WhyLine["key"], text: string, field: BrainField, ref: string): WhyLine =>
    b.brainEmpty ? { key, text, refSource: "video", brainField: null, ref: L("From the video", "Do vídeo") } : { key, text, refSource: "brain", brainField: field, ref }
  const short = (s: string | null | undefined, n = 48) => (s ? (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s) : "")
  const why: WhyLine[] = [
    brain("hook", L("Opens on a first-person confession in the first 2 seconds. It promises a verdict, so people stay to hear it.", "Abre com uma confissão em primeira pessoa nos 2 primeiros segundos. Promete um veredito, então a pessoa fica pra ouvir."), "audience", short(of?.pains) || L("tried and gave up", "tentou e desistiu")),
    { key: "proof", text: L("The demonstration in the middle shows the claim instead of saying it. It's the strongest frame in the video.", "A demonstração no meio mostra a promessa em vez de dizer. É o frame mais forte do vídeo."), refSource: "video", brainField: null, ref: L("From the video", "Do vídeo") },
    brain("cta", L("Ends on risk reversal, which is the offer in the Brain.", "Termina com reversão de risco, que é a oferta do Brain."), "offerAndPrice", short(of?.offerAndPrice) || L("free trial", "teste grátis")),
  ]
  const kept = b.shortVideo ? [L("The opening shot", "O plano de abertura"), L("The spoken line", "A frase falada")]
    : [L("Hook words", "Palavras do gancho"), L("The creator", "O criador"), L("The demonstration", "A demonstração"), L("Spoken CTA", "CTA falado")]
  return { blocks, why, kept, flags, swaps }
}

function analysisOf(b: MIter, status: IterateStatus, now: number): IterateBatch["analysis"] {
  const i = keyIndex(b, now)
  const failIdx = status === "ANALYSIS_FAILED" ? b.failAt!.index : null
  const at = failIdx ?? Math.min(i, KEYS.length)
  const done = status === "PLAN_READY" || status === "LAUNCHED"
  const stage = done ? null : at < READING_END ? "reading" : at < KEYS.length - 1 ? "brain" : "planning"
  const left = done || failIdx !== null ? null : Math.max(1, Math.ceil(((KEYS.length - at) * STEP_MS - ((now - b.t0) % STEP_MS)) / 1000))
  return {
    stage, step: done ? 3 : at < READING_END ? 1 : at < KEYS.length - 1 ? 2 : 3,
    progress: done ? 100 : Math.round((at / KEYS.length) * 100), etaSec: left,
    checklist: KEYS.map((key, k) => ({ key, status: done || k < at ? "done" : k === failIdx ? "failed" : k === at && failIdx === null ? "running" : "pending" })),
  }
}

function errorOf(b: MIter, status: IterateStatus): IterateBatch["error"] {
  if (status !== "ANALYSIS_FAILED" || !b.failAt) return null
  const c = b.failAt.code
  const idx = b.failAt.index
  const stage = idx < READING_END ? "reading" : idx < KEYS.length - 1 ? "brain" : "planning"
  if (c === "MEDIA_INVALID") {
    const decodedSec = Math.round(b.durationSec * 0.34)
    return {
      code: c, reason: `The file stops playing at ${mmss(decodedSec)} of ${mmss(b.durationSec)}.`, detail: `decoder error at frame ${decodedSec * 30}: file truncated`,
      params: { decodedSec, durationSec: b.durationSec }, stage, chargedUsd: 0, action: "upload_another",
    }
  }
  const charged = Math.round((b.durationSec * USD_PER_SEC + (idx >= KEYS.length - 1 ? PLAN_USD / 2 : 0)) * 100) / 100
  return {
    code: c, reason: c === "PLAN_INVALID" ? "The plan didn't pass the batch rules twice." : "The planning service returned an error.",
    detail: c === "PLAN_INVALID" ? "violations: diversity_below_40, count_below_min" : "anthropic 529 overloaded_error (attempt 2 of 2)",
    params: c === "PLAN_INVALID" ? { violations: "diversity_below_40" } : {}, stage, chargedUsd: charged, action: "try_again",
  }
}

export function iterView(b: MIter, now = Date.now()): IterateBatch {
  const status = statusOf(b, now)
  const of = offerOf(b)
  const launched = status === "LAUNCHED"
  const pieces: IteratePiece[] = (status === "PLAN_READY" || launched ? b.pieces : []).map((p) => {
    const s = pieceStatus(b, p, now)
    if (s === "ready") toLibrary(b, p, now)
    const running = launched ? b.jobs.find((j) => j.pieceId === p.id && j.startAt <= now && now < j.endAt) ?? null : null
    const files = launched ? pieceFiles(b, p, now) : []
    const failedJob = s === "failed" ? FORMATS.map((f) => lastJob(b, p.id, f)).find((j) => j && j.fail && j.endAt <= now) : null
    const frames = Math.round(p.sec * 30)
    return {
      id: p.id, index: p.index, type: p.type, code: code(b, p), axis: AXIS[p.type], change: pt() ? p.change.pt : p.change.en, status: s,
      previewReady: files.some((f) => f.format === "9x16"),
      render: running ? { format: running.format, progress: Math.round(((now - running.startAt) / (running.endAt - running.startAt)) * 100), frame: p.type === "STATIC" ? null : Math.round(((now - running.startAt) / (running.endAt - running.startAt)) * frames), frames: p.type === "STATIC" ? null : frames } : null,
      formatsReady: files.length as 0 | 1 | 2 | 3,
      errorCode: failedJob?.fail ?? null,
      failReason: failedJob?.fail === "PAGE_FORBIDDEN" ? `The product page didn't load: ${hostOf(of?.sourceUrl)} blocked our browser (403).` : failedJob?.fail ? `Rendering stopped at frame ${Math.round(frames * 0.6)}.` : null,
      retryHint: failedJob ? (failedJob.fail === "PAGE_FORBIDDEN" ? "use_product_photo" : "retry") : null,
      inZip: s === "ready" ? p.inZip : false, creativeId: launched ? p.creativeId : null,
      poster: files.length ? mockArt((b.tone + p.index) % 4, p.index % 4) : null, files,
      folder: AXIS[p.type] === "ITERATION" ? "1-stretch" : "2-new-audience",
    }
  })
  const all = b.pieces
  const stretch = all.filter((p) => AXIS[p.type] === "ITERATION").length
  const queuedOrRunning = pieces.some((p) => p.status === "queued" || p.status === "rendering")
  const remainingMs = launched ? b.jobs.reduce((a, j) => a + Math.max(0, j.endAt - Math.max(now, j.startAt)), 0) : all.reduce((a, p) => a + msOf(p) * 3, 0)
  const analysisEstimateUsd = Math.round(((b.fromLibrary && b.startIndex >= READING_END ? 0 : b.durationSec * USD_PER_SEC) + PLAN_USD) * 100) / 100
  const analysisDone = status === "PLAN_READY" || launched
  const analysisUsd = analysisDone ? analysisEstimateUsd : errorOf(b, status)?.chargedUsd ?? 0
  const zipPieces = pieces.filter((p) => p.status === "ready" && p.inZip)
  const zipReady = b.zip.status === "ready" && b.zip.key === zipKey(pieces)
  const client = db.workspace.shortCode || "WS"
  const d = new Date(b.launchedAt ?? now)
  const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
  const slug = b.name.normalize("NFD").replace(/[^\w\s-]/g, "").trim().toUpperCase().replace(/[\s_]+/g, "-").slice(0, 24).replace(/-+$/, "")
  const fileName = `${client}_${mmdd}_${slug}_${pt() ? "variacoes" : "variations"}.zip`
  return {
    id: b.id, status, phase: !launched ? "analyze" : queuedOrRunning ? "generate" : "download",
    offer: { id: b.offerId, name: of?.name ?? "—", language: of?.language ?? "en" }, codeLanguage: b.codeLang,
    source: {
      championId: b.championId, name: b.name, fromLibrary: b.fromLibrary, durationSec: b.durationSec, width: b.width, height: b.height,
      ratioLabel: ratioLabel(b.width, b.height), cuts: status === "ANALYZING" && keyIndex(b, now) < 3 ? null : b.shortVideo ? 0 : 6,
      thumbnail: mockArt(b.tone, 1), video: { id: `f_src_${b.id}`, url: sourceVideo(b), mimeType: "video/mp4", width: b.width, height: b.height, durationSec: b.durationSec },
    },
    analysis: analysisOf(b, status, now), insight: insightOf(b, status), error: errorOf(b, status), pieces,
    summary: {
      pieces: all.length, stretch, newAudience: all.length - stretch, files: all.length * 3,
      ready: pieces.filter((p) => p.status === "ready").length, failed: pieces.filter((p) => p.status === "failed").length, leftOut: pieces.filter((p) => p.status === "left_out").length,
      renderEtaSec: analysisDone && (queuedOrRunning || !launched) ? Math.max(1, Math.round(remainingMs / 1000)) : null, videoCreditsUsd: 0,
    },
    cost: { analysisEstimateUsd, analysisUsd, renderUsd: 0, totalUsd: analysisUsd },
    zip: {
      status: zipReady ? "ready" : b.zip.status === "building" ? "building" : "none", fileName: zipReady ? fileName : null, url: zipReady ? zipUrl() : null,
      sizeBytes: zipReady ? b.zip.sizeBytes : null, pieces: zipPieces.length, files: zipPieces.reduce((a, p) => a + p.files.length, 0),
      folders: pt() ? { stretch: "1-esticar-a-vida", newAudience: "2-publico-novo" } : { stretch: "1-stretch-its-life", newAudience: "2-new-audience" },
    },
    downloadedAt: b.downloadedAt ? new Date(b.downloadedAt).toISOString() : null, createdBy: b.createdBy,
    createdAt: new Date(b.createdAt).toISOString(), launchedAt: b.launchedAt ? new Date(b.launchedAt).toISOString() : null,
  }
}
const hostOf = (url: string | null | undefined) => { try { return url ? new URL(url).host : "the page" } catch { return "the page" } }
const zipKey = (pieces: IteratePiece[]) => pieces.filter((p) => p.status === "ready" && p.inZip).map((p) => `${p.id}:${p.files.length}`).sort().join("|")
let zipBlob: string | null = null
function zipUrl() {
  if (typeof window === "undefined") return "#"
  zipBlob ??= URL.createObjectURL(new Blob(["HookMill mock zip: the real one comes from POST /iterate/:id/zip (variacao-auto-v1 §8)."], { type: "application/zip" }))
  return zipBlob
}

/** Advances the zip job (building → ready after 2.5 s; the first ready delivered marks downloadedAt). */
export function advanceIter(b: MIter, now = Date.now()) {
  if (b.zip.status === "building" && now - b.zip.t0 > 2500) {
    const v = iterView({ ...b, zip: { ...b.zip, status: "none" } }, now)
    b.zip = { status: "ready", t0: b.zip.t0, key: zipKey(v.pieces), sizeBytes: v.pieces.filter((p) => p.status === "ready" && p.inZip).reduce((a, p) => a + p.files.reduce((x, f) => x + f.sizeBytes, 0), 0) }
    b.downloadedAt ??= now
    saveIter()
  }
  return b
}

// ───────────── writes ─────────────
export function iterConfig(empty: boolean): IterateConfig {
  const offers = db.offers.map((o) => ({ id: o.id, name: o.name, language: o.language }))
  const last = it.lastOfferId && offers.some((o) => o.id === it.lastOfferId) ? it.lastOfferId : null
  const winners = (db.library as LibraryItemV[]).filter((l) => l.isWinner && l.media !== "image").slice(0, 3)
  return {
    ...ITER_LIMITS, analysisUsdPerSec: USD_PER_SEC, analysisTypicalUsd: Math.round((30 * USD_PER_SEC + PLAN_USD) * 100) / 100,
    types: ["CUT", "COLD_OPEN", "HOOK_TEXT", "ENDCARD", "SPLIT_LP", "STORY", "REVIEW", "NATIVE_SEARCH", "STATIC"], metaConnected: false,
    offers, defaultOfferId: offers.length === 1 ? offers[0].id : last, recentWinners: empty ? [] : (winners as LibraryItem[]),
  }
}

export function newIter(p: { offerId: string; uploadId: string | null; sourceCreativeId: string | null; name: string; durationSec: number; width: number; height: number; filename: string }) {
  const now = Date.now()
  const notes = notesOf(p.offerId)
  const fname = p.filename.toLowerCase()
  const of = db.offers.find((o) => o.id === p.offerId)
  // Library → reuse the champion when it was already analyzed (§5.1 note 2): the batch starts in PLANNING
  const prev = p.sourceCreativeId ? it.batches.find((b) => b.sourceCreativeId === p.sourceCreativeId && !b.archived && (statusOf(b, now) === "PLAN_READY" || statusOf(b, now) === "LAUNCHED")) : null
  const renderFail = /\[mock:render-fail:([A-Z_]+)\]/.exec(notes)?.[1] as AutoVariationType | undefined
  const b: MIter = {
    id: mockId("ib"), championId: prev?.championId ?? mockId("ch"), sourceCreativeId: p.sourceCreativeId, uploadId: p.uploadId, name: p.name, fromLibrary: !!p.sourceCreativeId,
    durationSec: p.durationSec, width: p.width, height: p.height, tone: it.batches.length % 4, offerId: p.offerId, codeLang: (of?.language ?? "en").toLowerCase().startsWith("pt") ? "PT" : "EN",
    brainEmpty: fname.includes("mock-nobrain") || notes.includes("[mock:brain-empty]") || !(of?.audience || of?.proof || of?.offerAndPrice),
    shortVideo: fname.includes("mock-onebeat") || p.durationSec < 12,
    pageCaptured: !notes.includes("[mock:page-403]") && !!of?.sourceUrl, page403Render: fname.includes("mock-page403"), renderFailType: renderFail ?? null,
    t0: now, startIndex: prev ? READING_END : 0, retries: 0,
    failAt: fname.includes("mock-truncated") || notes.includes("[mock:auto-fail:reading]") ? { index: 0, code: "MEDIA_INVALID" }
      : fname.includes("mock-planfail") || notes.includes("[mock:auto-fail:planning]") ? { index: KEYS.length - 1, code: "PROVIDER_ERROR" }
      : notes.includes("[mock:auto-plan-invalid]") ? { index: KEYS.length - 1, code: "PLAN_INVALID" } : null,
    pieces: [], launchedAt: null, jobs: [], zip: { status: "none", t0: 0, key: "", sizeBytes: null }, downloadedAt: null, createdBy: GUSTA, createdAt: now, archived: false,
  }
  if (b.brainEmpty) b.pageCaptured = false
  b.pieces = buildPieces(b)
  it.batches.unshift(b)
  it.lastOfferId = p.offerId
  saveIter()
  return b
}

export function retryIter(b: MIter) {
  const now = Date.now()
  b.startIndex = Math.min(b.failAt!.index, KEYS.length - 1)
  b.t0 = now
  b.failAt = null
  b.retries++
  saveIter()
}

/** §5.1 note 4: queue order = every 9:16 in plan order, then every 4:5, then every 1:1. */
export function launchIter(b: MIter, at = Date.now()) {
  b.launchedAt = at
  let t = at + 400
  for (const f of FORMATS) {
    for (const p of b.pieces) {
      const ms = msOf(p)
      const fail = p.failFirst && p.failFirst.format === f ? p.failFirst.code : null
      b.jobs.push({ pieceId: p.id, format: f, startAt: t, endAt: t + ms, fail })
      t += ms
    }
  }
  saveIter()
}

export function retryPiece(b: MIter, p: MPiece) {
  const now = Date.now()
  p.leftOutAt = null
  p.inZip = true
  let t = Math.max(now + 300, ...b.jobs.map((j) => j.endAt))
  for (const f of FORMATS) {
    const j = lastJob(b, p.id, f)
    if (j && j.fail) {
      b.jobs.push({ pieceId: p.id, format: f, startAt: t, endAt: t + msOf(p), fail: null })
      t += msOf(p)
    }
  }
  saveIter()
}

export function findPiece(pieceId: string) {
  for (const b of it.batches) {
    const p = b.pieces.find((x) => x.id === pieceId)
    if (p) return { b, p }
  }
  return null
}
export const pieceView = (b: MIter, p: MPiece) => iterView(b).pieces.find((x) => x.id === p.id)!
export function startZip(b: MIter) {
  const v = iterView(b)
  const key = zipKey(v.pieces)
  if (b.zip.status === "ready" && b.zip.key === key) return
  b.zip = { status: "building", t0: Date.now(), key, sizeBytes: null }
  saveIter()
}

/** Home "Waiting for you" (§5.4): Plan ready · Analysis failed · N pieces ready (all settled, not downloaded). */
export function autoWaiting(): WaitingBatchRefV[] {
  const now = Date.now()
  return it.batches.filter((b) => !b.archived).flatMap((b): WaitingBatchRefV[] => {
    const v = iterView(advanceIter(b, now), now)
    const base = { id: b.id, championId: b.championId, championName: b.name, offer: { id: v.offer.id, name: v.offer.name }, mode: "AUTO" as const, updatedAt: new Date(b.launchedAt ?? b.t0).toISOString() }
    if (v.status === "PLAN_READY") return [{ ...base, status: "PLAN_READY" as const, readyCount: null }]
    if (v.status === "ANALYSIS_FAILED") return [{ ...base, status: "ANALYSIS_FAILED" as const, readyCount: null }]
    if (v.status === "LAUNCHED" && v.phase === "download" && !b.downloadedAt) return [{ ...base, status: "PIECES_READY" as const, readyCount: v.summary.ready }]
    return []
  })
}
export function touchAllIter() {
  const now = Date.now()
  for (const b of it.batches) iterView(advanceIter(b, now), now)
}

// ───────────── seed ─────────────
function seed(s: Store) {
  const now = Date.now()
  const h = 3_600_000
  // a plan waiting for Generate (from the Library) and a finished batch nobody downloaded yet
  const lib = (id: string) => db.library.find((l) => l.id === id)
  const a = lib("cr_8")
  const c = lib("cr_10")
  if (a) {
    const b = newIter({ offerId: a.offer.id, uploadId: null, sourceCreativeId: a.id, name: a.name, durationSec: a.durationSec, width: 1080, height: 1920, filename: "" })
    b.t0 = now - 2 * h
  }
  if (c) {
    const b = newIter({ offerId: c.offer.id, uploadId: null, sourceCreativeId: c.id, name: c.name, durationSec: c.durationSec, width: 1080, height: 1920, filename: "" })
    b.t0 = now - 5 * h
    b.createdAt = now - 5 * h
    launchIter(b, now - 4.8 * h)
  }
  s.lastOfferId = null
}

/** Created last: helpers above are function declarations / consts used lazily. A fresh store gets the seed. */
export const it: Store = load()
if (typeof window !== "undefined" && !localStorage.getItem(KEY)) {
  seed(it)
  saveIter()
}
export type { MIter, MPiece }
