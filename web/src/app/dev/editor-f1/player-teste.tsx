"use client"

import { useEffect, useRef } from "react"
import { Player, type PlayerRef } from "@remotion/player"
import {
  Criativo,
  aplicarDoc,
  carregarFontes,
  metadadosCriativo,
  type CriativoProps,
  type EditDoc,
  type MetadadosPlayer,
} from "@maquina/video/player"
import fixtures from "@maquina/video/scripts/editor-f1/player-fixtures.json"

// Contract with video/scripts/editor-f1/player-prints.mjs: window.meta + window.irPara(frame) -> Promise<frame>,
// Player at real size (1080×1920 CSS px), no controls, page without margin.
declare global {
  interface Window {
    meta?: MetadadosPlayer
    irPara?: (frame: number) => Promise<number>
  }
}

type Fixtures = { docs: Record<string, EditDoc | null> } & Record<string, unknown>
const fx = fixtures as unknown as Fixtures

const q = new URLSearchParams(window.location.search)
const nomeBase = q.get("base") ?? "basePreto"
const nomeDoc = q.get("doc") ?? "doc-nulo"
const base = fx[nomeBase] as CriativoProps | undefined
const doc = fx.docs[nomeDoc]
const inputProps = base ? aplicarDoc(base, doc) : null
const meta = inputProps ? metadadosCriativo(inputProps) : null

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export default function PlayerTeste() {
  const ref = useRef<PlayerRef>(null)

  useEffect(() => {
    if (!meta) return
    window.meta = meta
    window.irPara = async (frame: number) => {
      await carregarFontes()
      await document.fonts.ready
      const player = ref.current
      if (!player) throw new Error("player not mounted")
      player.seekTo(frame)
      await espera(200)
      for (let i = 0; i < 100; i++) {
        const videos = [...document.querySelectorAll("video")]
        if (videos.every((v) => !v.seeking && v.readyState >= 2)) break
        await espera(100)
      }
      await espera(400)
      return player.getCurrentFrame()
    }
    return () => {
      delete window.meta
      delete window.irPara
    }
  }, [])

  if (!inputProps || !meta || doc === undefined) {
    return (
      <pre style={{ color: "#fff", padding: 16 }}>
        unknown fixture: base={nomeBase} doc={nomeDoc}. bases: base, basePreto · docs: {Object.keys(fx.docs).join(", ")}
      </pre>
    )
  }

  return (
    <div style={{ position: "fixed", inset: 0, margin: 0, overflow: "hidden", background: "#000" }}>
      {/* Next dev indicator would land inside the screenshot. */}
      <style>{"nextjs-portal{display:none!important}"}</style>
      <Player
        ref={ref}
        component={Criativo}
        inputProps={inputProps}
        {...meta}
        style={{ width: meta.compositionWidth, height: meta.compositionHeight }}
        acknowledgeRemotionLicense
      />
    </div>
  )
}
