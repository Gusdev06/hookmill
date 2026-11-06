"use client"

import { useQuery } from "@tanstack/react-query"
import { api } from "./client"
import { isApiError } from "./errors"

/*
 * meta-templates-v2 §4: the three lists the template editor reads from the selected ad account / Page.
 * Keyed by ad account, so switching accounts never shows the other account's lists. CLIENT doesn't call them (the editor
 * is read-only and shows the names saved in the template). No retry on 4xx (not connected, permission, token).
 */
const noRetry4xx = (n: number, e: unknown) => n < 1 && !(isApiError(e) && e.status < 500)

export const lk = {
  instagram: (acc: string | null) => ["meta", "lists", "instagram", acc ?? ""] as const,
  audiences: (acc: string | null) => ["meta", "lists", "audiences", acc ?? ""] as const,
  locales: ["meta", "lists", "locales"] as const,
}

export function useInstagramAccounts(adAccountId: string | null, enabled = true) {
  return useQuery({
    queryKey: lk.instagram(adAccountId),
    queryFn: ({ signal }) => api.meta.instagramAccounts({ signal }),
    enabled: enabled && !!adAccountId,
    staleTime: 60_000,
    retry: noRetry4xx,
  })
}

export function useCustomAudiences(adAccountId: string | null, enabled = true) {
  return useQuery({
    queryKey: lk.audiences(adAccountId),
    queryFn: ({ signal }) => api.meta.customAudiences({ signal }),
    enabled: enabled && !!adAccountId,
    // the API caches 5 min per account
    staleTime: 5 * 60_000,
    retry: noRetry4xx,
  })
}

export function useMetaLocales(enabled = true) {
  return useQuery({
    queryKey: lk.locales,
    queryFn: ({ signal }) => api.meta.locales({ signal }),
    enabled,
    // the API caches 24 h; same list for every workspace
    staleTime: 60 * 60_000,
    retry: noRetry4xx,
  })
}
