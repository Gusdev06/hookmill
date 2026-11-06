/**
 * MSW model of meta-oferta-v1 (docs/contratos/meta-oferta-v1.md §3-§5): which offer each mock ad is from, computed on
 * read like the API (never stored on the row). Seeds cover the 3 groups against "Orbit Budget" (of_orbit): link exact /
 * prefix, HookMill, name (lead form), domain, another offer's link (Quiet Mind, Brightside), foreign link, Kiwify product
 * of someone else, post without link, link still pending. Corrections (PUT/DELETE /meta/offer-links) live in localStorage
 * `mock:offerLinks` per workspace and survive reloads. `?metamock=posts` = an account of posts only (no readable link).
 */
import type {
  MetaAdOfferInfo, MetaAdRow, MetaAdVerdict, MetaDestinationSource, MetaOfferCounts, MetaOfferDecision, MetaOfferFit, MetaOfferLinkLevel,
  MetaOfferListMeta, MetaOfferMatch, MetaOfferNoneReason,
} from "@/lib/api/types"
import { db } from "./db"
import { metaFlag } from "./v2"

type Seed = { offerId: string | null; match: MetaOfferMatch; url: string | null; source: MetaDestinationSource | null; none?: MetaOfferNoneReason }
const SEEDS: Record<string, Seed> = {
  ad_1: { offerId: "of_orbit", match: "link", url: "https://orbitbudget.app/?utm_source=fb", source: "video_cta" },
  ad_2: { offerId: "of_orbit", match: "link", url: "https://orbitbudget.app/trial/step-2", source: "video_cta" },
  ad_3: { offerId: "of_quiet", match: "link", url: "https://quietmind21.com/start", source: "video_cta" },
  ad_4: { offerId: null, match: "none", url: "https://sleepmaskco.com/flashlight", source: "video_cta", none: "foreign_link" },
  ad_5: { offerId: null, match: "none", url: null, source: "existing_post", none: "no_link" },
  ad_6: { offerId: "of_orbit", match: "hookmill", url: "https://orbitbudget.app", source: "video_cta" },
  ad_7: { offerId: null, match: "none", url: "https://pay.kiwify.com.br/Zz99", source: "video_cta", none: "foreign_link" },
  mock_ad_img_1: { offerId: "of_orbit", match: "name", url: null, source: "lead_form" },
  mock_ad_8: { offerId: null, match: "none", url: null, source: null, none: "link_pending" },
  mock_ad_9: { offerId: "of_bright", match: "domain", url: "https://shop.brightsidekit.com/routine", source: "story_link" },
  mock_ad_10: { offerId: null, match: "none", url: "https://evergreen-sleep.com/7-nights", source: "video_cta", none: "foreign_link" },
  mock_ad_hm_1: { offerId: "of_orbit", match: "hookmill", url: "https://orbitbudget.app", source: "video_cta" },
  mock_ad_img_2: { offerId: null, match: "none", url: null, source: "messaging", none: "no_link" },
}
const HIGH: MetaOfferMatch[] = ["manual", "manual_campaign", "hookmill", "champion", "link"]

// ───── corrections (meta_offer_links)
export type OfferLink = { level: MetaOfferLinkLevel; objectId: string; offerId: string; decision: MetaOfferDecision }
const KEY = "mock:offerLinks"
function all(): Record<string, OfferLink[]> {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, OfferLink[]>
  } catch {
    return {}
  }
}
export const linksOf = (wsId: string) => all()[wsId] ?? []
export function setLinks(wsId: string, list: OfferLink[]) {
  const a = all()
  a[wsId] = list
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(a))
}

export const offerExists = (id: string) => db.offers.some((o) => o.id === id)
const offerName = (id: string | null) => (id ? (db.offers.find((o) => o.id === id)?.name ?? null) : null)
const offerHasUrl = (id: string) => !!db.offers.find((o) => o.id === id)?.sourceUrl
const hostOf = (url: string | null) => {
  if (!url) return null
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return null
  }
}

/** §3.5-§3.6 for one ad. `offerId` = the requested offer (null = no `?offerId`, `fit` null). */
export function offerInfoOf(ad: { metaAdId: string; campaignId: string }, offerId: string | null, wsId: string, canEdit: boolean): MetaAdOfferInfo & { _source: MetaDestinationSource | null } {
  const links = linksOf(wsId)
  const posts = metaFlag() === "posts"
  const seed0 = SEEDS[ad.metaAdId] ?? { offerId: null, match: "none", url: null, source: "none", none: "no_link" }
  const seed: Seed = posts
    ? { ...seed0, url: null, source: "existing_post", ...(seed0.match === "link" || seed0.match === "domain" || seed0.none === "foreign_link" ? { offerId: null, match: "none" as const, none: "no_link" as const } : {}) }
    : seed0
  const mine = (level: MetaOfferLinkLevel) => links.filter((l) => l.level === level && l.objectId === (level === "AD" ? ad.metaAdId : ad.campaignId))
  const excluded = new Set([...mine("AD"), ...mine("CAMPAIGN")].filter((l) => l.decision === "NOT_BELONGS").map((l) => l.offerId))
  let assigned: string | null = null
  let match: MetaOfferMatch = "none"
  let none: MetaOfferNoneReason | null = null
  const adBel = mine("AD").find((l) => l.decision === "BELONGS" && !excluded.has(l.offerId))
  const campBel = mine("CAMPAIGN").find((l) => l.decision === "BELONGS" && !excluded.has(l.offerId))
  if (adBel) [assigned, match] = [adBel.offerId, "manual"]
  else if (campBel) [assigned, match] = [campBel.offerId, "manual_campaign"]
  else if (seed.offerId && !excluded.has(seed.offerId)) [assigned, match] = [seed.offerId, seed.match]
  else none = seed.offerId ? "excluded" : (seed.none ?? "no_link")
  let fit: MetaOfferFit | null = null
  if (offerId) {
    if (assigned === offerId) fit = "this"
    else if (assigned || excluded.has(offerId)) fit = "other"
    else if (none === "foreign_link") fit = offerHasUrl(offerId) ? "other" : "unknown"
    else fit = "unknown"
    if (!assigned && none === "foreign_link" && !offerHasUrl(offerId)) none = "offer_has_no_url"
  }
  const forX = offerId ? (mine("AD").find((l) => l.offerId === offerId) ?? mine("CAMPAIGN").find((l) => l.offerId === offerId)) : undefined
  return {
    fit, offerId: assigned, offerName: offerName(assigned), match,
    confidence: match === "none" ? null : HIGH.includes(match) ? "high" : "low",
    noneReason: assigned ? null : none,
    destinationUrl: seed.url, destinationHost: hostOf(seed.url), linkPending: seed.source === null,
    manual: forX ? { level: forX.level, decision: forX.decision } : null,
    canEdit,
    _source: seed.source,
  }
}

const RANK: Record<MetaOfferFit, number> = { this: 0, unknown: 1, other: 2 }
/** stable: the group first, the order of before inside it */
export const byGroup = <T,>(rows: T[], fitOf: (r: T) => MetaOfferFit | null | undefined) =>
  rows.map((r, i) => [r, i] as const).sort((a, b) => RANK[fitOf(a[0]) ?? "unknown"] - RANK[fitOf(b[0]) ?? "unknown"] || a[1] - b[1]).map(([r]) => r)

type Decorated<T> = T & { offer: MetaAdOfferInfo }
/** puts `offer` on every row (and recalculates WINNER inside the offer with ≥ 3 eligible, §4.3); returns the list meta */
export function decorateAds<T extends MetaAdRow>(rows: T[], offerId: string | null, wsId: string, canEdit: boolean, campaignOf: (adId: string) => string | undefined): { rows: Decorated<T>[]; meta: MetaOfferListMeta | null } {
  const src = new Map<string, MetaDestinationSource | null>()
  let out = rows.map((r) => {
    const { _source, ...offer } = offerInfoOf({ metaAdId: r.metaAdId, campaignId: campaignOf(r.metaAdId) ?? r.campaign.id }, offerId, wsId, canEdit)
    src.set(r.metaAdId, _source)
    return { ...r, offer }
  })
  if (!offerId) return { rows: out, meta: null }
  const elig = out.filter((r) => r.offer.fit === "this" && r.verdict !== "LOW_DATA" && r.metrics.cpa != null)
  let verdictScope: MetaOfferListMeta["verdictScope"] = "account"
  let medianCpa: number | null = null
  if (elig.length >= 3) {
    const cpas = elig.map((r) => r.metrics.cpa!).sort((a, b) => a - b)
    medianCpa = cpas[Math.floor((cpas.length - 1) / 2)]
    verdictScope = "offer"
    out = out.map((r) => (r.offer.fit === "this" && r.verdict !== "LOW_DATA" && r.metrics.cpa != null ? { ...r, verdict: (r.metrics.cpa <= medianCpa! ? "WINNER" : "OK") as MetaAdVerdict } : r))
  }
  const s = (r: MetaAdRow) => src.get(r.metaAdId)
  return {
    rows: out,
    meta: {
      offerId, counts: countsOf(out.map((r) => r.offer.fit)), verdictScope, medianCpa,
      links: { read: out.filter((r) => !!r.offer.destinationUrl).length, pending: out.filter((r) => s(r) === null).length, unreadable: out.filter((r) => !r.offer.destinationUrl && s(r) !== null).length },
      offerHasUrl: offerHasUrl(offerId),
    },
  }
}
export const countsOf = (fits: (MetaOfferFit | null)[]): MetaOfferCounts => ({ this: fits.filter((f) => f === "this").length, unknown: fits.filter((f) => f === "unknown").length, other: fits.filter((f) => f === "other").length })
/** §4.2: a campaign is `this` with ≥ 1 ad this, `other` when all its ads are other, `unknown` otherwise */
export const campaignFit = (mix: MetaOfferCounts): MetaOfferFit => (mix.this > 0 ? "this" : mix.other > 0 && mix.unknown === 0 ? "other" : "unknown")

/** §4.1 query checks shared by /meta/ads and /meta/campaigns: a Response on error, else the offer + scope */
export function offerQuery(sp: URLSearchParams): { offerId: string | null; scope: MetaOfferFit | null } | { error: "requires_offer" | "offer_not_found" } {
  const offerId = sp.get("offerId")
  const sc = sp.get("offerScope")
  if (sc && !offerId) return { error: "requires_offer" }
  if (offerId && !offerExists(offerId)) return { error: "offer_not_found" }
  return { offerId, scope: sc === "this" || sc === "unknown" || sc === "other" ? sc : null }
}
