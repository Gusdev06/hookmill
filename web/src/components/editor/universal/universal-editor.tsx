"use client"

import "./universal.css"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { PlayerRef } from "@remotion/player"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { EditorExportStage, FormatCode } from "@/lib/api/types"
import { iterateHref } from "@/lib/routes"
import { ik } from "@/hooks/use-iterate"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useSession } from "@/components/providers/session-provider"
import { EdIcon } from "@/components/editor/ed-icon"
import { cn } from "@/lib/utils"
import { UCtx, type Tab, type U } from "./context"
import { Canvas } from "./canvas"
import { LayerRail, Timeline } from "./layers"
import { LayerTab, TemplateTab } from "./panel"
import { canExport, checks, clamp, clampFraming, clampVideoBox, docOrEmpty, emptyDoc, framingNow, geoMode, geometryOf, isEmpty, principalOf, resolve, setGeometry, setVideoGeo, timecode } from "./model"
import { useUniversalSession } from "./use-universal"

const PHONE_MQ = "(max-width: 899px)"
function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE_MQ)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    () => window.matchMedia(PHONE_MQ).matches,
    () => false
  )
}
const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase())

/** Layer and template names (manifest labelKeys are stable ids; the web translates them, §3.1). */
export function useLabels(templateKey: string | null) {
  const t = useTranslations("editorU")
  const ti = useTranslations("iterate.frame.name")
  return useCallback((id: string) => {
    if (id === "__template") {
      if (!templateKey) return ""
      if (templateKey === "headline") return t("tplName.headline")
      const f = templateKey.replace(/^frame:/, "")
      return ti.has(f as never) ? ti(f as never) : humanize(f)
    }
    if (id === "video") return t("layer.video")
    if (id === "video:2") return t("layer.video2")
    if (id === "brand") return t("layer.brand")
    if (id === "burned") return t("layer.burned")
    if (id === "headline") return t("layer.headline")
    if (id === "headline:box") return t("layer.headlineBox")
    if (id.startsWith("slot:")) {
      const k = id.slice(5).replace(/\./g, "_")
      return t.has(`field.${k}` as never) ? t(`field.${k}` as never) : humanize(id.slice(5).split(".").pop() ?? id)
    }
    if (id.startsWith("box:")) {
      const k = id.slice(4)
      return t("layer.box", { name: t.has(`boxName.${k}` as never) ? t(`boxName.${k}` as never) : humanize(k) })
    }
    return humanize(id)
  }, [t, ti, templateKey])
}

const STAGES: EditorExportStage[] = ["saving", "rendering", "caption_check", "text_check"]

/** /creatives/:id/editor for an AUTO piece (editor-universal-v1 F-U1): layers | canvas (Player + handles) | panel. */
export function UniversalEditor({ id }: { id: string }) {
  const t = useTranslations("editorU")
  const s = useUniversalSession(id)
  const st = s.st!
  const { session } = useSession()
  const errorMessage = useErrorMessage()
  const phone = usePhone()
  const principal = principalOf(st.manifest)
  const [fmtState, setFmt] = useState<FormatCode>(principal)
  const fmt = st.manifest.formats.includes(fmtState) ? fmtState : principal
  const [sel, setSel] = useState<string | null>(null)
  const [reframeOn, setReframing] = useState(false)
  const [tab, setTab] = useState<Tab>("tpl")
  const [guides, setGuides] = useState(false)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const playerRef = useRef<PlayerRef | null>(null)
  const label = useLabels(st.templateKey)
  const doc = s.doc ?? emptyDoc()

  const r = useMemo(() => resolve(st, doc, fmt), [st, doc, fmt])
  const issues = useMemo(() => checks(st, r, doc), [st, r, doc])
  const rPrincipal = useMemo(() => (fmt === principal ? r : resolve(st, doc, principal)), [fmt, principal, r, st, doc])
  const exportIssues = useMemo(() => (fmt === principal ? issues : checks(st, rPrincipal, doc)), [fmt, principal, issues, st, rPrincipal, doc])
  const fps = r?.meta.fps ?? 30
  const rFull = useMemo(() => resolve(st, null, fmt), [st, fmt])
  const fullTrim = rFull?.layout.video?.trim ?? null
  const fullDur = rFull?.layout.durationSec ?? 0
  const videoFull = useMemo(() => (fullTrim ? { inSec: fullTrim.inSec, outSec: fullTrim.outSec, durationSec: fullDur } : null), [fullTrim, fullDur])

  const select = useCallback((nid: string | null, toLayer = true) => {
    setSel(nid)
    if (!nid || st.manifest.layers.find((l) => l.id === nid)?.kind !== "video") setReframing(false)
    if (nid && toLayer) setTab("lyr")
  }, [st.manifest.layers])
  const seek = useCallback((sec: number) => {
    const p = playerRef.current
    const dur = r?.meta.durationInFrames ?? 1
    const f = clamp(Math.round(sec * fps), 0, dur - 1)
    p?.seekTo(f)
    setTime(f / fps)
  }, [fps, r?.meta.durationInFrames])
  const togglePlay = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (p.isPlaying()) p.pause()
    else p.play()
  }, [])
  const onFrame = useCallback((f: number) => setTime(f / fps), [fps])

  // CLIENT only reads (§7.1: the GET answers, PUT/export are 403), whatever the piece's own state
  const clientRole = session.workspace.role === "CLIENT"
  const readOnly = s.readOnly || clientRole
  const ro = readOnly || s.running
  const decl = useCallback((lid: string) => st.manifest.layers.find((l) => l.id === lid), [st.manifest.layers])
  const selDecl = sel ? decl(sel) : undefined
  const reframing = reframeOn && !phone && !ro && selDecl?.kind === "video" && selDecl.editable.reframe
  const pickFmt = useCallback((f: FormatCode) => {
    setFmt(f)
    setReframing(false)
  }, [])
  const ctx: U = {
    id, s, st, doc, fmt, setFmt: pickFmt, principal, r, issues, exportIssues, sel, select, tab, setTab, time, seek, playing, togglePlay, playerRef,
    phone, guides, setGuides, ro, reframing, setReframing, videoFull, decl, label, userId: session.user.id, t,
  }

  // keyboard (desktop): ⌘Z / ⇧⌘Z, Space, Esc, arrows move 1 px (Shift 10 px), one undo step per burst
  const arrowT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      // Esc leaves reframing from anywhere, even with a slider focused
      if (e.key === "Escape" && reframing) {
        setReframing(false)
        return
      }
      const tag = ((e.target as HTMLElement)?.tagName ?? "").toLowerCase()
      if (tag === "input" || tag === "textarea" || tag === "select") return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (ro) return
        const l = e.shiftKey ? s.redo() : s.undo()
        if (l) toast(t(e.shiftKey ? "toast.redone" : "toast.undone", { what: l }), { id: "eu-hist" })
        return
      }
      if (e.key === " " && tag !== "button") {
        e.preventDefault()
        togglePlay()
      }
      if (e.key === "Escape") select(null)
      const d = sel ? decl(sel) : undefined
      const L = sel ? r?.layout.layers.find((x) => x.id === sel) : undefined
      const arrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      if (arrow && reframing && r) {
        e.preventDefault()
        const st2 = e.shiftKey ? 10 : 1
        const dx = (e.key === "ArrowLeft" ? -st2 : e.key === "ArrowRight" ? st2 : 0) / r.layout.canvas.width
        const dy = (e.key === "ArrowUp" ? -st2 : e.key === "ArrowDown" ? st2 : 0) / r.layout.canvas.height
        s.typing("arrow:reframe", t("hist.reframe"), (x) => {
          const f = framingNow(r, x, fmt, principal)
          return setVideoGeo(x, fmt, principal, { framing: clampFraming({ ...f, panX: f.panX + dx, panY: f.panY + dy }) })
        })
        if (arrowT.current) clearTimeout(arrowT.current)
        arrowT.current = setTimeout(() => s.endTyping(), 400)
        return
      }
      if (d?.kind === "video" && L && r && !ro && d.editable.move && arrow) {
        e.preventDefault()
        const st2 = e.shiftKey ? 10 : 1
        const dx = (e.key === "ArrowLeft" ? -st2 : e.key === "ArrowRight" ? st2 : 0) / r.layout.canvas.width
        const dy = (e.key === "ArrowUp" ? -st2 : e.key === "ArrowDown" ? st2 : 0) / r.layout.canvas.height
        s.typing("arrow:video", t("hist.move", { layer: label(sel!) }), (x) => setVideoGeo(x, fmt, principal, { box: clampVideoBox({ ...L.rect, x: L.rect.x + dx, y: L.rect.y + dy }) }))
        if (arrowT.current) clearTimeout(arrowT.current)
        arrowT.current = setTimeout(() => s.endTyping(), 400)
        return
      }
      if (d && L && !ro && d.editable.move && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault()
        const W = r!.layout.canvas.width
        const H = r!.layout.canvas.height
        const st2 = e.shiftKey ? 10 : 1
        const dx = (e.key === "ArrowLeft" ? -st2 : e.key === "ArrowRight" ? st2 : 0) / W
        const dy = (e.key === "ArrowUp" ? -st2 : e.key === "ArrowDown" ? st2 : 0) / H
        const gm = geoMode(st, d)
        s.typing(`arrow:${sel}`, t("hist.move", { layer: label(sel!) }), (x) => {
          if (gm.mode === "transform") {
            const g = geometryOf(x, sel!, fmt, principal).transform
            const rect = L.rect
            const t0 = g ?? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, scale: 1, rotationDeg: 0, boxWidth: rect.w }
            return setGeometry(x, sel!, fmt, principal, { transform: { ...t0, x: t0.x + dx, y: t0.y + dy } })
          }
          const cur = geometryOf(x, sel!, fmt, principal).rect ?? L.rect
          return setGeometry(x, sel!, fmt, principal, { rect: { ...cur, x: cur.x + dx, y: cur.y + dy } })
        })
        if (arrowT.current) clearTimeout(arrowT.current)
        arrowT.current = setTimeout(() => s.endTyping(), 400)
      }
    }
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [])

  // Download: the piece's 9:16 file from the batch view (on only when there's no edit left to export)
  const batchQ = useQuery({ queryKey: ik.batch(st.piece?.batchId ?? "-"), queryFn: () => api.iterate.get(st.piece!.batchId), enabled: !!st.piece, staleTime: 30_000 })
  const file916 = batchQ.data?.pieces.find((p) => p.id === st.piece?.id)?.files.find((f) => f.format === "9x16") ?? null
  const notExported = s.dirtyLocal || (st.dirty && (!isEmpty(doc) || !!st.exported))
  const backHref = st.piece ? iterateHref(st.piece.batchId, "download") : "/library"

  const blocked = !canExport(exportIssues)
  const confirmPending = exportIssues.some((i) => i.level === "confirm")
  const nothing = !notExported
  const exportOff = readOnly || s.running || s.exportMut.isPending || blocked || nothing || !!s.conflict
  const exportTitle = readOnly ? t("top.exportReadOnly") : blocked && !confirmPending ? t("top.exportBlocked") : confirmPending ? t("top.exportConfirm") : nothing ? t("top.exportNothing") : t("top.exportTip")

  const saveText =
    s.status === "saving" ? t("save.saving")
      : s.status === "error" ? t("save.error")
        : s.status === "invalid" ? t("save.invalid")
          : s.dirtyLocal ? t("save.unsaved")
            : st.exported && st.exported.revision === s.revision ? t("save.exported", { rev: s.revision ?? 0 })
              : (s.revision ?? 0) > 0 && notExported ? t("save.notExported", { rev: s.revision ?? 0 })
                : t("save.saved", { rev: s.revision ?? 0 })

  const copyMine = async () => {
    const lines = [
      ...doc.layers.filter((l) => typeof l.text === "string").map((l) => `${label(l.id)}: ${l.text}`),
      ...Object.entries(doc.items ?? {}).flatMap(([lid, xs]) => xs.filter((x) => x.text).map((x) => `${label(lid)} ${x.id}: ${x.text}`)),
    ]
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      toast(t("toast.copied", { n: lines.length }))
    } catch {
      toast(t("toast.copyFailed"))
    }
    s.loadTheirs()
  }
  const exportReason = isApiError(s.exportMut.error) ? String((s.exportMut.error.details as { reason?: string } | undefined)?.reason ?? "") : ""
  const exportErrorText = t.has(`exportReason.${exportReason}` as never) ? t(`exportReason.${exportReason}` as never) : s.exportMut.error?.message === "not_saved" ? t("exportReason.not_saved") : errorMessage(s.exportMut.error)
  const exp = s.exp
  const stageIx = exp ? STAGES.indexOf(exp.stage) : -1
  const failed = exp?.stage === "failed" ? exp : null
  const jump = () => {
    if (!failed?.error) return
    seek(failed.error.atSec ?? 0)
    const first = st.manifest.layers.find((l) => l.kind === "text" && !l.lockedReason)
    select(failed.error.layerId ?? first?.id ?? null)
  }

  return (
    <UCtx.Provider value={ctx}>
      <div className="eu fixed inset-0 z-30 overflow-y-auto">
        <div className="wrap">
          <header className="top">
            <div className="crumb">
              <span className="logo"><i /></span>
              <Link href={backHref}>{st.piece ? t("top.batch") : t("top.library")}</Link>
              <span aria-hidden="true">/</span>
              <b>{label("__template")}</b>
              {st.code ? <span className="code">{st.code}</span> : null}
            </div>
            <div className="tools">
              <span title={s.invalidRule ?? undefined} className={cn("save", (s.dirtyLocal || notExported) && "pending", (s.status === "error" || s.status === "invalid") && "bad")} role="status"><i /><span>{saveText}</span></span>
              <button type="button" className="btn ib" disabled={!s.canUndo || ro} onClick={() => s.undo()} aria-label={t("top.undo")} title={`${t("top.undo")} (⌘Z)`}><EdIcon name="undo" /></button>
              <button type="button" className="btn ib" disabled={!s.canRedo || ro} onClick={() => s.redo()} aria-label={t("top.redo")} title={`${t("top.redo")} (⇧⌘Z)`}><EdIcon name="redo" /></button>
              <button type="button" className="btn hide-m" disabled={ro || isEmpty(doc)} onClick={() => s.commit(t("hist.resetAll"), () => docOrEmpty(null))}>{t("top.resetAll")}</button>
              {file916 && !notExported && !s.running ? (
                <a className="btn" href={file916.url} download={file916.name}>{t("top.download")}</a>
              ) : (
                <button type="button" className="btn" disabled title={notExported ? t("top.downloadPending") : undefined}>{t("top.download")}</button>
              )}
              <button type="button" className="btn lime" disabled={exportOff} title={exportTitle} onClick={() => s.exportMut.mutate()}>
                {s.exportMut.isPending ? <span className="spin-ring size-3.5 border-current" aria-hidden="true" /> : null}
                {t("top.export")}
              </button>
            </div>
          </header>

          {readOnly ? (
            <div className="banner info">
              <div className="txt"><b>{t(s.readOnly ? "banner.readOnlyTitle" : "banner.clientTitle")}</b> {t(s.readOnly ? "banner.readOnlyBody" : "banner.clientBody")}</div>
              <div className="acts"><Link className="btn sm" href="/library">{t("banner.openLibrary")}</Link></div>
            </div>
          ) : null}
          {s.conflict ? (
            <div className="banner warn">
              <div className="txt"><b>{t("banner.conflictTitle", { name: s.conflict.savedBy?.name ?? "—" })}</b> {t("banner.conflictBody")}</div>
              <div className="acts">
                <button type="button" className="btn sm" onClick={s.loadTheirs}>{t("banner.loadTheirs", { name: s.conflict.savedBy?.name ?? "—" })}</button>
                <button type="button" className="btn sm" onClick={copyMine}>{t("banner.copyMine")}</button>
              </div>
            </div>
          ) : null}
          {s.running && exp ? (
            <div className="banner info" role="status">
              <div className="txt">
                <b>{t("banner.exportingTitle", { name: label("__template") })}</b> · {t("banner.exportingBody")}
                <div className="psteps">
                  {STAGES.map((k, i) => <span key={k} className={cn(i < stageIx && "done", i === stageIx && "now")}><i />{t(`stage.${k}` as never, { format: "9:16" } as never)}</span>)}
                </div>
                <div className="pbar"><i style={{ width: `${exp.stage === "rendering" ? exp.progress : stageIx >= 2 ? 100 : 4}%` }} /></div>
              </div>
            </div>
          ) : null}
          {failed ? (
            <div className="banner bad">
              <div className="txt"><b>{t(`fail.${failed.error?.code === "TEXT_MISMATCH" ? "text" : failed.error?.code === "CAPTION_COVERED" ? "caption" : "render"}` as never)}</b> {failed.error?.atSec != null ? t("fail.at", { at: timecode(failed.error.atSec) }) : null} {t("fail.kept")}</div>
              <div className="acts">
                {failed.error?.atSec != null ? <button type="button" className="btn sm" onClick={jump}>{t("fail.jump", { at: timecode(failed.error.atSec) })}</button> : null}
                {failed.error?.canRecheck ? <button type="button" className="btn sm" disabled={s.recheckMut.isPending} onClick={() => s.recheckMut.mutate()}>{t("fail.retry")}</button> : null}
              </div>
            </div>
          ) : null}
          {s.blocked?.length ? (
            <div className="banner bad"><div className="txt"><b>{t("banner.blockedTitle")}</b> {t("banner.blockedBody")}</div></div>
          ) : null}
          {s.exportMut.isError && !s.blocked && !s.conflict ? (
            <div className="banner bad"><div className="txt"><b>{t("banner.exportErrorTitle")}</b> {exportErrorText}</div></div>
          ) : null}
          {s.justExported !== null && !s.running && !failed ? (
            <div className="banner ok">
              <div className="txt"><b>{t("banner.doneTitle")}</b> {t("banner.doneBody")}</div>
              <div className="acts">
                {file916 ? <a className="btn sm" href={file916.url} download={file916.name}>{t("banner.download916")}</a> : null}
                <Link className="btn sm" href={backHref}>{st.piece ? t("banner.backBatch") : t("top.library")}</Link>
              </div>
            </div>
          ) : null}
          {s.status === "invalid" ? (
            <div className="banner bad"><div className="txt"><b>{t("banner.invalidTitle")}</b> {t("banner.invalidBody")}</div><div className="acts"><button type="button" className="btn sm" disabled={!s.canUndo} onClick={() => s.undo()}>{t("top.undo")}</button></div></div>
          ) : null}

          <div className="ed">
            <LayerRail />
            <div className="stagewrap"><Canvas onFrame={onFrame} onPlaying={setPlaying} /></div>
            {phone ? null : <div className="tlwrap"><Timeline /></div>}
            <div className="panel">
              <div className="ptabs" role="group" aria-label={t("panel.aria")}>
                <button type="button" className="ptab" aria-pressed={tab === "tpl"} onClick={() => setTab("tpl")}>{t("panel.template")} <small>{label("__template")}</small></button>
                <button type="button" className="ptab" aria-pressed={tab === "lyr"} onClick={() => setTab("lyr")}>{t("panel.layer")} <small>{sel ? label(sel) : t("panel.none")}</small></button>
              </div>
              {tab === "tpl" ? <TemplateTab /> : <LayerTab />}
              {phone && !readOnly ? <button type="button" className="btn" disabled={ro || isEmpty(doc)} onClick={() => s.commit(t("hist.resetAll"), () => docOrEmpty(null))}>{t("top.resetAll")}</button> : null}
            </div>
          </div>
        </div>
      </div>
    </UCtx.Provider>
  )
}
/** Opening (§6): the cover with the real steps + skeleton panel, before the GET answers. */
export function UniversalSkeleton() {
  const t = useTranslations("editorU")
  return (
    <div className="eu fixed inset-0 z-30 overflow-y-auto" role="status" aria-label={t("cover.title")}>
      <div className="wrap">
        <header className="top"><div className="crumb"><span className="logo"><i /></span><b>{t("cover.title")}</b></div></header>
        <div className="ed">
          <aside className="rail"><div className="skel"><i /><i /><i /><i /></div></aside>
          <div className="stagewrap">
            <section className="stage">
              <div className="viewport" style={{ width: "min(100%, 340px)", aspectRatio: "9 / 16" }}>
                <div className="cover">
                  <b>{t("cover.title")}</b>
                  <span>{t("cover.body")}</span>
                  <div className="row now"><i />{t("cover.piece")}</div>
                  <div className="row"><i />{t("cover.proxy", { s: 4 })}</div>
                  <div className="row"><i />{t("cover.fonts")}</div>
                </div>
              </div>
            </section>
          </div>
          <div className="panel"><section className="card"><div className="skel"><i /><i /><i /><i /><i /></div></section></div>
        </div>
      </div>
    </div>
  )
}

/** Error / not editable (422 EDIT_NOT_SUPPORTED, 409 piece not ready, 402 sample locked, network). */
export function UniversalGate({ title, body, back, retry }: { title: string; body: string; back: string; retry?: () => void }) {
  const t = useTranslations("editorU")
  return (
    <div className="eu fixed inset-0 z-30 grid place-items-center overflow-y-auto p-6">
      <section className="card" style={{ maxWidth: 460 }}>
        <div className="lhead"><span className="ic"><EdIcon name="alert" /></span><h2>{title}</h2></div>
        <p className="sub">{body}</p>
        <div className="rowbtns">
          <Link className="btn" href={back}><EdIcon name="back" />{t("gate.back")}</Link>
          {retry ? <button type="button" className="btn" onClick={retry}><EdIcon name="refresh" />{t("gate.retry")}</button> : null}
        </div>
      </section>
    </div>
  )
}
