"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { IterateBatch, IteratePiece, RequestPieceFormatBody } from "@/lib/api/types"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ik } from "@/hooks/use-iterate"
import { effectiveRole } from "@/lib/dev-role"
import { FORMAT_LABEL } from "./parts"

type AskFormat = RequestPieceFormatBody["format"]

/** CLIENT doesn't ask for formats (§14.2 rule 6: the STATIC costs money); it downloads what is ready. */
export function useCanMakeFormats() {
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  return role !== "CLIENT"
}

/** "~$0.22" for a paid request (STATIC image); null when it costs nothing. */
export function usePriceLabel() {
  const format = useFormatter()
  return (usd: number | null | undefined) =>
    usd && usd > 0 ? `~${format.number(usd, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null
}

export interface CapInfo { spentUsd: number; capUsd: number }
/** SPEND_CAP_EXCEEDED details = `{ spentUsd, capUsd, estimateUsd }` (monthly cap, api.md §1). NaN when they didn't come. */
export function capInfo(e: unknown): CapInfo | null {
  if (!isApiError(e) || e.code !== "SPEND_CAP_EXCEEDED") return null
  const d = (e.details ?? {}) as { spentUsd?: number; capUsd?: number }
  return typeof d.spentUsd === "number" && typeof d.capUsd === "number" ? { spentUsd: d.spentUsd, capUsd: d.capUsd } : { spentUsd: NaN, capUsd: NaN }
}

/** SPEND_CAP_EXCEEDED details (api.md §1): the line under the toast. */
function useCapMessage() {
  const t = useTranslations("iterate.formats")
  const format = useFormatter()
  const usd = (v: number) => format.number(v, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (e: unknown) => {
    const c = capInfo(e)
    if (!c) return null
    return Number.isFinite(c.spentUsd) ? t("capBody", { spent: usd(c.spentUsd), cap: usd(c.capUsd) }) : t("capShort")
  }
}

/** Piece writes (variacao-auto-v1 §5.1, §14.2): In zip (optimistic), Retry, Leave out, ask for a format. The batch query is the source of truth. */
export function usePieceActions(batchId: string, opts: { onCap?: (c: CapInfo) => void } = {}) {
  const qc = useQueryClient()
  const t = useTranslations("iterate.generate")
  const tf = useTranslations("iterate.formats")
  const errorMessage = useErrorMessage()
  const capMessage = useCapMessage()
  const price = usePriceLabel()
  const key = ik.batch(batchId)
  const patchPiece = (p: IteratePiece) =>
    qc.setQueryData<IterateBatch>(key, (b) => (b ? { ...b, pieces: b.pieces.map((x) => (x.id === p.id ? p : x)) } : b))
  const fail = (e: unknown) => {
    // the Text check panel shows the cap inline (Retry disabled + reason), so no toast on top of it
    const c = capInfo(e)
    if (c && opts.onCap) return opts.onCap(c)
    // §B4: the template has no such format (the API answers before the view caught up): refresh so the button goes away
    if (isApiError(e) && e.code === "INVALID_STATE" && (e.details as { reason?: string } | undefined)?.reason === "format_not_supported") {
      qc.invalidateQueries({ queryKey: key })
      return void toast(tf("notSupported"))
    }
    const cap = capMessage(e)
    toast(cap ? tf("capTitle") : errorMessage(e), cap ? { description: cap } : undefined)
  }

  const inZip = useMutation({
    mutationFn: ({ piece, value }: { piece: IteratePiece; value: boolean }) => api.iterate.updatePiece(piece.id, { inZip: value }),
    onMutate: async ({ piece, value }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<IterateBatch>(key)
      patchPiece({ ...piece, inZip: value })
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      toast(errorMessage(e))
    },
    onSuccess: patchPiece,
  })
  const retry = useMutation({
    mutationFn: ({ piece, photo }: { piece: IteratePiece; photo?: boolean }) => api.iterate.retryPiece(piece.id, photo ? { useProductPhoto: true } : {}),
    onSuccess: (p, { piece }) => {
      patchPiece(p)
      const paid = price(piece.retryUsd)
      toast(paid ? t("retriedPaid", { code: p.code, usd: paid }) : t("retried", { code: p.code }))
      qc.invalidateQueries({ queryKey: key })
    },
    onError: fail,
  })
  const leaveOut = useMutation({
    mutationFn: (piece: IteratePiece) => api.iterate.leaveOut(piece.id),
    onSuccess: (p) => {
      patchPiece(p)
      toast(t("leftOut", { code: p.code }))
      qc.invalidateQueries({ queryKey: key })
    },
    onError: (e) => toast(errorMessage(e)),
  })
  /** POST /iterate/pieces/:id/formats — make 4:5 / 1:1, or try a failed one again (same route). */
  const makeFormat = useMutation({
    mutationFn: ({ piece, format }: { piece: IteratePiece; format: AskFormat }) => api.iterate.requestFormat(piece.id, { format }),
    onSuccess: (p, { format }) => {
      patchPiece(p)
      toast(tf("queued", { code: p.code, format: FORMAT_LABEL[format] }))
      qc.invalidateQueries({ queryKey: key })
    },
    onError: fail,
  })
  return { inZip, retry, leaveOut, makeFormat }
}

/**
 * "4:5 for all" / "1:1 for all" on the Download (§14.6 R-F): one call of the route per piece, in order, so a spend cap
 * stops the rest instead of firing N errors. Returns how many were queued.
 */
export function useMakeFormatForAll(batchId: string) {
  const qc = useQueryClient()
  const tf = useTranslations("iterate.formats")
  const errorMessage = useErrorMessage()
  const capMessage = useCapMessage()
  const key = ik.batch(batchId)
  return useMutation({
    mutationFn: async ({ pieces, format }: { pieces: IteratePiece[]; format: AskFormat }) => {
      let queued = 0
      let error: unknown = null
      for (const p of pieces) {
        try {
          const np = await api.iterate.requestFormat(p.id, { format })
          qc.setQueryData<IterateBatch>(key, (b) => (b ? { ...b, pieces: b.pieces.map((x) => (x.id === np.id ? np : x)) } : b))
          queued++
        } catch (e) {
          error = e
          if (isApiError(e) && (e.code === "SPEND_CAP_EXCEEDED" || e.code === "FORBIDDEN")) break
        }
      }
      return { queued, total: pieces.length, error, format }
    },
    onSuccess: ({ queued, total, error, format }) => {
      qc.invalidateQueries({ queryKey: key })
      const label = FORMAT_LABEL[format]
      if (!error) toast(tf("queuedAll", { n: queued, format: label }))
      else {
        const cap = capMessage(error)
        toast(tf("queuedSome", { n: queued, total, format: label }), { description: cap ?? errorMessage(error) })
      }
    },
  })
}
