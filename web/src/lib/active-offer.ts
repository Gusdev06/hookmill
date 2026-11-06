"use client"

import { useCallback, useSyncExternalStore } from "react"

/*
 * meta-oferta-v1 §8 (D10): the "active offer" is web-only state in v1, one per workspace, in localStorage as
 * `hm.activeOffer.<workspaceId>`. Written whenever the person picks an offer (Iterate, Templates, Campaigns).
 * Resolution: the one picked on the screen → the stored one (if it still exists, i.e. is in the active list) →
 * the only active offer → `defaultOfferId` (GET /iterate/config, where the screen has it) → none (no `offerId`).
 */
type OfferLike = { id: string; name: string }

const PREFIX = "hm.activeOffer."
const EVENT = "hm:active-offer"
const keyOf = (workspaceId: string) => PREFIX + workspaceId

export function readActiveOffer(workspaceId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(keyOf(workspaceId))
  } catch {
    return null
  }
}

export function writeActiveOffer(workspaceId: string, offerId: string | null) {
  if (typeof window === "undefined") return
  try {
    if (offerId) localStorage.setItem(keyOf(workspaceId), offerId)
    else localStorage.removeItem(keyOf(workspaceId))
  } catch {
    return
  }
  window.dispatchEvent(new Event(EVENT))
}

/** pure: the §8 order (1 is the stored one too, since picking writes it) */
export function resolveActiveOffer(o: { stored: string | null; offers: OfferLike[] | undefined; defaultOfferId?: string | null }): string | null {
  const list = o.offers ?? []
  if (o.stored && list.some((x) => x.id === o.stored)) return o.stored
  if (list.length === 1) return list[0].id
  if (o.defaultOfferId && list.some((x) => x.id === o.defaultOfferId)) return o.defaultOfferId
  return null
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(PREFIX)) cb()
  }
  window.addEventListener(EVENT, cb)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener("storage", onStorage)
  }
}

/**
 * The active offer of this workspace among `offers` (undefined while they load = null).
 * `setOfferId` stores it (every screen with a selector sees the change, other tabs too).
 */
export function useActiveOffer(workspaceId: string, offers: OfferLike[] | undefined, defaultOfferId?: string | null) {
  const stored = useSyncExternalStore(subscribe, () => readActiveOffer(workspaceId), () => null)
  const offerId = resolveActiveOffer({ stored, offers, defaultOfferId })
  const offer = offerId ? (offers?.find((x) => x.id === offerId) ?? null) : null
  const setOfferId = useCallback((id: string | null) => writeActiveOffer(workspaceId, id), [workspaceId])
  return { offerId, offer, setOfferId }
}
