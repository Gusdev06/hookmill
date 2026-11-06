"use client"

import { useCallback, useSyncExternalStore } from "react"

/*
 * FALLBACK client-side memory of the Eddy setup, per workspace (localStorage). Since 31/10 the API says what the person
 * confirmed (`ws.onboarding.confirmed`, PATCH /workspace { confirm }; lacunas-home-eddy-v1 §1) and "Meta / kit skipped"
 * are derived from it, so this only covers an older API or a PATCH that failed, plus the reading job still running.
 * Versioned key, small payload (client-localstorage-schema).
 */
export type EddyConfirm = "business" | "offer" | "meta" | "goals" | "kit"

export interface EddyReading {
  jobId: string
  /** the URL read; null when the person described the business in text */
  url: string | null
  /** what the person typed (the bubble) */
  said: string
  applied?: boolean
}

export interface EddyLocal {
  v: 1
  confirmed: EddyConfirm[]
  read: EddyReading | null
  /** no site / reading failed → fill the cards by hand */
  manual?: boolean
  metaSkipped?: boolean
  kitSkipped?: boolean
}

const EMPTY: EddyLocal = { v: 1, confirmed: [], read: null }
const keyOf = (ws: string) => `eddy:onboarding:v1:${ws}`
const listeners = new Set<() => void>()
const cache = new Map<string, { raw: string | null; val: EddyLocal }>()

function read(ws: string): EddyLocal {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(keyOf(ws))
  } catch {}
  const hit = cache.get(ws)
  if (hit && hit.raw === raw) return hit.val
  let val = EMPTY
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<EddyLocal>
      if (p && p.v === 1) val = { ...EMPTY, ...p, confirmed: Array.isArray(p.confirmed) ? p.confirmed : [] }
    } catch {}
  }
  cache.set(ws, { raw, val })
  return val
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("eddy:onboarding:")) cb()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener("storage", onStorage)
  }
}

export function useEddyLocal(ws: string) {
  const state = useSyncExternalStore(subscribe, () => read(ws), () => EMPTY)
  const update = useCallback(
    (fn: (s: EddyLocal) => EddyLocal) => {
      const next = fn(read(ws))
      try {
        localStorage.setItem(keyOf(ws), JSON.stringify(next))
      } catch {}
      listeners.forEach((l) => l())
    },
    [ws]
  )
  const confirm = useCallback((c: EddyConfirm, extra: Partial<EddyLocal> = {}) => update((s) => ({ ...s, ...extra, confirmed: s.confirmed.includes(c) ? s.confirmed : [...s.confirmed, c] })), [update])
  return { local: state, update, confirm }
}
