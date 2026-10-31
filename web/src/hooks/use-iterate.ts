"use client"

import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import type { IterateBatch } from "@/lib/api/types"

/** Query keys of the automatic variation. Polling only, no SSE (variacao-auto-v1 §10). */
export const ik = {
  config: ["iterate", "config"] as const,
  batch: (id: string) => ["iterate", "batch", id] as const,
}

export function useIterateConfig() {
  return useQuery({ queryKey: ik.config, queryFn: ({ signal }) => api.iterate.config({ signal }), staleTime: 30_000 })
}

/** §10: GET /iterate/:id every 1.5 s while ANALYZING/PLANNING, phase generate or the zip is building; stops otherwise.
 *  Rev. 23/10 (§14.2): also while any on-demand format (4:5 / 1:1) is queued or rendering — the phase stays `download`. */
export function iterateInterval(b: IterateBatch | undefined) {
  if (!b) return false
  if (b.status === "ANALYZING" || b.status === "PLANNING" || b.phase === "generate" || b.zip.status === "building") return 1_500
  if (b.pieces.some((p) => p.render || p.formats?.some((f) => f.state === "queued" || f.state === "rendering"))) return 1_500
  // amostra-gratis-v1 §2/§3: the sample launches by itself from PLAN_READY, and the blurred preview comes a bit after the piece
  if (b.sample && b.status === "PLAN_READY") return 1_500
  if (b.pieces.some((p) => p.locked && p.status === "ready" && !p.preview)) return 2_000
  return false
}

export function useIterate(id: string | null) {
  return useQuery({
    queryKey: ik.batch(id ?? ""),
    queryFn: ({ signal }) => api.iterate.get(id!, { signal }),
    enabled: !!id,
    refetchInterval: (q) => iterateInterval(q.state.data),
  })
}
