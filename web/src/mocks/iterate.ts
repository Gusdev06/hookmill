/**
 * In-browser mock of the automatic variation (docs/contratos/variacao-auto-v1.md §3-§10), until the API of B1/B2 exists.
 * Same rules as db.ts / variar.ts: time-based (t0 + step), derived on read, persisted in localStorage (own key), `?mock=reset` reseeds.
 *
 * Contract triggers (§10), in the offer NOTES: [mock:auto-fail:reading] · [mock:auto-fail:planning] · [mock:auto-plan-invalid]
 *   · [mock:page-403] (SPLIT-LP swapped, flags.pageCaptured false) · [mock:render-fail:<TYPE>] (1st try of that type's 9:16 fails, retry passes)
 * Rev. 23/10 (§14.7): the batch renders only the 9:16; 4:5 / 1:1 on demand (POST /iterate/pieces/:id/formats, ahead of the batch).
 *   · [mock:format-fail:<TYPE>] (1st on-demand 4:5 of that type fails RENDER_ERROR; asking again passes)
 *   · [mock:static-reject] / [mock:static-timeout] (the automatic resend passes: the image just takes longer)
 *   · [mock:static-reject-all] (STATIC 9:16 fails SAFETY_BLOCK; Retry passes and costs the image)
 *   · [mock:spend-cap] (web-mock only: start with images, STATIC retry and STATIC format answer 409 SPEND_CAP_EXCEEDED)
 *   The STATIC is an image (IMAGE_GEN), outside the Remotion line: it runs in parallel and costs STATIC_USD when it finishes.
 * 25/10 (estatico-montado-e-molduras-v1 §A6/§A9/§B6): the STATIC 9:16 = image → text check (→ 2nd image → check when a critical
 *   text is wrong). [mock:static-text-mismatch] (1st image critical typo, 2nd ok) · [mock:static-text-mismatch-all] (both wrong →
 *   mismatch, G1: out of the zip) · web-only ?mocktext=ok|minor|critical|retake|skipped|cap (scenario.ts).
 *   FRAME pieces (B1) with the prototype stills; [mock:frame-fail:<id>] (1st render fails, retry passes) · web-only
 *   [mock:frame-overflow:<id>] (FRAME_TEXT_OVERFLOW, retryHint leave_out) · ?mockframes=all (all 18 in the plan).
 *   Example data: the `meme` frame has no 1:1 (`supported: false`, §B4) so the hidden button can be checked.
 * Web-mock-only triggers (QA of the screens), in the uploaded file NAME:
 *   mock-truncated → MEDIA_INVALID at decode ("stops at 0:11 of 0:32", nothing charged) · mock-nobrain → Brain empty
 *   mock-onebeat → short video (one shot, smaller batch) · mock-page403 → SPLIT-LP fails with PAGE_FORBIDDEN (retry with photo)
 *   mock-planfail → PROVIDER_ERROR while planning (cents charged, try again)
 */
import type { AutoInsight, AutoVariationType, FrameTemplateId, StaticRenderStage, StaticTextCheck, BlockFn, BrainField, FormatCode, IterateBatch, IterateConfig, IteratePiece, IterateStatus, LibraryItem, PieceFile, PieceFormat, PieceFormatState, PieceStatus, SwapReason, UserRef, VariationAxis, WhyLine } from "@/lib/api/types"
import type { PieceHeadline, WaitingBatchRef } from "@/lib/api/types"
import { db, mockArt, mockId, MOCK_VIDEO, save as saveDb } from "./db"
import { blobUrl } from "./variar"

// ───────────── constants ─────────────
const KEYS = ["decode", "transcribe", "cuts", "edit_map", "blocks", "audience", "offer", "proof", "page", "planning"] as const
const READING_END = 5 // keys 0-4 = reading, 5-8 = brain, 9 = planning
const STEP_MS = 1400
const RENDER_MS = 1500
const STILL_MS = 3200 // GPT Image 2 (~90 s real at 2k), compressed
const CHECK_MS = 1800 // checkStaticText (Haiku vision, ~5 s real), compressed
export const STATIC_USD = 0.4 // STATIC_IMAGE_MODEL.usdPerImage: GPT Image 2 high 2k (estatico-montado D1)
const USD_PER_SEC = 0.01 // transcription + teardown with frames (mock)
const PLAN_USD = 0.02
const FORMATS: FormatCode[] = ["9x16", "4x5", "1x1"]
const AXIS: Record<AutoVariationType, VariationAxis> = {
  CUT: "ITERATION", COLD_OPEN: "ITERATION", HOOK_TEXT: "ITERATION", ENDCARD: "ITERATION",
  SPLIT_LP: "DIVERSITY", STORY: "DIVERSITY", REVIEW: "DIVERSITY", NATIVE_SEARCH: "DIVERSITY", STATIC: "DIVERSITY", FRAME: "DIVERSITY", HEADLINE: "ITERATION", CHAT_DM: "DIVERSITY", PERSON_MOTION: "DIVERSITY",
}
// ───────────── frames (§B2/§B7) ─────────────
const FRAME_IDS: FrameTemplateId[] = [
  "question_box", "gossip_page", "meme", "cinema", "news", "split_stack", "split_torn", "call", "call_dialog",
  "ranking", "post_card", "direct_offer", "story", "read_caption", "pov_testimonial", "live", "gossip_white", "gossip_pink",
]
const FRAME_PT: Record<FrameTemplateId, string> = {
  question_box: "CAIXINHA", gossip_page: "CHOQUEI", meme: "MEME", cinema: "CINEMA", news: "NOTICIA", split_stack: "TELA-DIVIDIDA",
  split_torn: "TELA-DIVIDIDA-2", call: "MEET", call_dialog: "MEET-DIALOGO", ranking: "RANKING", post_card: "TWEET", direct_offer: "OFERTA-DIRETA",
  story: "STORY", read_caption: "LEIA-A-LEGENDA", pov_testimonial: "POV-DEPOIMENTO", live: "LIVE", gossip_white: "FOFOCA-1", gossip_pink: "FOFOCA-2",
}
/** mock of the backend's `change` line (interface language) */
const FRAME_NAME: Record<FrameTemplateId, [string, string]> = {
  question_box: ["question box", "caixinha de pergunta"], gossip_page: ["gossip page", "página de fofoca"], meme: ["meme", "meme"],
  cinema: ["cinema", "cinema"], news: ["news", "notícia"], split_stack: ["split screen", "tela dividida"], split_torn: ["torn split screen", "tela dividida rasgada"],
  call: ["video call", "videochamada"], call_dialog: ["call dialog", "diálogo em chamada"], ranking: ["ranking", "ranking"], post_card: ["post", "post"],
  direct_offer: ["direct offer", "oferta direta"], story: ["story question", "pergunta no story"], read_caption: ["read the caption", "leia a legenda"],
  pov_testimonial: ["POV testimonial", "POV + depoimento"], live: ["live", "live"], gossip_white: ["gossip (white)", "fofoca (branca)"], gossip_pink: ["gossip (pink)", "fofoca (rosa)"],
}
/** example data (§B4): a template without a format, so the hidden button can be checked */
const FRAME_UNSUPPORTED: Partial<Record<FrameTemplateId, FormatCode[]>> = { meme: ["1x1"] }
/** headline-e-legenda §1.5 (H2): HEADLINE only in the champion's aspect (the mock champion is 9:16) */
const unsupportedOf = (p: MPiece): FormatCode[] => (p.type === "HEADLINE" ? ["4x5", "1x1"] : p.frame ? (FRAME_UNSUPPORTED[p.frame] ?? []) : [])
/** headline-e-legenda §1 (example data, the language of the original headline) */
const HEADLINE_ORIGINAL = "I tried everything for my back pain"
const HEADLINES: Omit<PieceHeadline, "mode" | "original">[] = [
  { text: "Your back pain isn't your mattress", highlight: "isn't your mattress" },
  { text: "10 minutes at night, before bed", highlight: null },
  { text: "What changed after week one", highlight: "week one" },
]
/** §B3.1 item 9: b-roll track of the 2-source frames (example data) */
const TRACK = (d: number) => [
  { fromSec: 0, toSec: Math.round(d * 0.3 * 10) / 10, segmentText: "I tried everything for my back pain", provenance: { provider: "pexels" as const, sourceUrl: "https://www.pexels.com/video/woman-holding-her-back-7298743/", creator: "Kampus Production", license: "Pexels License", licenseCommercialOk: true, startSec: 2, endSec: 8 } },
  { fromSec: Math.round(d * 0.3 * 10) / 10, toSec: Math.round(d * 0.65 * 10) / 10, segmentText: "a physio showed me this 10-minute routine", provenance: { provider: "youtube" as const, sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", creator: "Example Channel", license: "Standard YouTube License", licenseCommercialOk: false, startSec: 41, endSec: 52 } },
  { fromSec: Math.round(d * 0.65 * 10) / 10, toSec: d, segmentText: "now I wake up without pain", provenance: { provider: "generated" as const, model: "gpt-image-2", prompt: "person waking up relaxed in soft morning light", subject: "waking up without pain", licenseCommercialOk: true as const } },
]
const frameStill = (id: FrameTemplateId) => ({ id: `f_frame_${id}`, url: `/mock/frames/${id}.jpg`, mimeType: "image/jpeg" })
// ───────────── STATIC text check (§A6) ─────────────
/** extra = every item matches but the image wrote text nobody asked for (G3: critical; live finding 25/10) */
type TextMode = "ok" | "minor" | "critical" | "extra" | "retake" | "skipped" | "cap"
const TEXTS: { key: string; text: string; critical: boolean }[] = [
  { key: "brand", text: "Coluna Leve", critical: true }, { key: "brandLine", text: "rotina noturna de 10 min", critical: false },
  { key: "tagline", text: "Menos dor. Mais vida.", critical: false }, { key: "headline.lead", text: "Você não nasceu pra", critical: true },
  { key: "headline.highlight", text: "acordar com dor.", critical: true },
  { key: "subheadline", text: "Alongamentos guiados antes de dormir. Sem academia. Sem equipamento.", critical: false },
  { key: "handwritten", text: "Sua manhã de volta.", critical: false }, { key: "benefits.1.title", text: "10 minutos por noite", critical: true },
  { key: "benefits.2.title", text: "Guiado passo a passo", critical: false }, { key: "benefits.3.title", text: "Feito pra iniciantes", critical: false },
  { key: "trust.1.text", text: "SEM EQUIPAMENTO", critical: false }, { key: "trust.2.text", text: "NO SEU RITMO", critical: false },
  { key: "trust.3.text", text: "EM CASA", critical: false }, { key: "cta.main", text: "Comece hoje", critical: true },
  { key: "cta.sub", text: "7 DIAS DE TESTE", critical: true },
]
const SEEN: Record<string, Record<string, string>> = {
  minor: { handwritten: "Sua manhã de vólta." },
  critical: { handwritten: "Sua manhã de vólta.", "cta.sub": "7 DIAS GRÁTIS" },
  first: { "cta.sub": "7 DIAS GRÁTIS" },
}
function textCheckOf(mode: TextMode | "first"): StaticTextCheck {
  // §A10 (25/10): items = every text checked, each with `match`; skipped = all `match: false`, nothing seen
  if (mode === "skipped") return { status: "skipped", items: TEXTS.map((x) => ({ key: x.key, expected: x.text, seen: null, critical: x.critical, match: false })), extraText: [] }
  const seen = SEEN[mode === "cap" ? "minor" : mode] ?? {}
  const items = TEXTS.map((x) => ({ key: x.key, expected: x.text, seen: seen[x.key] ?? x.text, critical: x.critical, match: !(x.key in seen) }))
  const bad = Object.keys(seen).length > 0
  const extraText = mode === "critical" ? ["iOS E ANDROID"] : mode === "extra" ? ["Application error: a client-side exception has occurred"] : []
  return { status: bad || extraText.length ? "mismatch" : "ok", items, extraText }
}
function textModeFor(offerId: string): TextMode {
  const forced = typeof window !== "undefined" ? (sessionStorage.getItem("mock:text") as TextMode | null) : null
  if (forced) return forced
  const notes = notesOf(offerId)
  if (notes.includes("[mock:static-text-mismatch-all]")) return "critical"
  if (notes.includes("[mock:static-text-mismatch]")) return "retake"
  return "ok"
}
/** the batch's 9:16 job follows the session switch (so the seeded batch can show every end state); retries keep their own */
const modeOf = (j: MRenderJob) => ((j.priority ?? 0) === 0 && typeof window !== "undefined" ? (sessionStorage.getItem("mock:text") as TextMode | null) : null) ?? j.text ?? "ok"
const twoImages = (m: TextMode) => m === "retake" || m === "critical" || m === "extra"
const staticMs = (m: TextMode, slow = false) => STILL_MS * (slow ? 2 : 1) + CHECK_MS + (twoImages(m) ? STILL_MS + CHECK_MS : 0)
/** stage of a STATIC job at `now` (§A10 render.stage / attempt) */
function staticPhase(j: MRenderJob, now: number): { stage: StaticRenderStage; attempt: 1 | 2; imageReady: boolean } {
  const m = j.text ?? "ok"
  const img1 = j.endAt - (staticMs(m) - STILL_MS) // end of the 1st image (slow first image stretches it)
  if (now < img1) return { stage: "image", attempt: 1, imageReady: false }
  if (now < img1 + CHECK_MS || !twoImages(m)) return { stage: "text_check", attempt: 1, imageReady: true }
  if (now < img1 + CHECK_MS + STILL_MS) return { stage: "retake", attempt: 2, imageReady: true }
  return { stage: "text_check", attempt: 2, imageReady: true }
}
const staticUrl = (m: TextMode) => (m === "minor" || m === "critical" || m === "cap" ? "/mock/static-volta.jpg" : "/mock/static-2k.jpg")
export const ITER_LIMITS = { maxBytes: 524_288_000, minSec: 4, maxSec: 180, mimeTypes: ["video/mp4", "video/quicktime"] }

// ───────────── model ─────────────
interface MPiece {
  id: string; index: number; type: AutoVariationType; variant: string; n: number
  /** FRAME only: the template (= variant) */
  frame?: FrameTemplateId
  /** true once the user set "In zip" (G1 default only applies before that) */
  zipSet?: boolean
  change: { en: string; pt: string }
  inZip: boolean; leftOutAt: number | null; creativeId: string | null; inLibrary: boolean
  /** first attempt of this format fails with this code */
  failFirst: { format: FormatCode; code: string } | null
  /** first STATIC image takes longer (reject/timeout + automatic resend) */
  slowFirst?: boolean
  sec: number
}
/** priority 10 = on demand (ahead of every queued batch render), 0 = batch; image = STATIC, outside the Remotion line */
interface MRenderJob { pieceId: string; format: FormatCode; startAt: number; endAt: number; fail: string | null; priority?: number; image?: boolean; text?: TextMode }
interface MIter {
  id: string; championId: string; sourceCreativeId: string | null; uploadId: string | null; name: string; fromLibrary: boolean
  durationSec: number; width: number; height: number; tone: number; offerId: string; codeLang: "EN" | "PT"
  brainEmpty: boolean; shortVideo: boolean; pageCaptured: boolean; page403Render: boolean; renderFailType: AutoVariationType | null
  formatFailType?: AutoVariationType | null; formatFailUsed?: boolean
  frameFail?: { id: FrameTemplateId; code: string } | null
  /** legenda-protegida-v1 §2.3: the champion's version without burned-in captions */
  cleanUploadId?: string | null
  /** 26/10: result of `cleanUploadId` sent with POST /iterate (insight.cleanVersion) */
  cleanVersion?: { status: "applied" | "mismatch"; reason: "duration" | "resolution" | "fps" | "content" | null } | null
  t0: number; startIndex: number; failAt: { index: number; code: string } | null; retries: number
  pieces: MPiece[]; launchedAt: number | null; jobs: MRenderJob[]
  zip: { status: "none" | "building" | "ready"; t0: number; key: string; sizeBytes: number | null }
  downloadedAt: number | null; createdBy: UserRef; createdAt: number; archived: boolean
}
interface Store { batches: MIter[]; lastOfferId: string | null }

const GUSTA: UserRef = { id: "u_gusta", name: "Gusta", initials: "G" }

// ───────────── persistence ─────────────
const KEY = "mock:iter:v3" // v3 = 25/10 (text check + frames)
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
    case "HEADLINE": return `HEADLINE-${n + 1}`
    case "FRAME": return P ? `MOLDURA-${FRAME_PT[variant as FrameTemplateId]}` : `FRAME-${variant.toUpperCase().replace(/_/g, "-")}`
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
const frameRow = (id: FrameTemplateId): Row => {
  const [en, ptName] = FRAME_NAME[id]
  return ["FRAME", id, `The champion plays inside a ${en} frame. Screen text from the Brain.`, `O campeão toca dentro de uma moldura de ${ptName}. Texto de tela do Brain.`]
}
function planRows(b: MIter): Row[] {
  const rows = basePlanRows(b)
  const all = typeof window !== "undefined" && sessionStorage.getItem("mock:frames") === "all"
  // D10: at most 2 frames per batch, different templates (all 18 only in the web-mock QA switch)
  const frames: FrameTemplateId[] = all ? FRAME_IDS : b.shortVideo || b.brainEmpty ? ["meme"] : ["news", "meme", "split_stack"]
  return [...rows, ...frames.map(frameRow)]
}
/** headline-e-legenda §1.1: 3 HEADLINE (`replace`) or 2 (`add`, champion without a headline: [mock:headline-none]) */
function headlineRows(b: MIter): Row[] {
  const add = notesOf(b.offerId).includes("[mock:headline-none]")
  return HEADLINES.slice(0, add ? 2 : 3).map((_, i): Row => add
    ? ["HEADLINE", "add", "Adds a headline band in the brand color. The rest of the video stays the same.", "Põe uma faixa de headline na cor da marca. O resto do vídeo fica igual.", i]
    : ["HEADLINE", "replace", "Only the headline changes: same place, same style. Cuts, voice and framing stay.", "Só a headline muda: mesmo lugar, mesmo estilo. Cortes, voz e enquadramento ficam.", i])
}
function basePlanRows(b: MIter): Row[] {
  return [...headlineRows(b), ...basePlanRowsOld(b).filter((r) => r[0] !== "HOOK_TEXT" && r[0] !== "COLD_OPEN" && r[0] !== "ENDCARD")]
}
function basePlanRowsOld(b: MIter): Row[] {
  const d = b.durationSec
  if (b.shortVideo) {
    return [
      ["HOOK_TEXT", "", "New headline over the first 3 seconds. Same voice.", "Headline nova nos 3 primeiros segundos. Mesma voz.", 1],
      ["HOOK_TEXT", "", "A second headline, from the proof angle. Same voice.", "Uma segunda headline, pelo ângulo da prova. Mesma voz.", 2],
      ["ENDCARD", "offer", "Ends on a 2 s card with the offer from the Brain.", "Termina num cartão de 2 s com a oferta do Brain."],
      ["NATIVE_SEARCH", "", "Opens on a search for the problem, then the video.", "Abre numa busca pelo problema, depois o vídeo."],
      ["STORY", "", "The video inside a story frame.", "O vídeo dentro de uma moldura de story."],
      ["STATIC", "", "New image: the promise with one headline, made from scratch.", "Imagem nova: a promessa com uma headline, criada do zero."],
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
      ["STATIC", "", "New image: someone checking the result at home, with the proof as headline.", "Imagem nova: pessoa conferindo o resultado em casa, com a prova de headline."],
      ["STATIC", "", "New image: the pain in one scene, with a second headline.", "Imagem nova: a dor numa cena, com uma segunda headline.", 1],
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
    ["STATIC", "", "New image: someone checking the result at home, with the proof as headline.", "Imagem nova: pessoa conferindo o resultado em casa, com a prova de headline."],
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
    const notes = notesOf(b.offerId)
    const failFirst = type === b.renderFailType ? { format: "9x16" as FormatCode, code: "RENDER_ERROR" }
      : type === "STATIC" && notes.includes("[mock:static-reject-all]") ? { format: "9x16" as FormatCode, code: "SAFETY_BLOCK" }
      : type === "SPLIT_LP" && b.page403Render ? { format: "9x16" as FormatCode, code: "PAGE_FORBIDDEN" }
      : type === "FRAME" && b.frameFail?.id === variant ? { format: "9x16" as FormatCode, code: b.frameFail.code } : null
    const slowFirst = type === "STATIC" && (notes.includes("[mock:static-reject]") || notes.includes("[mock:static-timeout]"))
    return {
      id: mockId("vi"), index, type, variant, n: n ?? k, change: { en, pt: ptText }, inZip: true, leftOutAt: null, creativeId: null, inLibrary: false, failFirst, slowFirst, sec,
      ...(type === "FRAME" ? { frame: variant as FrameTemplateId } : {}),
    }
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
const isStatic = (p: MPiece) => p.type === "STATIC"
function lastJob(b: MIter, pieceId: string, f: FormatCode) {
  let j: MRenderJob | null = null
  for (const x of b.jobs) if (x.pieceId === pieceId && x.format === f) j = x
  return j
}
/** §14.2: the piece follows its 9:16 only (ready = 9:16 READY, failed = 9:16 FAILED). */
function pieceStatus(b: MIter, p: MPiece, now: number): PieceStatus {
  if (!b.launchedAt) return "planned"
  if (p.leftOutAt) return "left_out"
  const j = lastJob(b, p.id, "9x16")
  if (!j || j.startAt > now) return "queued"
  if (now < j.endAt) return "rendering"
  return j.fail ? "failed" : "ready"
}
function formatState(j: MRenderJob | null, now: number): PieceFormatState {
  if (!j) return "none"
  if (j.startAt > now) return "queued"
  if (now < j.endAt) return "rendering"
  return j.fail ? "failed" : "ready"
}
const failText = (code: string, frames: number, host: string) =>
  code === "PAGE_FORBIDDEN" ? `The product page didn't load: ${host} blocked our browser (403).`
    : code === "SAFETY_BLOCK" ? "The image model refused this concept. Retry tries again; Leave out removes it."
    : code === "FRAME_TEXT_OVERFLOW" ? "The frame text didn't fit at the minimum size (36 px)."
    : code === "CAPTION_COVERED" ? "Something covered the video's captions in this render."
    : `Rendering stopped at frame ${Math.round(frames * 0.6)}.`
function formatsOf(b: MIter, p: MPiece, now: number, host: string): PieceFormat[] {
  return FORMATS.map((format) => {
    if (unsupportedOf(p).includes(format))
      return { format, state: "none" as const, progress: null, errorCode: null, failReason: null, requestUsd: null, supported: false }
    const j = b.launchedAt ? lastJob(b, p.id, format) : null
    const state = formatState(j, now)
    const progress = state === "rendering" && j ? (isStatic(p) ? 0 : Math.round(((now - j.startAt) / (j.endAt - j.startAt)) * 100)) : null
    const fail = state === "failed" && j?.fail ? j.fail : null
    return {
      format, state, progress, errorCode: fail, failReason: fail ? failText(fail, Math.round(p.sec * 30), host) : null,
      requestUsd: state === "failed" || (state === "none" && b.launchedAt && format !== "9x16") ? (isStatic(p) ? STATIC_USD : 0) : null,
      ...(isStatic(p) ? { textCheck: state === "ready" && j ? (format === "9x16" ? textCheckOf(modeOf(j)) : textCheckOf("ok")) : null } : {}),
    }
  })
}

/** Last finished, successful job of a format: a Retry / new format keeps the previous file until the new one is ready (§A10). */
function lastDone(b: MIter, pieceId: string, f: FormatCode, now: number) {
  let j: MRenderJob | null = null
  for (const x of b.jobs) if (x.pieceId === pieceId && x.format === f && x.endAt <= now && !x.fail) j = x
  return j
}
function pieceFiles(b: MIter, p: MPiece, now: number): PieceFile[] {
  const client = db.workspace.shortCode || "WS"
  const d = new Date(b.launchedAt ?? now)
  const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
  const still = p.type === "STATIC"
  const video = sourceVideo(b)
  return FORMATS.flatMap((f) => {
    const j = lastDone(b, p.id, f, now)
    if (!j) return []
    return [{
      format: f, name: `${client}_${mmdd}_${code(b, p)}_${f}.${still ? "png" : "mp4"}`,
      url: still ? staticUrl(f === "9x16" ? modeOf(j) : "ok") : video, mimeType: still ? "image/png" as const : "video/mp4" as const,
      sizeBytes: still ? 1_100_000 + p.index * 13_000 : Math.round(p.sec * (f === "9x16" ? 610_000 : f === "4x5" ? 520_000 : 440_000)), durationSec: still ? null : p.sec,
    }]
  })
}
function sourceVideo(b: MIter) {
  return blobUrl(b.uploadId) ?? MOCK_VIDEO.url
}

/** Ready pieces go to the Library by themselves (§3.3 AUTO_APPROVE): a LibraryItem per piece, once. */
function toLibrary(b: MIter, p: MPiece, now: number) {
  const files = pieceFiles(b, p, now)
  if (p.inLibrary) {
    // a format made later (§14.2) joins the Library item's formats
    const item = (db.library as LibraryItem[]).find((l) => l.id === p.creativeId)
    if (item && (item.formats?.length ?? 0) !== files.length) {
      item.formats = files.map((x) => ({ format: x.format, file: { id: `f_${p.id}_${x.format}`, url: x.url, mimeType: x.mimeType } }))
      saveDb()
    }
    return
  }
  const f916 = files.find((f) => f.format === "9x16")
  if (!f916) return
  p.creativeId ??= mockId("cr")
  p.inLibrary = true
  const of = offerOf(b)
  const adName = f916.name.replace(/_9x16\.(mp4|png)$/, "")
  const still = p.type === "STATIC"
  const item: LibraryItem = {
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
  // headline-e-legenda §2.1: the champion has no burned-in captions → every video piece gets them ([mock:captions-burned] = it has)
  // legenda-protegida §2.3: burned captions + no clean version = these templates/types aren't offered ([mock:captions-burned] or ?mockcaptions=burned)
  const burned = burnedOf(b) && !b.cleanUploadId
  const captionsAuto = !burnedOf(b) || !!b.cleanUploadId
  const captionBlocked = burned
    ? [{ type: "FRAME" as const, template: "cinema" as const, reason: "burned_captions" as const }, { type: "FRAME" as const, template: "question_box" as const, reason: "burned_captions" as const }, { type: "HEADLINE" as const, template: null, reason: "burned_captions" as const }]
    : []
  return { blocks, why, kept, flags, swaps, captionsAuto, captionBlocked, cleanVersion: b.cleanVersion ?? undefined } as AutoInsight
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
    const failedJob = s === "failed" ? lastJob(b, p.id, "9x16") : null
    const frames = Math.round(p.sec * 30)
    const still = isStatic(p)
    const formats = formatsOf(b, p, now, hostOf(of?.sourceUrl))
    // STATIC (§A6/§A10): stage of the image job; the image shows once the 1st one exists; text check of the ready 9:16
    const job916 = still && launched ? lastJob(b, p.id, "9x16") : null
    const phase = still && running ? staticPhase(running, now) : null
    const ready916 = formats[0].state === "ready" && job916 && !job916.fail
    const mode = job916 ? modeOf(job916) : "ok"
    // G1: critical text still wrong after the 2 tries → out of the zip by default (one click puts it back)
    const zipDefault = (mode === "critical" || mode === "extra") && (job916?.priority ?? 0) === 0 && !p.zipSet ? false : p.inZip
    const textCheck = still ? (ready916 ? textCheckOf(mode) : phase?.stage === "retake" || (phase?.attempt === 2) ? textCheckOf("first") : null) : null
    const done916 = still && launched ? lastDone(b, p.id, "9x16", now) : null
    const poster = files.length ? (p.frame ? frameStill(p.frame) : still ? { id: `f_${p.id}_poster`, url: staticUrl(done916 ? modeOf(done916) : mode), mimeType: "image/jpeg" } : mockArt((b.tone + p.index) % 4, p.index % 4))
      : p.frame && s === "ready" ? frameStill(p.frame) : phase?.imageReady ? { id: `f_${p.id}_poster`, url: running?.text && twoImages(running.text) ? "/mock/static-volta.jpg" : "/mock/static-2k.jpg", mimeType: "image/jpeg" } : null
    const retake = still && s === "ready" && textCheck?.status === "mismatch" && !running
    return {
      id: p.id, index: p.index, type: p.type, code: code(b, p), axis: AXIS[p.type], change: pt() ? p.change.pt : p.change.en, status: s,
      previewReady: files.some((f) => f.format === "9x16"), media: still ? "image" : "video",
      render: running ? {
        format: running.format, progress: still ? 0 : Math.round(((now - running.startAt) / (running.endAt - running.startAt)) * 100), frame: still ? null : Math.round(((now - running.startAt) / (running.endAt - running.startAt)) * frames), frames: still ? null : frames,
        ...(phase ? { stage: phase.stage, attempt: phase.attempt } : {}),
      } : null,
      formatsReady: files.length as 0 | 1 | 2 | 3, formats,
      errorCode: failedJob?.fail ?? null,
      failReason: failedJob?.fail ? failText(failedJob.fail, frames, hostOf(of?.sourceUrl)) : null,
      retryHint: failedJob ? (failedJob.fail === "PAGE_FORBIDDEN" ? "use_product_photo" : failedJob.fail === "FRAME_TEXT_OVERFLOW" ? "leave_out" : "retry") : retake ? "retry" : null,
      retryUsd: s === "failed" || s === "left_out" || retake ? (still ? STATIC_USD : 0) : null,
      inZip: s === "ready" || (s === "rendering" && files.some((f) => f.format === "9x16")) ? zipDefault : false, creativeId: launched ? p.creativeId : null,
      poster, files,
      folder: AXIS[p.type] === "ITERATION" ? "1-stretch" : "2-new-audience",
      frame: p.frame
        ? { template: p.frame, second: p.frame === "split_stack" ? { kind: "broll_track" as const, provenance: null, track: TRACK(p.sec) } : null, canSwapBroll: false }
        : null,
      // legenda-protegida §2.2: the frame cropped the burned captions out and redrew ours in the original style
      captionNote: p.frame === "meme" && burnedOf(b) && !b.cleanUploadId ? ("replaced" as const) : null,
      headline: p.type === "HEADLINE"
        ? { mode: p.variant as PieceHeadline["mode"], original: p.variant === "add" ? null : HEADLINE_ORIGINAL, ...HEADLINES[p.n % HEADLINES.length] }
        : null,
      textCheck,
      suggestedPrimaryText: p.frame === "read_caption" ? L("Most people stretch in the morning. That's the mistake. Here is what 10 minutes at night does instead…", "Quase todo mundo alonga de manhã. Esse é o erro. Veja o que 10 minutos à noite fazem no lugar…") : null,
    } as IteratePiece
  })
  const all = b.pieces
  const stretch = all.filter((p) => AXIS[p.type] === "ITERATION").length
  // api.md 25/10: the phase follows only the batch's own 9:16 renders (priority 0); Retry / on-demand formats (priority 10) never send it back to Generate
  const queuedOrRunning = b.jobs.some((j) => (j.priority ?? 0) === 0 && j.endAt > now)
  // ETA: the Remotion line is serial (sum); images run beside it (the longest one)
  const pendingJobs = b.jobs.filter((j) => j.endAt > now)
  const lineMs = pendingJobs.filter((j) => !j.image).reduce((a, j) => a + (j.endAt - Math.max(now, j.startAt)), 0)
  const imageMs = pendingJobs.filter((j) => j.image).reduce((a, j) => Math.max(a, j.endAt - now), 0)
  const remainingMs = launched ? Math.max(lineMs, imageMs) : Math.max(all.filter((p) => !isStatic(p)).reduce((a, p) => a + msOf(p), 0), all.some(isStatic) ? STILL_MS : 0)
  const anyPending = pendingJobs.length > 0
  const nStatic = all.filter(isStatic).length
  const imagesUsd = Math.round(b.jobs.filter((j) => j.image && j.endAt <= now && !j.fail).length * STATIC_USD * 100) / 100
  const liveFiles = pieces.filter((p) => p.status !== "left_out").reduce((a, p) => a + (p.formats ?? []).filter((f) => f.state === "queued" || f.state === "rendering" || f.state === "ready").length, 0)
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
      championId: b.championId, name: b.name, fromLibrary: b.fromLibrary, fromMeta: false, durationSec: b.durationSec, width: b.width, height: b.height,
      ratioLabel: ratioLabel(b.width, b.height), cuts: status === "ANALYZING" && keyIndex(b, now) < 3 ? null : b.shortVideo ? 0 : 6,
      thumbnail: mockArt(b.tone, 1), video: { id: `f_src_${b.id}`, url: sourceVideo(b), mimeType: "video/mp4", width: b.width, height: b.height, durationSec: b.durationSec },
    },
    analysis: analysisOf(b, status, now), insight: insightOf(b, status), error: errorOf(b, status), pieces,
    summary: {
      pieces: all.length, stretch, newAudience: all.length - stretch, files: launched ? liveFiles : all.length,
      ready: pieces.filter((p) => p.status === "ready").length, failed: pieces.filter((p) => p.status === "failed").length, leftOut: pieces.filter((p) => p.status === "left_out").length,
      renderEtaSec: analysisDone && (anyPending || !launched) ? Math.max(1, Math.round(remainingMs / 1000)) : null, videoCreditsUsd: 0,
    },
    cost: {
      analysisEstimateUsd, analysisUsd, generateEstimateUsd: status === "PLAN_READY" ? Math.round(nStatic * STATIC_USD * 100) / 100 : null,
      imagesUsd, renderUsd: 0, totalUsd: Math.round((analysisUsd + imagesUsd) * 100) / 100,
    },
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
  const winners = (db.library as LibraryItem[]).filter((l) => l.isWinner && l.media !== "image").slice(0, 3)
  return {
    ...ITER_LIMITS, analysisUsdPerSec: USD_PER_SEC, analysisTypicalUsd: Math.round((30 * USD_PER_SEC + PLAN_USD) * 100) / 100,
    types: ["CUT", "COLD_OPEN", "HOOK_TEXT", "ENDCARD", "SPLIT_LP", "STORY", "REVIEW", "NATIVE_SEARCH", "STATIC"], metaConnected: false,
    offers, defaultOfferId: offers.length === 1 ? offers[0].id : last, recentWinners: empty ? [] : (winners as LibraryItem[]), staticImageUsd: STATIC_USD,
  }
}

/** 26/10 POST /iterate/:id/replan: a new plan over the finished analysis (PLANNING for one step, then PLAN_READY) */
/** 26/10 POST /iterate { championId }: a new batch of the same champion, analysis reused (PLANNING, then PLAN_READY) */
export function newIterFromChampion(src: MIter) {
  const now = Date.now()
  const b: MIter = {
    ...src, id: mockId("ib"), t0: now, startIndex: KEYS.length - 1, failAt: null, retries: 0, pieces: [], launchedAt: null, jobs: [],
    zip: { status: "none", t0: 0, key: "", sizeBytes: null }, downloadedAt: null, createdAt: now, archived: false,
    cleanVersion: null, cleanUploadId: src.cleanUploadId ?? null, formatFailUsed: false,
  }
  b.pieces = buildPieces(b)
  it.batches.unshift(b)
  saveIter()
  return b
}
export function replanPieces(b: MIter) {
  b.pieces = buildPieces(b)
}
export function replanIter(b: MIter) {
  b.startIndex = KEYS.length - 1
  b.t0 = Date.now()
  b.pieces = buildPieces(b)
  saveIter()
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
    formatFailType: (/\[mock:format-fail:([A-Z_]+)\]/.exec(notes)?.[1] as AutoVariationType | undefined) ?? null, formatFailUsed: false,
    frameFail: frameFailOf(notes),
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

/** Next free slot of the Remotion line (images don't use it). */
const lineEnd = (b: MIter, now: number) => Math.max(now + 300, ...b.jobs.filter((j) => !j.image).map((j) => j.endAt))

/** §14.2: the batch queues only the 9:16, in plan order (priority 0). The STATIC image is submitted right away, beside the line. */
export function launchIter(b: MIter, at = Date.now()) {
  b.launchedAt = at
  let t = at + 400
  for (const p of b.pieces) {
    // the batch's first frame: its 1st render fails CAPTION_COVERED, the retry passes
    const covered = !!p.frame && p.id === b.pieces.find((x) => x.frame)?.id && (captionsFlag() === "covered" || notesOf(b.offerId).includes("[mock:caption-covered]"))
    const fail = covered ? "CAPTION_COVERED" : p.failFirst && p.failFirst.format === "9x16" ? p.failFirst.code : null
    if (isStatic(p)) {
      const text = textModeFor(b.offerId)
      b.jobs.push({ pieceId: p.id, format: "9x16", startAt: at + 400, endAt: at + 400 + (fail ? STILL_MS : staticMs(text, p.slowFirst)), fail, priority: 0, image: true, text })
      continue
    }
    b.jobs.push({ pieceId: p.id, format: "9x16", startAt: t, endAt: t + RENDER_MS, fail, priority: 0 })
    t += RENDER_MS
  }
  saveIter()
}

/** Retry of the piece = a new 9:16 (STATIC: a new image, costs STATIC_USD when it finishes). */
export function retryPiece(b: MIter, p: MPiece) {
  const now = Date.now()
  p.leftOutAt = null
  p.inZip = true
  const j = lastJob(b, p.id, "9x16")
  // §A10: STATIC ready with a text mismatch → a new image (with its check); the old one stays until the new one is ready
  if (j && !j.fail && j.endAt <= now && isStatic(p)) {
    p.zipSet = true
    b.jobs.push({ pieceId: p.id, format: "9x16", startAt: now + 300, endAt: now + 300 + staticMs("ok"), fail: null, priority: 10, image: true, text: "ok" })
  } else if (j && j.fail && j.endAt <= now) {
    if (isStatic(p)) b.jobs.push({ pieceId: p.id, format: "9x16", startAt: now + 300, endAt: now + 300 + staticMs("ok"), fail: null, priority: 10, image: true, text: "ok" })
    else {
      const t = lineEnd(b, now)
      b.jobs.push({ pieceId: p.id, format: "9x16", startAt: t, endAt: t + RENDER_MS, fail: null, priority: 10 })
    }
  }
  saveIter()
}

/** Current state of a format of the piece (for the idempotency of POST /formats). */
export function formatStateOf(b: MIter, p: MPiece, f: FormatCode, now = Date.now()) {
  return formatState(lastJob(b, p.id, f), now)
}

/**
 * §14.2 POST /iterate/pieces/:id/formats: a video format goes ahead of every queued batch render (priority 10, FIFO between
 * requests) and never interrupts the one running; a STATIC format is a new image beside the line.
 */
export function requestFormat(b: MIter, p: MPiece, f: FormatCode) {
  const now = Date.now()
  if (isStatic(p)) {
    b.jobs.push({ pieceId: p.id, format: f, startAt: now + 300, endAt: now + 300 + STILL_MS + CHECK_MS, fail: null, priority: 10, image: true, text: "ok" })
    saveIter()
    return
  }
  const fail = f === "4x5" && b.formatFailType === p.type && !b.formatFailUsed ? "RENDER_ERROR" : null
  if (fail) b.formatFailUsed = true
  const line = b.jobs.filter((j) => !j.image)
  const running = line.find((j) => j.startAt <= now && now < j.endAt)
  const pending = line.filter((j) => j.startAt > now)
  const lastAsked = pending.filter((j) => (j.priority ?? 0) >= 10).reduce((a, j) => Math.max(a, j.endAt), 0)
  const at = lastAsked || (pending.length ? Math.min(...pending.map((j) => j.startAt)) : Math.max(now + 300, running?.endAt ?? 0))
  for (const j of pending) {
    if ((j.priority ?? 0) < 10 && j.startAt >= at) {
      j.startAt += RENDER_MS
      j.endAt += RENDER_MS
    }
  }
  b.jobs.push({ pieceId: p.id, format: f, startAt: at, endAt: at + RENDER_MS, fail, priority: 10 })
  saveIter()
}

function frameFailOf(notes: string): MIter["frameFail"] {
  const f = /\[mock:frame-fail:([a-z_]+)\]/.exec(notes)?.[1]
  if (f && FRAME_IDS.includes(f as FrameTemplateId)) return { id: f as FrameTemplateId, code: "RENDER_ERROR" }
  const o = /\[mock:frame-overflow:([a-z_]+)\]/.exec(notes)?.[1]
  if (o && FRAME_IDS.includes(o as FrameTemplateId)) return { id: o as FrameTemplateId, code: "FRAME_TEXT_OVERFLOW" }
  return null
}
/** legenda-protegida (web-mock): ?mockcaptions=burned|covered (sessionStorage mock:captions) or [mock:captions-burned] in the notes */
const captionsFlag = () => (typeof window === "undefined" ? null : sessionStorage.getItem("mock:captions"))
function burnedOf(b: MIter) {
  return notesOf(b.offerId).includes("[mock:captions-burned]") || captionsFlag() === "burned" || captionsFlag() === "covered"
}
export function batchOfChampion(championId: string) {
  return it.batches.find((b) => b.championId === championId && !b.archived) ?? null
}
export function setIterClean(championId: string, uploadId: string | null) {
  for (const b of it.batches) if (b.championId === championId) b.cleanUploadId = uploadId
  saveIter()
}
/** web-mock: Retry of a STATIC with ?mocktext=cap answers SPEND_CAP_EXCEEDED */
export const textCapForced = () => typeof window !== "undefined" && sessionStorage.getItem("mock:text") === "cap"
export const isUnsupportedFormat = (p: MPiece, f: FormatCode) => unsupportedOf(p).includes(f)

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
export function autoWaiting(): WaitingBatchRef[] {
  const now = Date.now()
  return it.batches.filter((b) => !b.archived).flatMap((b): WaitingBatchRef[] => {
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
