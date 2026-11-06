"use client"

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { research } from "@/lib/api/research"
import type { Competitor, CompetitorDiscoveryView, DismissReason, ListResearchAdsQuery, ResearchAdCard, ResearchAdDetail, ResearchAdPage } from "@/lib/api/types"

/** Ad Radar query keys (ads-research-v1 §8: polling every 3 s while something runs). */
export const rk = {
  all: ["research"] as const,
  status: ["research", "status"] as const,
  discovery: ["research", "discovery"] as const,
  competitors: (s: "active" | "dismissed" | "retired" = "active") => ["research", "competitors", s] as const,
  ads: (q: ListResearchAdsQuery) => ["research", "ads", q] as const,
  ad: (id: string) => ["research", "ad", id] as const,
}
const POLL = 3000
const running = (s: string | null | undefined) => s === "QUEUED" || s === "RUNNING"

export function useResearchStatus({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: rk.status,
    queryFn: ({ signal }) => research.status({ signal }),
    staleTime: 15_000,
    retry: 1,
    enabled,
    refetchInterval: (q) => (running(q.state.data?.discovery.status) ? POLL : false),
  })
}

/** polls while the discovery is QUEUED/RUNNING; when it ends, the competitors and the grid are read again */
export function useDiscovery() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: rk.discovery,
    queryFn: async ({ signal }) => {
      const prev = qc.getQueryData<CompetitorDiscoveryView>(rk.discovery)
      const next = await research.discovery({ signal })
      if (prev && running(prev.last?.status) && !running(next.last?.status)) void qc.invalidateQueries({ queryKey: rk.all, predicate: (q) => q.queryKey[1] !== "discovery" })
      return next
    },
    refetchInterval: (q) => (running(q.state.data?.last?.status) ? POLL : false),
  })
}

const syncing = (c: Competitor) => running(c.sync?.status)
export function useCompetitors(status: "active" | "dismissed" | "retired" = "active", { enabled = true }: { enabled?: boolean } = {}) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: rk.competitors(status),
    queryFn: async ({ signal }) => {
      const prev = qc.getQueryData<{ items: Competitor[] }>(rk.competitors(status))
      const next = await research.competitors({ status }, { signal })
      // a collection finished → the grid has new ads
      if (prev?.items.some(syncing) && !next.items.some(syncing)) void qc.invalidateQueries({ queryKey: ["research", "ads"] })
      return next
    },
    enabled,
    refetchInterval: (q) => (q.state.data?.items.some(syncing) ? POLL : false),
  })
}

export function useResearchAds(q: ListResearchAdsQuery, { enabled = true }: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: rk.ads(q),
    queryFn: ({ pageParam, signal }) => research.ads({ ...q, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ResearchAdPage) => last.nextCursor,
    enabled,
    staleTime: 20_000,
  })
}

export function useResearchAd(id: string | null) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: rk.ad(id ?? ""),
    queryFn: async ({ signal }) => {
      const prev = qc.getQueryData<ResearchAdDetail>(rk.ad(id!))
      const next = await research.ad(id!, { signal })
      // the video finished loading → the cards in the grid changed too
      if (prev?.media.status === "refreshing" && next.media.status !== "refreshing") void qc.invalidateQueries({ queryKey: ["research", "ads"] })
      return next
    },
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.media.status === "refreshing" ? POLL : false),
  })
}

/** Save / unsave: the card flips at once in every cached page; the Saved tab and its count are read again. */
export function useSaveAd() {
  const qc = useQueryClient()
  const flip = (id: string, saved: boolean) => {
    qc.setQueriesData<{ pages: ResearchAdPage[]; pageParams: unknown[] }>({ queryKey: ["research", "ads"] }, (d) =>
      d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((a) => (a.id === id ? { ...a, saved } : a)) })) } : d
    )
    qc.setQueryData<ResearchAdDetail>(rk.ad(id), (d) => (d ? { ...d, saved } : d))
  }
  return useMutation({
    mutationFn: ({ ad, saved }: { ad: Pick<ResearchAdCard, "id">; saved: boolean }) => (saved ? research.save(ad.id).then(() => undefined) : research.unsave(ad.id)),
    onMutate: ({ ad, saved }) => flip(ad.id, saved),
    onError: (_e, { ad, saved }) => flip(ad.id, !saved),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["research", "ads"], predicate: (q) => (q.queryKey[2] as ListResearchAdsQuery | undefined)?.saved === true }),
  })
}

export function useDismissCompetitor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: DismissReason }) => research.dismiss(id, { reason }),
    onSettled: () => void qc.invalidateQueries({ queryKey: rk.all }),
  })
}

export function useRestoreCompetitor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => research.restore(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rk.all }),
  })
}

export function useRefreshCompetitor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => research.refresh(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rk.competitors("active") }),
  })
}

export function useDiscoverAgain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => research.discover(),
    onSuccess: (d) => {
      qc.setQueryData(rk.discovery, d)
      void qc.invalidateQueries({ queryKey: rk.status })
    },
  })
}

export function useLoadMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => research.loadMedia(id),
    onSuccess: (d) => qc.setQueryData(rk.ad(d.id), d),
  })
}
