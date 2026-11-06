"use client"

import { http } from "./client"
import type * as T from "./types"

/**
 * Ad Radar (docs/contratos/ads-research-v1.md §7 + "Construção 04/11"). The API keeps the internal name `/research/*`.
 * Arrays in `GET /research/ads` go as a repeated parameter (`?format=VIDEO&format=DCO`).
 */
type Signal = { signal?: AbortSignal }
const { get, post, patch, put, del, data, seg } = http

function adsQuery(q: T.ListResearchAdsQuery) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)))
    else p.set(k, String(v))
  }
  return p
}

export const research = {
  status: (o: Signal = {}) => data(get<T.ResearchStatus>("/research/status", o)),
  discovery: (o: Signal = {}) => data(get<T.CompetitorDiscoveryView>("/research/discovery", o)),
  /** "Search again" (1× every 7 days). 409 discovery_running / brain_incomplete · 429 RATE_LIMITED · 409 SPEND_CAP_EXCEEDED (scope research) · 402 research_tier · 503 */
  discover: () => data(post<T.CompetitorDiscoveryView>("/research/discovery")),
  competitors: (q: T.ListCompetitorsQuery = {}, o: Signal = {}) => data(get<{ items: T.Competitor[] }>("/research/competitors", { query: q, ...o })),
  rename: (id: string, b: T.UpdateCompetitorBody) => data(patch<T.Competitor>(`/research/competitors/${seg(id)}`, b)),
  /** the spot is filled right away by the first one in reserve (`replacement`, or null) */
  dismiss: (id: string, b: T.DismissCompetitorBody) => data(post<T.DismissCompetitorResponse>(`/research/competitors/${seg(id)}/dismiss`, b)),
  /** 409 competitor_limit when there is no free spot */
  restore: (id: string) => data(post<T.Competitor>(`/research/competitors/${seg(id)}/restore`)),
  refresh: (id: string) => data(post<T.Competitor>(`/research/competitors/${seg(id)}/refresh`)),
  ads: (q: T.ListResearchAdsQuery = {}, o: Signal = {}) => data(get<T.ResearchAdPage>("/research/ads", { query: adsQuery(q), ...o })),
  ad: (id: string, o: Signal = {}) => data(get<T.ResearchAdDetail>(`/research/ads/${seg(id)}`, o)),
  /** 202, `media.status = 'refreshing'`; poll `ad(id)` */
  loadMedia: (id: string) => data(post<T.ResearchAdDetail>(`/research/ads/${seg(id)}/media`)),
  save: (id: string, b: T.SaveResearchAdBody = {}) => data(put<T.ResearchAdCard>(`/research/ads/${seg(id)}/save`, b)),
  unsave: (id: string) => data(del<void>(`/research/ads/${seg(id)}/save`)),
}
