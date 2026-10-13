"use client"

import { createContext, useContext, type RefObject } from "react"
import type { useTranslations } from "next-intl"
import type { PlayerRef } from "@remotion/player"
import type { CriativoProps, MetadadosPlayer } from "@maquina/video/player"
import type { CreativeDetail, EditClip, EditDocLayer, EditSettings, EditorState, LayerStyle, ScratchSource } from "@/lib/api/types"
import type { LayerKey, LayerView, LineView, Placed, Platform, Sel, WordView } from "./model"
import type { EditorSession, Work } from "./use-editor"

export interface Ui {
  zoom: number
  snap: boolean
  safe: boolean
  plat: Platform
  help: boolean
  /** phone: which sheet tab is open (text | style | words | mob), null = closed */
  sheet: string | null
  /** key of the word being fixed */
  editWord: string | null
  dragging: boolean
}

export interface Actions {
  layer: (key: LayerKey, label: string, patch: Omit<Partial<EditDocLayer>, "style"> & { style?: Partial<LayerStyle> | null }) => void
  layerLive: (key: LayerKey, patch: Omit<Partial<EditDocLayer>, "style"> & { style?: Partial<LayerStyle> | null }) => void
  typingLayer: (field: string, key: LayerKey, label: string, patch: Omit<Partial<EditDocLayer>, "style"> & { style?: Partial<LayerStyle> | null }) => void
  settings: (label: string, patch: Partial<EditSettings>) => void
  typingSettings: (field: string, label: string, patch: Partial<EditSettings>) => void
  clips: (label: string, clips: EditClip[]) => void
  clipsLive: (clips: EditClip[]) => void
  begin: (label: string) => void
  live: (fn: (w: Work) => Work) => void
  timing: (key: LayerKey) => { fromSec: number; durationSec: number }
  trimTo: (side: "l" | "r") => void
  moveScene: (d: -1 | 1) => void
  reorder: (sceneId: string, toPos: number) => void
  deleteScene: () => void
  restoreScene: (sceneId: string) => void
  restoreAll: () => void
  fixWord: (w: WordView, text: string) => void
  hideWord: (w: WordView) => void
  resetWord: (w: WordView) => void
  hideLayer: (key: LayerKey) => void
  resetStyle: (key: LayerKey) => void
  autoTime: (key: LayerKey) => void
  exportNow: () => void
  undo: () => void
  redo: () => void
  endTyping: () => void
}

export interface Ed {
  id: string
  creative: CreativeDetail
  s: EditorSession
  st: EditorState
  src: ScratchSource
  work: Work
  props: CriativoProps
  meta: MetadadosPlayer
  clips: EditClip[]
  placed: Placed[]
  cenasSec: number
  totalSec: number
  layers: Record<LayerKey, LayerView>
  lines: LineView[]
  sel: Sel
  select: (sel: Sel, move?: boolean) => void
  time: number
  seek: (sec: number) => void
  playing: boolean
  togglePlay: () => void
  phone: boolean
  ui: Ui
  setUi: (p: Partial<Ui>) => void
  t: ReturnType<typeof useTranslations<"editor">>
  notify: (msg: string, undo?: boolean, id?: string) => void
  /** readable text of an EditDocRule (rule.<code>) */
  ruleText: (rule: string) => string
  act: Actions
  playerRef: RefObject<PlayerRef | null>
  lname: (k: LayerKey | "end" | "scene") => string
  sec: (v: number, digits?: number) => string
  /** last export blocked the OK final (§5.3) */
  canContinue: boolean
}

export const EdCtx = createContext<Ed | null>(null)
export function useEd() {
  const v = useContext(EdCtx)
  if (!v) throw new Error("useEd outside the editor")
  return v
}
