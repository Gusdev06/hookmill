"use client"

import { useSyncExternalStore } from "react"

/**
 * Where toasts sit. Default: bottom, above the wizard action bar. The Final OK has no action bar and the
 * name/facts/buttons live at the bottom on mobile, so it moves toasts to the top (QA bug 05/10).
 */
type Pos = "bottom" | "top"
let pos: Pos = "bottom"
const subs = new Set<() => void>()
export function setToastPosition(p: Pos) {
  if (p === pos) return
  pos = p
  subs.forEach((s) => s())
}
export function useToastPosition() {
  return useSyncExternalStore(
    (s) => {
      subs.add(s)
      return () => subs.delete(s)
    },
    () => pos,
    () => "bottom" as Pos
  )
}
