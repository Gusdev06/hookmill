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

/** §10: GET /iterate/:id every 1.5 s while ANALYZING/PLANNING, phase generate or the zip is building; stops otherwise. */
export function iterateInterval(b: IterateBatch | undefined) {
  if (!b) return false
  if (b.status === "ANALYZING" || b.status === "PLANNING" || b.phase === "generate" || b.zip.status === "building") return 1_500
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
