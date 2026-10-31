"use client"

import "./editor.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl"
import { toast } from "sonner"
import type { PlayerRef } from "@remotion/player"
import { metadadosCriativo, resolverProps } from "@maquina/video/player"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { CreativeDetail, EditClip } from "@/lib/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { qk, useCreative, useCreativeEvents } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { stepHref } from "@/components/wizard/shell"
import { cn } from "@/lib/utils"
import { EdCtx, useEd, type Actions, type Ed, type Ui } from "./context"
import { EdIcon, type EdIconName } from "./ed-icon"
import {
  FPS, MIN_CLIP_SEC, clamp, deleteBlock, fixWordEverywhere, minClipFor, fullClips, layerViews, patchLayer, placeScenes, setWord, toFrame, transcript, withClips,
  type LayerKey, type Sel,
} from "./model"
import { useEditorSession, useIsPhone, type SessionToast } from "./use-editor"
import { Stage } from "./stage"
import { Timeline } from "./timeline"
import { Panel, Sheet, Dock } from "./panel"

/** /creatives/:id/editor (editor-v1 §10 F2c). Client-only (the Player needs the browser). */
export function EditorScreen({ id }: { id: string }) {
  const t = useTranslations("editor")
  const errorMessage = useErrorMessage()
  const q = useCreative(id)
  useCreativeEvents(q.data ? id : null)
  const c = q.data
  // F3: the variation that keeps the winner's edit opens the editor later (remix-keep)
  const remix = c?.editSettings?.templateId === "remix-keep"

  if (q.isError) return <Gate icon="alert" title={t("gate.loadError")} body={errorMessage(q.error)} back="/" />
  if (!c) return <Skeleton />
  if (remix) return <Gate icon="lock" title={t("gate.remixTitle")} body={t("lock.remix_editor_not_enabled")} back={stepHref(id, "edit")} />
  return <EditorLoader creative={c} />
}

function Gate({ icon, title, body, back, action }: { icon: EdIconName; title: string; body: React.ReactNode; back: string; action?: React.ReactNode }) {
  const t = useTranslations("editor")
  return (
    <div className="on-ink ed-app grid place-items-center p-6">
      <div className="grid max-w-[440px] justify-items-start gap-3 rounded-xl border border-line bg-surface p-6">
        <EdIcon name={icon} className="text-fg-2" />
        <h1 className="text-[18px]">{title}</h1>
        <p className="text-[13px] text-fg-2">{body}</p>
        <div className="flex flex-wrap gap-2">
          <Link href={back} className={buttonVariants({ variant: "default", size: "sm" })}>
            <EdIcon name="back" />
            {t("gate.back")}
          </Link>
          {action}
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="on-ink ed-app" role="status" aria-label="…">
      <div className="ed">
        <header className="ed-top">
          <span className="sk h-6 w-48" />
        </header>
        <div className="grid place-items-center p-6">
          <span className="sk aspect-[9/16] h-[min(60dvh,480px)] rounded" />
        </div>
        <div className="grid gap-2 border-t border-line p-3">
          {[58, 34, 34, 34].map((h, i) => (
            <span key={i} className="sk w-full" style={{ height: h }} />
          ))}
        </div>
        <span />
      </div>
    </div>
  )
}

function EditorLoader({ creative }: { creative: CreativeDetail }) {
  const t = useTranslations("editor")
  const errorMessage = useErrorMessage()
  const undoRef = useRef<() => void>(() => {})
  const notify = useCallback((m: SessionToast) => {
    const rule = m.values?.rule
    const values = rule !== undefined ? { ...m.values, rule: t.has(`rule.${rule}` as never) ? t(`rule.${rule}` as never) : String(rule) } : m.values
    toast(t(m.key as never, values as never), {
      id: m.id,
      duration: m.undo ? 8000 : undefined,
      action: m.undo ? { label: t("undo"), onClick: () => undoRef.current() } : undefined,
    })
  }, [t])
  const s = useEditorSession(creative.id, notify)
  useEffect(() => {
    undoRef.current = () => void s.undo()
  })
  const back = stepHref(creative.id, "edit")
  if (s.q.isError) {
    const e = s.q.error
    if (isApiError(e) && e.code === "EDIT_NOT_SUPPORTED") {
      const reason = String((e.details as { reason?: string } | undefined)?.reason ?? "")
      const body = t.has(`lock.${reason}` as never) ? t(`lock.${reason}` as never) : errorMessage(e)
      return <Gate icon="lock" title={t("gate.remixTitle")} body={body} back={back} />
    }
    if (isApiError(e) && e.status === 409) return <Gate icon="info" title={t("gate.notReadyTitle")} body={t("gate.notReadyBody")} back={back} />
    if (isApiError(e) && e.status === 404) return <Gate icon="alert" title={t("gate.notFound")} body={errorMessage(e)} back="/" />
    return <Gate icon="alert" title={t("gate.loadError")} body={errorMessage(e)} back={back} action={<Button size="sm" onClick={() => s.q.refetch()}>{t("retry")}</Button>} />
  }
  if (!s.state || !s.work) return <Skeleton />
  if (s.state.base !== "scratch") return <Gate icon="lock" title={t("gate.remixTitle")} body={t("lock.remix_editor_not_enabled")} back={back} />
  return <Editor creative={creative} s={s} />
}

const DEFAULT_UI: Ui = { zoom: 40, snap: true, safe: true, plat: "reels", help: false, sheet: null, editWord: null, dragging: false }

function Editor({ creative, s }: { creative: CreativeDetail; s: ReturnType<typeof useEditorSession> }) {
  const t = useTranslations("editor")
  const locale = useLocale()
  const router = useRouter()
  const phone = useIsPhone()
  const id = creative.id
  const st = s.state!
  const work = s.work!
  const src = st.source as Extract<typeof st.source, { scenes: unknown }>
  const playerRef = useRef<PlayerRef | null>(null)
  const [ui, setUiState] = useState<Ui>(DEFAULT_UI)
  const setUi = useCallback((p: Partial<Ui>) => setUiState((u) => ({ ...u, ...p })), [])
  const [sel, setSel] = useState<Sel>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const scenesQ = useQuery({ queryKey: qk.scenes(id), queryFn: () => api.scenes.list(id), staleTime: 60_000 })

  // ── derived: the SAME resolverProps the API renders with (editor-v1 §0.2)
  const props = useMemo(() => resolverProps(src, work.settings, work.doc), [src, work])
  const meta = useMemo(() => metadadosCriativo(props), [props])
  const clips = useMemo(() => fullClips(src, work.doc), [src, work.doc])
  const placed = useMemo(() => placeScenes(src, clips), [src, clips])
  const cenasSec = placed.length ? placed[placed.length - 1].end : 0
  const totalSec = meta.durationInFrames / FPS
  const layers = useMemo(() => layerViews(work.doc, work.settings, src, cenasSec)!, [work, src, cenasSec])
  const speech = useMemo(() => new Map((scenesQ.data?.scenes ?? []).map((x) => [x.id, x.speech])), [scenesQ.data])
  const lines = useMemo(() => transcript(src, work.doc, placed, speech), [src, work.doc, placed, speech])
  const time = frame / FPS

  const sec = useCallback((v: number, d = 1) => `${(Math.round(v * 10 ** d) / 10 ** d).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })} s`, [locale])
  // layer names come from the API (EditorLayerInfo.labelKey = "editor.layer.<id>"); end card/scene are UI-only
  const lname = useCallback((k: LayerKey | "end" | "scene") => {
    const key = (st.layers.find((l) => l.id === k)?.labelKey ?? `editor.layer.${k}`).replace(/^editor\./, "")
    return t.has(key as never) ? t(key as never) : t(`layer.${k}`)
  }, [t, st.layers])

  const seek = useCallback((sec: number) => {
    const f = clamp(Math.round(sec * FPS), 0, Math.max(0, meta.durationInFrames - 1))
    playerRef.current?.seekTo(f)
    setFrame(f)
  }, [meta.durationInFrames])
  const togglePlay = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (p.isPlaying()) p.pause()
    else {
      if (p.getCurrentFrame() >= meta.durationInFrames - 2) p.seekTo(0)
      p.play()
    }
  }, [meta.durationInFrames])

  const range = useCallback((x: Sel): [number, number] | null => {
    if (!x) return null
    if (x.k === "scene") {
      const p = placed.find((pp) => pp.scene.sceneId === x.id)
      return p ? [p.start, p.end] : null
    }
    if (x.k === "end") return work.settings.endCard ? [cenasSec, totalSec] : null
    const l = layers[x.k]
    return [l.from, l.to]
  }, [placed, layers, cenasSec, totalSec, work.settings.endCard])

  const select = useCallback((x: Sel, move = false) => {
    setSel(x)
    setUiState((u) => ({ ...u, editWord: null, sheet: x ? u.sheet : null }))
    if (move && x) {
      const r = range(x)
      if (r && (time < r[0] || time >= r[1])) seek(Math.min(r[0] + 0.05, r[1] - 1 / FPS))
    }
  }, [range, time, seek])

  // selection of a scene that was deleted / doesn't exist anymore
  if (sel?.k === "scene" && !placed.some((p) => p.scene.sceneId === sel.id)) setSel(null)

  // ── actions (each gesture = one named history step; spec §2.14)
  const undoRef = useRef<() => void>(() => {})
  const notify = useCallback((msg: string, undo = false, id?: string) => {
    toast(msg, { id, action: undo ? { label: t("undo"), onClick: () => undoRef.current() } : undefined })
  }, [t])
  const ruleText = useCallback((rule: string) => (t.has(`rule.${rule}` as never) ? t(`rule.${rule}` as never) : rule), [t])
  const L = (k: LayerKey) => lname(k)

  const act: Actions = useMemo(() => {
    const layer: Actions["layer"] = (key, label, patch) => s.commit(label, (w) => ({ ...w, doc: patchLayer(w.doc, key, patch) }))
    const timing = (key: LayerKey) => ({ fromSec: layers[key].from, durationSec: layers[key].to - layers[key].from })
    const setClips = (label: string, next: EditClip[]) => s.commit(label, (w) => ({ ...w, doc: withClips(w.doc, next) }))
    const placedScene = () => {
      if (sel?.k === "scene") return placed.find((p) => p.scene.sceneId === sel.id) ?? null
      return placed.find((p) => time >= p.start && time < p.end) ?? null
    }
    return {
      layer,
      layerLive: (key, patch) => s.live((w) => ({ ...w, doc: patchLayer(w.doc, key, patch) })),
      typingLayer: (field, key, label, patch) => s.typing(field, label, (w) => ({ ...w, doc: patchLayer(w.doc, key, patch) })),
      settings: (label, patch) => s.commit(label, (w) => ({ ...w, settings: { ...w.settings, ...patch } })),
      typingSettings: (field, label, patch) => s.typing(field, label, (w) => ({ ...w, settings: { ...w.settings, ...patch } })),
      clips: setClips,
      clipsLive: (next) => s.live((w) => ({ ...w, doc: withClips(w.doc, next) })),
      begin: s.begin,
      live: s.live,
      timing,
      trimTo: (side) => {
        if (phone) return
        if (sel && sel.k !== "scene" && sel.k !== "end") {
          const l = layers[sel.k]
          const tm = timing(sel.k)
          const from = side === "l" ? clamp(toFrame(time), 0, l.to - MIN_CLIP_SEC) : tm.fromSec
          const to = side === "r" ? clamp(toFrame(time), l.from + MIN_CLIP_SEC, cenasSec) : l.to
          layer(sel.k, t("hist.timing", { layer: L(sel.k) }), { timing: { fromSec: from, durationSec: to - from } })
          return
        }
        const p = placedScene()
        if (!p) return
        if (time <= p.start + 0.05 || time >= p.end - 0.05) return notify(t("toast.playheadInside"))
        const at = toFrame(p.clip.inSec + (time - p.start))
        // ≥ 0.3 s per scene and ≥ 1 s of video (validarDoc: clip_too_short / video_too_short)
        const min = minClipFor(placed, p.scene.sceneId)
        if ((side === "l" ? p.clip.outSec - at : at - p.clip.inSec) < min - 1e-6) return notify(t(min > MIN_CLIP_SEC + 1e-6 ? "toast.minVideo" : "toast.minClip"), false, "ed-min")
        setClips(t("hist.trim", { n: p.scene.index + 1 }), clips.map((c) => (c.sceneId === p.scene.sceneId ? { ...c, ...(side === "l" ? { inSec: at } : { outSec: at }) } : c)))
        setSel({ k: "scene", id: p.scene.sceneId })
        if (side === "l") seek(p.start)
      },
      moveScene: (d) => {
        if (phone || sel?.k !== "scene") return
        const p = placed.find((x) => x.scene.sceneId === sel.id)
        if (!p) return
        const to = p.pos + d
        if (to < 0 || to >= placed.length) return
        const order = placed.map((x) => x.scene.sceneId)
        order.splice(p.pos, 1)
        order.splice(to, 0, p.scene.sceneId)
        const byId = new Map(clips.map((c) => [c.sceneId, c]))
        setClips(t("hist.reorder"), [...order.map((sid) => byId.get(sid)!), ...clips.filter((c) => !c.enabled)])
      },
      reorder: (sceneId, toPos) => {
        const order = placed.map((x) => x.scene.sceneId).filter((x) => x !== sceneId)
        order.splice(toPos, 0, sceneId)
        const byId = new Map(clips.map((c) => [c.sceneId, c]))
        const sc = placed.find((x) => x.scene.sceneId === sceneId)
        setClips(t("hist.reorder"), [...order.map((sid) => byId.get(sid)!), ...clips.filter((c) => !c.enabled)])
        if (sc) notify(t("toast.moved", { n: sc.scene.index + 1 }), true)
      },
      deleteScene: () => {
        if (phone || sel?.k !== "scene") return
        const p = placed.find((x) => x.scene.sceneId === sel.id)
        if (!p) return
        const why = deleteBlock(placed, p.scene.sceneId)
        if (why) return notify(t(why === "last_scene" ? "lock.last_scene" : "toast.minVideoDelete"), false, "ed-min")
        setClips(t("hist.delete", { n: p.scene.index + 1 }), clips.map((c) => (c.sceneId === p.scene.sceneId ? { ...c, enabled: false } : c)))
        setSel(null)
        notify(t("toast.deleted", { n: p.scene.index + 1 }), true)
      },
      restoreScene: (sid) => setClips(t("hist.restore"), clips.map((c) => (c.sceneId === sid ? { ...c, enabled: true } : c))),
      restoreAll: () => setClips(t("hist.restore"), clips.map((c) => ({ ...c, enabled: true }))),
      fixWord: (w, text) => {
        s.commit(t("hist.fixWord", { word: w.original }), (x) => ({ ...x, doc: fixWordEverywhere(x.doc, src, w.original, text) }))
        notify(t("toast.fixed", { from: w.original, to: text }))
      },
      hideWord: (w) => {
        s.commit(t("hist.hideWord", { word: w.original }), (x) => ({ ...x, doc: setWord(x.doc, w.key, "") }))
        notify(t("toast.wordHidden", { word: w.original }), true)
      },
      resetWord: (w) => s.commit(t("hist.fixWord", { word: w.original }), (x) => ({ ...x, doc: setWord(x.doc, w.key, null) })),
      hideLayer: (key) => {
        const v = layers[key].visible
        layer(key, t(v ? "hist.hide" : "hist.show", { layer: L(key) }), { visible: !v })
        if (v) notify(t("toast.hidden", { layer: L(key) }), true)
      },
      resetStyle: (key) => layer(key, t("hist.reset", { layer: L(key) }), { style: null, transform: null }),
      autoTime: (key) => layer(key, t("hist.auto"), { timing: null }),
      exportNow: () => {
        if (s.rendering || s.exportMut.isPending) return
        // the doc that breaks a rule was not saved: exporting now would render the last saved version
        if (s.invalidRule) return notify(t("toast.fixFirst", { rule: ruleText(s.invalidRule) }), true, "ed-invalid")
        s.exportMut.mutate(undefined, { onError: (e) => notify(isApiError(e) ? e.message : String(e)) })
      },
      undo: () => {
        const label = s.undo()
        if (label) notify(t("toast.undone", { label }))
      },
      redo: () => {
        const label = s.redo()
        if (label) notify(t("toast.redone", { label }))
      },
      endTyping: s.endTyping,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, layers, sel, placed, clips, time, phone, cenasSec, src, t, notify, seek, ruleText])
  useEffect(() => {
    undoRef.current = act.undo
  })

  // render READY after our export: toast with the way back to the Edit step
  const latest = s.latest
  const watched = useRef<{ id: string; status: string } | null>(null)
  useEffect(() => {
    const prev = watched.current
    if (latest && prev && prev.id === latest.id && prev.status !== "READY" && prev.status !== "FAILED" && latest.status === "READY")
      toast(t("toast.exported"), { action: { label: t("goEdit"), onClick: () => router.push(stepHref(id, "edit")) } })
    watched.current = latest ? { id: latest.id, status: latest.status } : null
  }, [latest, t, router, id])

  const canContinue = creative.state === "RENDER_READY" && !s.notExported && !s.rendering && !s.dirtyLocal

  const ed: Ed = {
    id, creative, s, st, src, work, props, meta, clips, placed, cenasSec, totalSec, layers, lines, sel, select, time, seek, playing, togglePlay,
    phone, ui, setUi, t, notify, ruleText, act, playerRef, lname, sec, canContinue,
  }

  // ── keyboard (spec §6; off while typing; desktop gestures only)
  const edRef = useRef(ed)
  useEffect(() => {
    edRef.current = ed
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const E = edRef.current
      const el = e.target as HTMLElement
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable
      const mod = e.metaKey || e.ctrlKey
      const k = e.key
      if (document.querySelector("[role=dialog],[role=alertdialog]") && k !== "Escape") return
      if (mod && k.toLowerCase() === "z" && !typing) return void (e.preventDefault(), e.shiftKey ? E.act.redo() : E.act.undo())
      if (mod && k.toLowerCase() === "y" && !typing) return void (e.preventDefault(), E.act.redo())
      if (mod && k.toLowerCase() === "e") return void (e.preventDefault(), E.act.exportNow())
      if (typing) {
        if (k === "Escape") el.blur()
        return
      }
      if (mod) return
      const s1 = 1 / FPS
      if (k === " ") return void (e.preventDefault(), E.togglePlay())
      const sl = E.sel
      if (e.altKey && sl && sl.k !== "scene" && sl.k !== "end" && k.startsWith("Arrow")) {
        e.preventDefault()
        if (E.phone) return
        const L0 = E.layers[sl.k]
        const step = e.shiftKey ? 10 : 1
        const W = E.meta.compositionWidth
        const H = E.meta.compositionHeight
        const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0
        const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0
        const tr = L0.transform
        E.act.typingLayer(`nudge-${sl.k}`, sl.k, E.t("hist.nudge", { layer: E.lname(sl.k) }), { transform: { ...tr, x: tr.x + dx / W, y: tr.y + dy / H } })
        return
      }
      if (k === "ArrowLeft" || k === "ArrowRight") {
        e.preventDefault()
        const d = (e.shiftKey ? 1 : s1) * (k === "ArrowLeft" ? -1 : 1)
        return E.seek(E.time + d)
      }
      if (k === "ArrowUp" || k === "ArrowDown") {
        e.preventDefault()
        const cuts = [0, ...E.placed.map((p) => p.end)]
        if (k === "ArrowUp") {
          const p = cuts.filter((c) => c < E.time - 0.01)
          return E.seek(p.length ? p[p.length - 1] : 0)
        }
        const n = cuts.find((c) => c > E.time + 0.01)
        return n !== undefined ? E.seek(Math.min(n, E.totalSec - s1)) : undefined
      }
      if (k === "Home") return E.seek(0)
      if (k === "End") return E.seek(E.totalSec - s1)
      if (k === "Escape") return E.ui.help ? E.setUi({ help: false }) : E.select(null)
      if (k === "Tab") {
        e.preventDefault()
        const opts: Sel[] = (["caption", "hook", "cta"] as LayerKey[]).filter((x) => E.layers[x].exists).map((x) => ({ k: x }))
        if (E.work.settings.endCard) opts.push({ k: "end" })
        E.placed.forEach((p) => opts.push({ k: "scene", id: p.scene.sceneId }))
        const cur = opts.findIndex((o) => o && sl && o.k === sl.k && (o.k !== "scene" || (sl.k === "scene" && sl.id === (o as { id: string }).id)))
        return E.select(opts[(cur + (e.shiftKey ? -1 : 1) + opts.length) % opts.length], true)
      }
      if (k === "q" || k === "Q") return E.act.trimTo("l")
      if (k === "w" || k === "W") return E.act.trimTo("r")
      if (k === "[") return E.act.moveScene(-1)
      if (k === "]") return E.act.moveScene(1)
      if (k === "g" || k === "G") return E.setUi({ safe: !E.ui.safe })
      if (k === "s" || k === "S") {
        E.setUi({ snap: !E.ui.snap })
        return E.notify(E.t(E.ui.snap ? "toast.snapOff" : "toast.snapOn"))
      }
      if (k === "+" || k === "=") return E.setUi({ zoom: clamp(E.ui.zoom + 12, 16, 120) })
      if (k === "-" || k === "_") return E.setUi({ zoom: clamp(E.ui.zoom - 12, 16, 120) })
      if (k === "?") return E.setUi({ help: !E.ui.help })
      if ((k === "Delete" || k === "Backspace") && sl) {
        if (sl.k === "scene") return E.act.deleteScene()
        if (sl.k === "hook" || sl.k === "cta") return E.layers[sl.k].visible ? E.act.hideLayer(sl.k) : undefined
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const sheetOpen = phone && !!sel && !!ui.sheet

  // phone: toasts sit above the dock/sheet, never on top of Text · Style · Transcript (QA F2d, 390 px)
  const appRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = appRef.current
    if (!phone || !root) return
    const chrome = [root.querySelector<HTMLElement>(".ed-dock"), root.querySelector<HTMLElement>(".ed-sheet")].filter((x): x is HTMLElement => !!x)
    const place = () => {
      const h = Math.max(0, ...chrome.map((el) => el.offsetHeight))
      document.documentElement.style.setProperty("--toast-bottom", `${h + 8}px`)
    }
    place()
    const ro = new ResizeObserver(place)
    chrome.forEach((el) => ro.observe(el))
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty("--toast-bottom")
    }
  }, [phone])

  return (
    <EdCtx.Provider value={ed}>
      <div className="on-ink ed-app" ref={appRef}>
        <div className={cn("ed", sheetOpen && "sheet-open")}>
          <TopBar />
          <div className="ed-mid">
            <section className="ed-stagewrap" aria-label={t("preview")}>
              <Cards />
              <Stage onFrame={setFrame} onPlaying={setPlaying} />
            </section>
            {phone ? null : <Panel />}
          </div>
          <Timeline />
          <Dock />
          <Sheet />
        </div>
        <HelpDialog />
      </div>
    </EdCtx.Provider>
  )
}

function TopBar() {
  const { t, s, act, creative, id, canContinue, phone, ruleText } = useEd()
  const router = useRouter()
  const latest = s.latest
  const pct = latest?.progress ?? 0
  const savedTxt = s.status === "saving" ? t("saving") : s.status === "error" ? t("saveError") : s.status === "invalid" ? t("notSaved", { rule: ruleText(s.invalidRule ?? "") }) : t("saved")
  const edited = !!s.state?.editedInEditor
  return (
    <header className="ed-top">
      <Link href={stepHref(id, "edit")} className={buttonVariants({ variant: "ghost", size: "sm" })} title={t("backTitle")}>
        <EdIcon name="back" />
        <span className="ed-hide-m">{t("backLabel")}</span>
      </Link>
      <div className="ed-vsep ed-hide-m" />
      <div className="ed-name">
        <b>{creative.name}</b>
        {edited ? (
          <span className="ed-tag" title={t("editedTip")}>
            <EdIcon name="pencil" />
            {t("edited")}
          </span>
        ) : null}
        <span className="sep">/</span>
        <span className="ed-save" aria-live="polite">
          <span className={cn("ed-dot", s.status === "saving" ? "blue" : s.status === "error" || s.status === "invalid" ? "red" : "green")} />
          <span className="txt">{savedTxt}</span>
          {s.notExported ? <span className="txt">· {s.changes > 0 ? t("notExportedN", { n: s.changes }) : t("notExported")}</span> : null}
        </span>
      </div>
      <div className="ed-actions">
        <Button variant="ghost" size="icon-sm" disabled={!s.canUndo} onClick={act.undo} aria-label={t("undo")} title={s.undoLabel ? `${t("undoWhat", { label: s.undoLabel })} (⌘Z)` : t("nothingUndo")}>
          <EdIcon name="undo" />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!s.canRedo} onClick={act.redo} aria-label={t("redo")} title={s.redoLabel ? `${t("redoWhat", { label: s.redoLabel })} (⇧⌘Z)` : t("nothingRedo")}>
          <EdIcon name="redo" />
        </Button>
        {phone ? null : (
          <Button variant="ghost" size="icon-sm" className="ed-hide-m" onClick={openHelp} aria-label={t("shortcuts")} title={`${t("shortcuts")} (?)`} data-help>
            <EdIcon name="kbd" />
          </Button>
        )}
        <div className="ed-vsep ed-hide-m" />
        <Button
          size="sm"
          variant="outline"
          disabled={!canContinue}
          title={canContinue ? undefined : t("exportToContinue")}
          onClick={() => {
            toast.dismiss()
            router.push(stepHref(id, "review"))
          }}
        >
          {phone ? t("continueShort") : t("continue")}
        </Button>
        {s.rendering ? (
          <Button size="sm" variant="outline" aria-label={`${t("exporting")} ${pct}%`} className="min-w-[72px]">
            <span className="ed-spn" />
            <span className="ed-hide-m">{t("exporting")}</span>
            <span className="ed-mono">{pct}%</span>
          </Button>
        ) : (
          // QA layout 29/10 #13: icon only on the phone, so the creative's name keeps room in the top bar
          <Button size="sm" variant="default" onClick={act.exportNow} disabled={s.exportMut.isPending} title={`${t("export")} (⌘E)`} aria-label={s.exportFailed ? t("exportAgain") : t("export")}>
            <EdIcon name={s.exportFailed ? "refresh" : "exp"} />
            <span className="ed-hide-m">{s.exportFailed ? t("exportAgain") : t("export")}</span>
          </Button>
        )}
      </div>
    </header>
  )
}
// the help button dispatches through the DOM so the TopBar doesn't re-render on `ui`
function openHelp() {
  window.dispatchEvent(new CustomEvent("ed:help"))
}

function useAgo() {
  const format = useFormatter()
  const now = useNow({ updateInterval: 5_000 })
  return (iso: string) => format.relativeTime(new Date(iso), now)
}

function Cards() {
  const { t, s, act, totalSec, select, setUi } = useEd()
  const ago = useAgo()
  const [browserOk, setBrowserOk] = useState(() => {
    if (typeof navigator === "undefined") return true
    const ua = navigator.userAgent
    const chromium = /Chrome\/|Edg\//.test(ua) && !/OPR\/|Firefox\//.test(ua)
    return chromium || localStorage.getItem("ed:browser-ok") === "1"
  })
  useEffect(() => {
    const h = () => setUi({ help: true })
    window.addEventListener("ed:help", h)
    return () => window.removeEventListener("ed:help", h)
  }, [setUi])
  const r = s.latest
  // ETA from the observed pace of this render (the API sends %, not time)
  const [clock, setClock] = useState<{ id: string; at: number; now: number } | null>(null)
  const rid = r?.id
  useEffect(() => {
    if (!s.rendering || !rid) return
    const tick = () => setClock((c) => (c && c.id === rid ? { ...c, now: Date.now() } : { id: rid, at: Date.now(), now: Date.now() }))
    const t0 = setTimeout(tick, 0)
    const iv = setInterval(tick, 1000)
    return () => {
      clearTimeout(t0)
      clearInterval(iv)
    }
  }, [s.rendering, rid])

  const cards: React.ReactNode[] = []
  if (s.conflict) {
    cards.push(
      <div key="c" className="ed-card warn" role="alert">
        <div className="ed-card-head">
          <EdIcon name="users" className="text-status-waiting" />
          <b>{t("conflictTitle", { name: s.conflict.savedBy?.name ?? "?", ago: s.conflict.savedAt ? ago(s.conflict.savedAt) : "" })}</b>
          <span className="sp">
            <Button size="sm" onClick={s.clearConflict}>{t("gotIt")}</Button>
          </span>
        </div>
        <p className="text-fg-2">{t("conflictBody")}</p>
      </div>
    )
  }
  if (!browserOk) {
    cards.push(
      <div key="b" className="ed-card" role="status">
        <div className="ed-card-head">
          <EdIcon name="globe" className="text-status-progress" />
          <b>{t("browserTitle")}</b>
          <span className="sp">
            <Button size="sm" onClick={() => {
              localStorage.setItem("ed:browser-ok", "1")
              setBrowserOk(true)
            }}>{t("gotIt")}</Button>
          </span>
        </div>
        <p className="text-fg-2">{t("browserBody")}</p>
      </div>
    )
  }
  if (r && r.status === "FAILED") {
    cards.push(
      <div key="e" className="ed-card err" role="alert">
        <div className="ed-card-head">
          <EdIcon name="alert" className="text-status-failed" />
          <b>{t("failedTitle", { frame: r.failedFrame ?? r.frame ?? 0, total: r.totalFrames ?? Math.round(totalSec * FPS) })}</b>
        </div>
        <p className="text-fg-2">
          {r.failReason ?? ""} {t("failedSaved")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="default" onClick={act.exportNow}>
            <EdIcon name="refresh" />
            {t("exportAgain")}
          </Button>
          {/font|fonte/i.test(r.failReason ?? "") ? (
            <Button size="sm" onClick={() => select({ k: "hook" }, true)}>{t("changeFont")}</Button>
          ) : null}
        </div>
      </div>
    )
  } else if (r && s.rendering) {
    const order = ["queued", "bundling", "rendering", "encoding"]
    const stg = Math.max(0, order.indexOf(r.status === "QUEUED" ? "queued" : (r.stage ?? "rendering")))
    const items = [t("stage.bundling"), t("stage.rendering"), t("stage.encoding"), t("stage.uploading")]
    const at = stg <= 1 ? 0 : stg === 2 ? 1 : r.progress >= 100 ? 3 : 2
    const el = clock && clock.id === r.id ? (clock.now - clock.at) / 1000 : 0
    const left = r.progress > 3 && el > 2 ? Math.max(5, Math.round((el * (100 - r.progress)) / r.progress)) : null
    cards.push(
      <div key="x" className="ed-card ed-beam" role="status">
        <div className="ed-card-head">
          <b>
            {t("exporting")} · <span className="ed-mono">{r.progress}%</span>
          </b>
          <span className="ed-mono text-[12px] text-fg-3">
            {t("frameOf", { frame: r.frame ?? 0, total: r.totalFrames ?? Math.round(totalSec * FPS) })}
            {left !== null ? ` · ${left >= 60 ? t("leftMin", { n: Math.round(left / 60) }) : t("leftSec", { n: left })}` : ""}
          </span>
        </div>
        <div className="ed-bar">
          <b style={{ width: `${r.progress}%` }} />
        </div>
        <ul className="ed-steps">
          {items.map((l, i) => (
            <li key={i} className={i < at ? "done" : i === at ? "now" : ""}>
              {i < at ? <EdIcon name="check" /> : i === at ? <span className="ed-spn" /> : <span className="ed-q" />}
              {l}
            </li>
          ))}
        </ul>
        <p className="ed-faint">{t("exportKeepEditing")}</p>
      </div>
    )
  }
  return <div className="ed-bn">{cards}</div>
}

const KEYS: [string, [string, string[]][]][] = [
  ["playback", [["playPause", ["Space"]], ["frame1", ["←", "→"]], ["second1", ["⇧ ←", "⇧ →"]], ["cutPrevNext", ["↑", "↓"]], ["startEnd", ["Home", "End"]]]],
  ["selection", [["nextLayer", ["Tab", "⇧ Tab"]], ["clearSel", ["Esc"]], ["nudge", ["⌥ ↑↓←→", "⌥⇧"]], ["rotate15", ["⇧"]], ["noSnap", ["⌥"]], ["hideDelete", ["Delete"]]]],
  ["timeline", [["trimStart", ["Q"]], ["trimEnd", ["W"]], ["moveScene", ["[", "]"]], ["zoom", ["+", "−"]], ["snapToggle", ["S"]]]],
  ["general", [["undoRedo", ["⌘Z", "⇧⌘Z"]], ["export", ["⌘E"]], ["safeZones", ["G"]], ["thisList", ["?"]]]],
]
function HelpDialog() {
  const { t, ui, setUi } = useEd()
  return (
    <Dialog open={ui.help} onOpenChange={(o) => setUi({ help: o })}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("shortcuts")}</DialogTitle>
          <DialogDescription>{t("keys.note")}</DialogDescription>
        </DialogHeader>
        <div className="ed-kgrid">
          {KEYS.map(([g, rows]) => (
            <div key={g} className="grid content-start gap-1.5">
              <h3 className="step-lbl">{t(`keys.${g}` as never)}</h3>
              {rows.map(([k, keys]) => (
                <div key={k} className="ed-krow">
                  <span>{t(`keys.${k}` as never)}</span>
                  <span>
                    {keys.map((x) => (
                      <span key={x} className="ed-kbd">{x}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

