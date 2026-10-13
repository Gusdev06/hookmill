"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { IterateBatch, IteratePiece } from "@/lib/api/types"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ik } from "@/hooks/use-iterate"

/** Piece writes (variacao-auto-v1 §5.1): In zip (optimistic), Retry (free), Leave out. The batch query is the source of truth. */
export function usePieceActions(batchId: string) {
  const qc = useQueryClient()
  const t = useTranslations("iterate.generate")
  const errorMessage = useErrorMessage()
  const key = ik.batch(batchId)
  const patchPiece = (p: IteratePiece) =>
    qc.setQueryData<IterateBatch>(key, (b) => (b ? { ...b, pieces: b.pieces.map((x) => (x.id === p.id ? p : x)) } : b))

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
    onSuccess: (p) => {
      patchPiece(p)
      toast(t("retried", { code: p.code }))
      qc.invalidateQueries({ queryKey: key })
    },
    onError: (e) => toast(errorMessage(e)),
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
  return { inZip, retry, leaveOut }
}
