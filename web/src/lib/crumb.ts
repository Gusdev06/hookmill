"use client"

import { useSyncExternalStore } from "react"

/** Current creative name for the header breadcrumb (set by the wizard). */
let crumb: string | null = null
const subs = new Set<() => void>()
export function setCrumb(v: string | null) {
  if (v === crumb) return
  crumb = v
  subs.forEach((s) => s())
}
export function useCrumb() {
  return useSyncExternalStore(
    (s) => {
      subs.add(s)
      return () => subs.delete(s)
    },
    () => crumb,
    () => null
  )
}
