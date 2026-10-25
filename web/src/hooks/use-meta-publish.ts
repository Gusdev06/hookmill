"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { CreativeMetaResponse, MetaPublication, MetaPublishBody } from "@/lib/api/types"
import { isMetaOff, mk } from "./use-meta"

/*
 * Send → "Publish to Meta" (meta-v1 §3.3, sequence §3.3.1). One query per creative: GET /creatives/:id/meta brings the
 * current publication, the history and the prefilled defaults. While the publication is PUBLISHING the query polls every
 * 2 s (api.md §5); the six steps come from `publication.job.checklist`.
 */
export const pk = {
  creative: (id: string) => ["meta", "publish", id] as const,
}

/** The six stages of the META_PUBLISH job, in order (§3.3). Used when the job has no checklist yet. */
export const PUBLISH_STAGES = ["uploading_video", "processing_video", "creating_campaign", "creating_adset", "creating_creative", "creating_ad"] as const
export type PublishStage = (typeof PUBLISH_STAGES)[number]

export function useCreativeMeta(id: string, enabled = true) {
  return useQuery({
    queryKey: pk.creative(id),
    queryFn: ({ signal }) => api.meta.creative(id, { signal }),
    enabled,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.publication?.status === "PUBLISHING" ? 2_000 : false),
    retry: (n, e) => n < 1 && !isMetaOff(e) && !(isApiError(e) && e.status < 500),
  })
}

function patchPublication(qc: ReturnType<typeof useQueryClient>, id: string, p: MetaPublication) {
  qc.setQueryData<CreativeMetaResponse>(pk.creative(id), (prev) => {
    if (!prev) return prev
    const history = prev.publication && prev.publication.id !== p.id ? [prev.publication, ...prev.history.filter((h) => h.id !== prev.publication!.id)] : prev.history
    return { ...prev, publication: p, history: history.filter((h) => h.id !== p.id) }
  })
}

/** The four write actions; every success replaces `publication` in the cache and refreshes Home/Campaigns lists. */
export function usePublishActions(id: string) {
  const qc = useQueryClient()
  const done = (p: MetaPublication) => {
    patchPublication(qc, id, p)
    void qc.invalidateQueries({ queryKey: pk.creative(id) })
    void qc.invalidateQueries({ queryKey: ["meta", "publications"] })
    void qc.invalidateQueries({ queryKey: mk.summary("7d") })
    void qc.invalidateQueries({ queryKey: mk.summary("30d") })
  }
  const publish = useMutation({ mutationFn: (b: MetaPublishBody) => api.meta.publish(id, b), onSuccess: done })
  const retry = useMutation({ mutationFn: () => api.meta.retry(id), onSuccess: done })
  const activate = useMutation({ mutationFn: () => api.meta.activate(id), onSuccess: done })
  const pause = useMutation({ mutationFn: () => api.meta.pause(id), onSuccess: done })
  return { publish, retry, activate, pause }
}

/** Fraction digits of a currency (2 for USD/BRL/EUR, 0 for JPY): minor units ↔ the number the user types. */
export function minorFactor(currency: string | null | undefined) {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: currency || "USD" }).resolvedOptions().maximumFractionDigits ?? 2
    return 10 ** digits
  } catch {
    return 100
  }
}

/** Formats an amount in minor units in the account's currency ("$5.00"). */
export function useMinorMoney(currency: string | null | undefined) {
  const format = useFormatter()
  const cur = currency || "USD"
  const factor = minorFactor(cur)
  return (minor: number | null | undefined) => (minor === null || minor === undefined ? "—" : format.number(minor / factor, { style: "currency", currency: cur }))
}
