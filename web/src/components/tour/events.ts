"use client"

import { useCallback } from "react"
import { useLocale } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import type { ProductEventInput, TourEventName, TourState, TourStateV2 } from "@/lib/api/types"
import { useSession } from "@/components/providers/session-provider"
import { metaReady, useMetaConnection } from "@/hooks/use-meta"
import { useCredits } from "@/hooks/use-templates"

/*
 * tour-v2 §6: tour and tip events. Best-effort, fire-and-forget: queued and sent in one POST /events ~1 s later (or when
 * the tab hides). Never blocks the UI, never retries, never shows an error. workspaceId / userId / role come from the
 * session on the server; the client sends locale, viewport, variant, replay and the event's own fields.
 */
/** = EVENTS_MAX_PER_REQUEST of the contract (types-only import here) */
const EVENTS_MAX_PER_REQUEST = 50
let queue: ProductEventInput[] = []
let timer = 0
function flush() {
  window.clearTimeout(timer)
  timer = 0
  while (queue.length) {
    const events = queue.slice(0, EVENTS_MAX_PER_REQUEST)
    queue = queue.slice(EVENTS_MAX_PER_REQUEST)
    api.events.send({ events }).catch(() => {})
  }
}
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && queue.length) flush()
  })
}
function push(e: ProductEventInput) {
  queue.push(e)
  if (!timer) timer = window.setTimeout(flush, 1000)
}

export const TOUR_KEY = ["workspace", "tour"] as const
/** The tour state (GET /workspace/tour?v=2). Shared by the provider and the tips; not asked for CLIENT tips. */
export function useTourState(enabled = true) {
  return useQuery<TourStateV2 | TourState>({ queryKey: TOUR_KEY, queryFn: ({ signal }) => api.workspace.tour({ signal }), enabled, staleTime: 60_000 })
}

export const NARROW_PX = 760
const viewport = () => (typeof window !== "undefined" && window.innerWidth <= NARROW_PX ? "phone" : "desktop")

/** The variant every event carries (§6): Meta connected, a winner, a sample account. */
export function useTourVariant() {
  const { session } = useSession()
  const client = session.workspace.role === "CLIENT"
  const conn = useMetaConnection(!client)
  const credits = useCredits()
  const tour = useTourState()
  return {
    meta: metaReady(conn.data),
    metaKnown: !conn.isPending || conn.isError,
    winner: !!tour.data?.winnerMetaAdId,
    sample: credits.data?.access === "SAMPLE",
    credits: credits.data,
  }
}

export function useTrack() {
  const locale = useLocale()
  const v = useTourVariant()
  const { meta, winner, sample } = v
  return useCallback(
    (name: TourEventName, props: Record<string, unknown> = {}, replay = false) => {
      push({ name, at: new Date().toISOString(), props: { locale, viewport: viewport(), variant: { meta, winner, sample }, replay, ...props } })
    },
    [locale, meta, winner, sample]
  )
}
