import type { HeadlineFitLook, HeadlineFitResult, PieceHeadline } from "@/lib/api/types"
import { loadHeadlineFit } from "@/lib/headline-fit"

/*
 * troca-texto-queimado-v1 §16 (F1b), web-mock only: ?mockheadline=… (sessionStorage mock:headline, see scenario.ts).
 * The two `fit` looks are example data shaped like the V2 measure (720 × 1280 champion), checked against the real
 * `ajustarHeadlineCopia`: the plan texts below land on same / rewrap / shrink; "Back pain?" is too_short in `loose`; a 13-word
 * line reaches the chin in `loose` (over_chin) and grows the box in `box`.
 */
export type HeadlineMock = "box" | "loose" | "close" | "pending" | "near_caption" | "font_far" | "plate_rejected" | "no_fit" | "over_face" | "moves" | "low_confidence"

export const headlineMock = (): HeadlineMock | null => (typeof window === "undefined" ? null : (sessionStorage.getItem("mock:headline") as HeadlineMock | null))
/** The champion's headline is copied (HEADLINE `replace` is offered). */
export const headlineCopied = () => {
  const m = headlineMock()
  return m === "box" || m === "loose" || m === "close"
}
/** `insight.headlineBlocked.reason` / template fit reason. null = not blocked by the flag (copied, or no flag → caller's default). */
export const headlineBlockedReason = (): string | null => {
  const m = headlineMock()
  return !m || headlineCopied() ? null : `headline_${m}`
}
/** `loose` erases the old text first: the analysis shows `preparing_plate` before the plan. */
export const headlineNeedsPlate = () => {
  const m = headlineMock()
  return m === "loose" || m === "close"
}

export const FIT_LOOSE: HeadlineFitLook = {
  kind: "loose", canvas: { width: 720, height: 1280 },
  fontId: "arimo-600", sizePx: 42, letterSpacingEm: 0, linePitchPx: 52, firstBaselineY: 880,
  align: "center", centerX: 360, caseStyle: "sentence",
  originalLines: [{ chars: 18, widthPx: 329 }, { chars: 16, widthPx: 325 }],
  erasedRects: [{ x: 196, y: 849, w: 329, h: 40 }, { x: 172, y: 901, w: 325, h: 40 }],
  bottomLimitY: 1010, chinY: 800, sideMarginPx: 36,
  emoji: { widthPx: 42, gapPx: 10, lineIndex: 1, side: "end" },
  box: null,
}
export const FIT_BOX: HeadlineFitLook = {
  kind: "box", canvas: { width: 720, height: 1280 },
  fontId: "montserrat-500", sizePx: 40, letterSpacingEm: 0, linePitchPx: 50, firstBaselineY: 200,
  align: "center", centerX: 360, caseStyle: "sentence",
  originalLines: [{ chars: 22, widthPx: 415 }, { chars: 28, widthPx: 618 }],
  erasedRects: [], bottomLimitY: null, chinY: null, sideMarginPx: 24, emoji: null,
  box: { x: 40, y: 150, w: 640, h: 130 },
}
/** What the original said, per look (the loose one keeps its emoji: the emoji is the piece's, never in the text). */
export const ORIGINAL_LOOSE = "I tried everything for my back pain 😩"
export const ORIGINAL_BOX = "I tried everything for my back pain, nothing worked"

/** The new headlines of the plan in copy mode [en, pt]: same / slightly smaller / a longer one (box grows, loose shrinks). */
export const COPY_TEXTS: [string, string][] = [
  ["Your back pain isn't your mattress", "Sua dor nas costas não é o colchão"],
  ["Your back pain isn't your mattress, it's the way you sleep", "Sua dor nas costas não é o colchão, é o jeito que você dorme"],
  ["What changed after my first week of stretching", "O que mudou depois da primeira semana alongando"],
]

// The same function the web and the API use (the mock answers like the API: fitStep on the plan, 422 on PATCH). Loaded once, in
// mock mode only (this module is part of the mock chunk); until it loads, `fitStep` is null.
type Fit = (fit: HeadlineFitLook, text: string) => HeadlineFitResult
let fitFn: Fit | null = null
export const headlineFitReady: Promise<Fit> | null = typeof window === "undefined" ? null : loadHeadlineFit().then((f) => (fitFn = f))
export const measureHeadline = (look: HeadlineFitLook, text: string): HeadlineFitResult | null => (fitFn ? fitFn(look, text) : null)
export const lookNow = (): HeadlineFitLook => (headlineMock() === "box" ? FIT_BOX : FIT_LOOSE)

/** The F1b fields of a HEADLINE `replace` piece. `n` = the piece's index among the headlines; `planReady` = the `fit` only then. */
export function headlineCopyFields(n: number, text: string, planReady: boolean): Pick<PieceHeadline, "copy" | "fontTier" | "fitStep" | "fit" | "original"> {
  const m = headlineMock()
  const box = m === "box"
  const look = box ? FIT_BOX : FIT_LOOSE
  return {
    original: box ? ORIGINAL_BOX : ORIGINAL_LOOSE,
    copy: box ? "box" : "loose",
    fontTier: m === "close" && n === 0 ? "close" : "same",
    fitStep: measureHeadline(look, text)?.step ?? null,
    fit: planReady ? look : null,
  }
}
/** Any ?mockheadline set: an `add` piece also carries `copy: 'add'` (an API with F1b sends it). */
export const headlineMockAdd = () => headlineMock() !== null
