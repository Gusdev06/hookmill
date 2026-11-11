import type { AiFormat, AiPreview, AiPreviewsView, IterateBatch, TemplateCard } from "@/lib/api/types"
import { AI_PREVIEWS } from "@/lib/flags"

/* templates-ia-previas-v1 (07/11): which gallery cards run the 4-previews flow (`TemplateCard.aiFormat`), and the derived numbers the screens share. */

/** The gallery chip each With AI format lives under (design §2.1): Podcast (2) · FAQ · Talking head · Cartoon · Musical · Animations. */
export type AiChip = "podcast" | "faq" | "talking" | "cartoon" | "musical" | "animations"
export const AI_CHIPS: AiChip[] = ["podcast", "faq", "talking", "cartoon", "musical", "animations"]
export const FORMAT_CHIP: Record<AiFormat, AiChip> = { F04: "faq", F09: "podcast", F10: "podcast" }

/** The With AI formats still in the works (design §2.1 "Soon"): shown greyed, no detail, no API call. */
export const AI_SOON: { key: "talking" | "cartoon" | "musical" | "animations"; tone: number }[] = [
  { key: "talking", tone: 0 },
  { key: "cartoon", tone: 3 },
  { key: "musical", tone: 1 },
  { key: "animations", tone: 2 },
]

/** The format of a card that runs the previews flow; null = any other card (or the flag off). */
export function aiFormatOf(card: Pick<TemplateCard, "aiFormat"> | null | undefined): AiFormat | null {
  return AI_PREVIEWS ? (card?.aiFormat ?? null) : null
}

/** "New angle" left for one preview: the smaller of its own 3 and the batch's 6 (contract §5.4). */
export function regenLeft(p: AiPreview, ai: AiPreviewsView) {
  return Math.max(0, Math.min(p.regenerations.max - p.regenerations.used, ai.limits.regenPerBatch - ai.limits.regenUsed))
}
export const batchRegenLeft = (ai: AiPreviewsView) => Math.max(0, ai.limits.regenPerBatch - ai.limits.regenUsed)

/** The approved previews and the IteratePiece of each (null until the API fills `pieceId`). */
export function approvedOf(b: IterateBatch) {
  const previews = b.ai?.previews ?? []
  return previews
    .filter((p) => p.status === "approved")
    .map((p) => ({ preview: p, piece: p.pieceId ? (b.pieces.find((x) => x.id === p.pieceId) ?? null) : null }))
}

/** Total of a confirm: null = no price yet (only the team runs it, "— credits"). */
export const totalOf = (ai: AiPreviewsView, n: number) => (ai.prices.videoEach == null ? null : ai.prices.videoEach * n)
