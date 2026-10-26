/**
 * API types come from @maquina/contratos (docs/contratos/api.md, owner: maquina-arquiteto).
 * This file only re-exports them and adds web-side runtime constants.
 */
export type * from "@maquina/contratos"
import type { Step } from "@maquina/contratos"

export const STEPS: readonly Step[] = ["offer", "scripts", "avatar", "engine", "generation", "edit", "review"]

/*
 * variacao-auto-v1 §4 "Mudanças em tipos existentes" not yet in @maquina/contratos/index.ts (A0 left them out).
 * Optional here so the web works with the API before and after they land; drop this block when the contract has them.
 */
import type { FileRef, FormatCode, LibraryItem, LibraryQuery, VariationAxis, VariationRef, WaitingBatchRef } from "@maquina/contratos"
export type AutoVariationRef = VariationRef & { code?: string | null; axis?: VariationAxis | null }
export type LibraryItemV = Omit<LibraryItem, "variation"> & {
  variation: AutoVariationRef | null
  /** "image" = STATIC piece: `video` carries the PNG */
  media?: "video" | "image"
  formats?: { format: FormatCode; file: FileRef }[]
}
export type LibraryQueryV = LibraryQuery & { variationCode?: string; media?: "video" }
export type WaitingBatchRefV = Omit<WaitingBatchRef, "status"> & {
  status: WaitingBatchRef["status"] | "ANALYSIS_FAILED" | "PIECES_READY"
  mode?: "MANUAL" | "AUTO"
  readyCount?: number | null
}

/*
 * headline-e-legenda-v1 (25/10): os tipos já estão em @maquina/contratos (HEADLINE no AutoVariationType,
 * IteratePiece.headline, AutoInsight.captionsAuto). Apelidos mantidos só pra não mexer nos imports do web; o frontend pode tirar.
 */
import type { AutoVariationType, AutoInsight, IteratePiece, PieceHeadline as PieceHeadlineC } from "@maquina/contratos"
export type AutoVariationTypeV = AutoVariationType
export type PieceHeadline = PieceHeadlineC
export type IteratePieceV = IteratePiece
export type AutoInsightV = AutoInsight
