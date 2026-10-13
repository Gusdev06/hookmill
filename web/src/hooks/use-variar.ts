"use client"

import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import type { ChampionDetail, VariationBatch } from "@/lib/api/types"

/** Feature 2 query keys. No SSE here: polling per eventos.md / feature-2 §8. */
export const vk = {
  config: ["champions", "config"] as const,
  champion: (id: string) => ["champion", id] as const,
  batches: (championId: string) => ["champion", championId, "batches"] as const,
  batch: (id: string) => ["batch", id] as const,
  estimate: (id: string) => ["batch", id, "estimate"] as const,
}

export function useChampionConfig() {
  return useQuery({ queryKey: vk.config, queryFn: () => api.champions.config(), staleTime: 60_000 })
}

const championBusy = (c: ChampionDetail | undefined) => c?.status === "RESOLVING" || c?.status === "ANALYZING"

/** GET /champions/:id every 2 s while RESOLVING / ANALYZING; stops on READY / FAILED. */
export function useChampion(id: string | null) {
  return useQuery({
    queryKey: vk.champion(id ?? ""),
    queryFn: ({ signal }) => api.champions.get(id!, { signal }),
    enabled: !!id,
    refetchInterval: (q) => (championBusy(q.state.data) ? 2_000 : false),
  })
}

/** Batch polling: 1.5 s while planning (or an item is being rewritten), 5 s while a launched creative runs, else 30 s. */
export function batchInterval(b: VariationBatch | undefined) {
  if (!b) return false
  if (b.status === "PLANNING" || b.items.some((i) => i.status === "WRITING")) return 1_500
  if (b.castings.some((c) => c.batches[0]?.faces.some((f) => f.status === "QUEUED" || f.status === "GENERATING"))) return 1_500
  if (b.status === "LAUNCHED") return b.items.some((i) => i.creative?.status === "progress") ? 5_000 : 30_000
  return false
}

export function useBatch(id: string | null) {
  return useQuery({
    queryKey: vk.batch(id ?? ""),
    queryFn: ({ signal }) => api.batches.get(id!, { signal }),
    enabled: !!id,
    refetchInterval: (q) => batchInterval(q.state.data),
  })
}

export function useChampionBatches(championId: string | null) {
  return useQuery({ queryKey: vk.batches(championId ?? ""), queryFn: () => api.champions.batches(championId!), enabled: !!championId })
}
