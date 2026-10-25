"use client"

import { useQuery } from "@tanstack/react-query"
import { useFormatter, useNow } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { MetaConnection, MetaPeriod } from "@/lib/api/types"

/* Query keys of the Meta connection and its readings (meta-v1 §3.1-3.2). */
export const mk = {
  connection: ["meta", "connection"] as const,
  oauthStatus: ["meta", "oauth-status"] as const,
  options: (adAccountId?: string | null) => ["meta", "options", adAccountId ?? ""] as const,
  summary: (period: MetaPeriod) => ["meta", "summary", period] as const,
  ads: (q: object) => ["meta", "ads", q] as const,
  campaigns: (q: object) => ["meta", "campaigns", q] as const,
  campaign: (id: string, period: MetaPeriod) => ["meta", "campaign", id, period] as const,
  changes: (scope: { level?: string; objectId?: string }) => ["meta", "changes", scope] as const,
}

/** 503 META_NOT_CONFIGURED { reason: 'off' | 'not_configured' }: the server has no Meta; the web hides every Meta surface. */
export const isMetaOff = (e: unknown) => isApiError(e) && e.code === "META_NOT_CONFIGURED"

/** GET /meta/connection: null = never connected. No retry on 503 (off) and no refetch storm. */
export function useMetaConnection(enabled = true) {
  return useQuery({
    queryKey: mk.connection,
    queryFn: ({ signal }) => api.meta.connection({ signal }),
    staleTime: 30_000,
    enabled,
    retry: (n, e) => n < 1 && !isMetaOff(e) && !(isApiError(e) && e.status < 500),
  })
}

export const metaActive = (c: MetaConnection | null | undefined): c is MetaConnection => !!c && c.status === "ACTIVE"
/** connected AND an ad account + Page chosen: Home, Pick from Meta and the tour can read ads */
export const metaReady = (c: MetaConnection | null | undefined): c is MetaConnection => metaActive(c) && !!c.adAccount && !!c.page

/** "4 min ago" that keeps itself current. */
export function useRelativeTime(intervalMs = 30_000) {
  const format = useFormatter()
  const now = useNow({ updateInterval: intervalMs })
  return (iso: string | null | undefined) => (iso ? format.relativeTime(new Date(iso), now) : "")
}

/** Money in the account's currency (falls back to USD before the first sync). */
export function useMoney(currency: string | null | undefined) {
  const format = useFormatter()
  const cur = currency || "USD"
  return (v: number | null | undefined, digits = 2) =>
    v === null || v === undefined ? "—" : format.number(v, { style: "currency", currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits })
}
