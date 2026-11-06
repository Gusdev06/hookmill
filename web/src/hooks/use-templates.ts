"use client"

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import type { TemplateSourceRef } from "@/lib/api/types"
import { useSession } from "@/components/providers/session-provider"

/** Query keys of the template gallery and the credits (templates-creditos-v1 §7). */
export const tk = {
  list: (s: TemplateSourceRef | null) => ["ad-templates", "list", s ?? {}] as const,
  /** one slug = the fit of that template; 2+ = the selection's (templates-multi-v1 §3.2) */
  fits: (slugs: readonly string[], sources: TemplateSourceRef[]) => ["ad-templates", "fits", slugs.join(","), sources] as const,
  runs: ["ad-templates", "runs"] as const,
  credits: ["credits"] as const,
  ledger: ["credits", "ledger"] as const,
  admin: ["admin", "ad-templates"] as const,
}

export function useTemplateList(source: TemplateSourceRef | null, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: tk.list(source), queryFn: ({ signal }) => api.adTemplates.list(source ?? {}, { signal }), staleTime: 30_000, enabled })
}

/** Balance of the paying account. CLIENT gets 403 on /credits, so it isn't asked. Refreshed every minute and on focus. */
export function useCredits() {
  const { session } = useSession()
  return useQuery({
    queryKey: tk.credits,
    queryFn: ({ signal }) => api.credits.summary({ signal }),
    enabled: session.workspace.role !== "CLIENT",
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

export function useLedger() {
  return useInfiniteQuery({
    queryKey: tk.ledger,
    queryFn: ({ pageParam, signal }) => api.credits.ledger({ limit: 20, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

export function useTemplateRuns() {
  return useInfiniteQuery({
    queryKey: tk.runs,
    queryFn: ({ pageParam, signal }) => api.adTemplates.runs({ limit: 20, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}
