"use client"

import { createContext, useContext, type RefObject } from "react"
import type { useTranslations } from "next-intl"
import type { PlayerRef } from "@remotion/player"
import type { EditDocV3, EditIssue, EditorStateV3, FormatCode, LayerDecl } from "@/lib/api/types"
import type { Resolved } from "./model"
import type { UniversalSession } from "./use-universal"

export type Tab = "tpl" | "lyr"
export interface U {
  id: string
  s: UniversalSession
  st: EditorStateV3
  doc: EditDocV3
  fmt: FormatCode
  setFmt: (f: FormatCode) => void
  principal: FormatCode
  r: Resolved | null
  issues: EditIssue[]
  /** checks of the principal format (what the Export waits on) */
  exportIssues: EditIssue[]
  sel: string | null
  select: (id: string | null, toLayerTab?: boolean) => void
  tab: Tab
  setTab: (t: Tab) => void
  time: number
  seek: (sec: number) => void
  playing: boolean
  togglePlay: () => void
  playerRef: RefObject<PlayerRef | null>
  /** < 900 px: chips, no handles, positions through fields (D4 revised) */
  phone: boolean
  guides: boolean
  setGuides: (v: boolean) => void
  /** read-only (published) or an export running */
  ro: boolean
  /** double-click on your video: dragging moves the picture inside its box (always false on phones) */
  reframing: boolean
  setReframing: (v: boolean) => void
  /** your video before any trim: the scale of the timeline and the limits of the trim */
  videoFull: { inSec: number; outSec: number; durationSec: number } | null
  decl: (id: string) => LayerDecl | undefined
  label: (id: string) => string
  userId: string
  t: ReturnType<typeof useTranslations<"editorU">>
}
export const UCtx = createContext<U | null>(null)
export function useU() {
  const v = useContext(UCtx)
  if (!v) throw new Error("useU outside the universal editor")
  return v
}
