"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Player } from "@remotion/player"
import { LEGENDA_FAIXA_SEGURA, LIMITES_DOC_V3, carregarFontes, type RemixKeepProps } from "@maquina/video/player"
import type { AutoPieceSource, EditDocV3, EditIssue, LayerTransform, Rect, VideoFraming } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { EdIcon } from "@/components/editor/ed-icon"
import { useU } from "./context"
import { LayerChips } from "./layers"
import { SNAP } from "./legenda"
import { baseOf, canMove, setCaptionY, clamp, clampFraming, clampVideoBox, framingNow, geoMode, geometryOf, setGeometry, setVideoGeo, timecode, videoUrlOf } from "./model"

/** App UI bands (px of the 1080-wide canvas) per format, as in the approved prototype. */
const UI_BANDS: Record<string, { t: number; b: number }> = { "9x16": { t: 200, b: 340 }, "4x5": { t: 60, b: 110 }, "1x1": { t: 50, b: 50 } }
type Mode = "move" | "corner" | "side"
interface Drag {
  id: string; mode: Mode; cx: -1 | 1; cy: -1 | 1; sx: number; sy: number; moved: boolean
  r0: Rect; t0: LayerTransform | null; d0: number; ccx: number; ccy: number
}

/** Issue → which pill it lights (§5). */
export const pillOf = (i: EditIssue): "face" | "caption" | "text" | "numbers" | "contrast" | "capwarn" | null =>
  i.rule === "caption_over_face" || i.rule === "caption_over_text" || i.rule === "caption_off_safe" ? "capwarn"
    : i.rule === "face_covered" || i.rule === "face_cut" ? "face"
    : i.rule === "caption_covered" || i.rule === "caption_cut" ? "caption"
      : i.rule === "text_overflow" || i.rule === "too_long" ? "text"
        : i.rule === "invented_number" ? "numbers" : i.rule === "low_contrast" ? "contrast" : null

export function Canvas({ onFrame, onPlaying }: { onFrame: (f: number) => void; onPlaying: (p: boolean) => void }) {
  const U = useU()
  const { t, st, r, sel, select, phone, ro, decl, label, s, fmt, principal, issues, playerRef, guides, time, playing, reframing, setReframing, seek, cap, stick } = U
  const wrap = useRef<HTMLElement>(null)
  const frameEl = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [muted, setMuted] = useState(true)
  const [snap, setSnap] = useState<{ v?: boolean; h?: boolean }>({})
  const [readout, setReadout] = useState<string | null>(null)
  const [capDrag, setCapDrag] = useState(false)
  const [capSnap, setCapSnap] = useState(false)
  const drag = useRef<Drag | null>(null)
  const W = r?.layout.canvas.width ?? 1080
  const H = r?.layout.canvas.height ?? 1920
  const dur = r?.layout.durationSec ?? 1

  // a shorter trim can leave the playhead past the new end
  useEffect(() => {
    if (time > dur) seek(dur)
  }, [time, dur, seek])

  // reframing ends with a click anywhere outside the canvas and the tools that act on it
  useEffect(() => {
    if (!reframing) return
    const down = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".viewport, .ctrl, .panel, .tl, .stage-head, .trimcard, .aviso1, .top")) setReframing(false)
    }
    document.addEventListener("pointerdown", down)
    return () => document.removeEventListener("pointerdown", down)
  }, [reframing, setReframing])

  // the Player mounts after the fonts (it measures/paints with the fallback otherwise)
  useEffect(() => {
    let alive = true
    Promise.all([carregarFontes(), document.fonts.ready]).finally(() => alive && setFontsReady(true))
    return () => {
      alive = false
    }
  }, [])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const fit = () => {
      const cw = el.clientWidth - 28
      const maxW = phone ? Math.min(380, cw) : cw
      const maxH = phone ? (stick ? 270 : window.innerHeight * 0.58) : Math.max(380, window.innerHeight - 330) // 16/11: prévia maior; 20/11 (QA B6): deixa o aparar aparecer na dobra a 1440x900
      const w = Math.max(160, Math.min(maxW, (maxH * W) / H))
      setSize({ w: Math.round(w), h: Math.round((w * H) / W) })
    }
    fit()
    const ro2 = new ResizeObserver(fit)
    ro2.observe(el)
    window.addEventListener("resize", fit)
    return () => {
      ro2.disconnect()
      window.removeEventListener("resize", fit)
    }
  }, [W, H, phone, stick])
  const k = size ? size.w / W : 1

  useEffect(() => {
    const p = playerRef.current
    if (!p || !mounted) return
    const fu = (e: { detail: { frame: number } }) => onFrame(e.detail.frame)
    const pl = () => onPlaying(true)
    const pa = () => onPlaying(false)
    p.addEventListener("frameupdate", fu)
    p.addEventListener("seeked", fu)
    p.addEventListener("play", pl)
    p.addEventListener("pause", pa)
    p.addEventListener("ended", pa)
    return () => {
      p.removeEventListener("frameupdate", fu)
      p.removeEventListener("seeked", fu)
      p.removeEventListener("play", pl)
      p.removeEventListener("pause", pa)
      p.removeEventListener("ended", pa)
    }
  }, [mounted, playerRef, onFrame, onPlaying])

  // first paint at 1 s: templates animate in from frame 0, so frame 0 is an empty card
  const firstSeek = useRef(false)
  const fps0 = r?.meta.fps
  const dur0 = r?.meta.durationInFrames
  useEffect(() => {
    if (!mounted || firstSeek.current || !fps0 || !dur0) return
    firstSeek.current = true
    const f = Math.min(fps0, dur0 - 1)
    playerRef.current?.seekTo(f)
    onFrame(f)
  }, [mounted, fps0, dur0, playerRef, onFrame])

  const badIds = new Set(issues.filter((i) => i.level === "block" && i.layerId).map((i) => i.layerId!))
  const layers = (r?.layout.layers ?? []).filter((l) => l.visible && l.rect.w > 0 && l.rect.h > 0)
  const order = { video: 0, broll: 1, box: 2, burned: 3, list: 4, chat: 4, caption: 5, text: 6 } as Record<string, number>
  const hits = [...layers].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))
  const selL = sel ? layers.find((l) => l.id === sel) ?? null : null
  const selD = sel ? decl(sel) : undefined

  /** HEADLINE text: the transform that draws the current box (center, line width, font scale vs the base). */
  const transformFrom = useCallback((id: string, rf: Rect): LayerTransform => {
    const g = geometryOf(U.doc, id, fmt, principal)
    if (g.transform) return g.transform
    const base = baseOf(st, fmt) as unknown as RemixKeepProps | null
    const orig = base?.textLayers?.find((x) => x.id === "headline-nova")
    const scale = orig ? (rf.h * H) / orig.box.h : 1
    return { x: rf.x + rf.w / 2, y: rf.y + rf.h / 2, scale, rotationDeg: 0, boxWidth: rf.w }
  }, [U.doc, fmt, principal, st, H])

  const start = (e: React.PointerEvent, id: string, mode: Mode, cx: -1 | 1 = 1, cy: -1 | 1 = 1) => {
    if (e.button > 0) return
    e.stopPropagation()
    const d = decl(id)
    const L = layers.find((l) => l.id === id)
    const isVideo = d?.kind === "video"
    if (sel !== id) select(id)
    if (phone || ro || !d || !L || !canMove(d)) return
    if (d.kind === "caption") {
      // legenda: só sobe e desce; encaixa na posição original; grava um passo no desfazer por gesto
      const y0 = L.rect.y + L.rect.h / 2, hh = L.rect.h, sy = e.clientY, def = cap.def
      let moved = false
      e.preventDefault()
      const onMoveC = (ev: PointerEvent) => {
        const dyp = ev.clientY - sy
        if (!moved && Math.abs(dyp) < 3) return
        if (!moved) {
          moved = true
          s.begin(t("hist.move", { layer: label(id) }))
          setCapDrag(true)
        }
        let yc = clamp(y0 + dyp / k / H, hh / 2, Math.max(hh / 2, 1 - hh / 2))
        const snapped = def !== null && Math.abs(yc - def) < SNAP
        if (snapped) yc = def
        setCapSnap(snapped)
        s.live((doc) => setCaptionY(doc, fmt, principal, snapped ? null : yc))
      }
      const onUpC = () => {
        window.removeEventListener("pointermove", onMoveC)
        window.removeEventListener("pointerup", onUpC)
        window.removeEventListener("pointercancel", onUpC)
        setCapDrag(false)
        setCapSnap(false)
      }
      window.addEventListener("pointermove", onMoveC)
      window.addEventListener("pointerup", onUpC)
      window.addEventListener("pointercancel", onUpC)
      return
    }
    if (mode === "move" && !d.editable.move) return
    if (mode !== "move" && !d.editable.resize) return
    const fr = frameEl.current?.getBoundingClientRect()
    if (!fr) return
    e.preventDefault()
    const gm = geoMode(st, d)
    const t0 = gm.mode === "transform" ? transformFrom(id, L.rect) : null
    const ccx = fr.left + (L.rect.x + L.rect.w / 2) * W * k
    const ccy = fr.top + (L.rect.y + L.rect.h / 2) * H * k
    drag.current = { id, mode, cx, cy, sx: e.clientX, sy: e.clientY, moved: false, r0: { ...L.rect }, t0, ccx, ccy, d0: Math.hypot(e.clientX - ccx, e.clientY - ccy) || 1 }
    const onMove = (ev: PointerEvent) => {
      const g = drag.current
      if (!g) return
      const dxp = ev.clientX - g.sx
      const dyp = ev.clientY - g.sy
      if (!g.moved && Math.hypot(dxp, dyp) < 3) return
      if (!g.moved) {
        g.moved = true
        s.begin(t(g.mode === "move" ? "hist.move" : "hist.resize", { layer: label(g.id) }))
      }
      const dx = dxp / k / W
      const dy = dyp / k / H
      const r0 = g.r0
      let next: { transform?: LayerTransform; rect?: Rect } = {}
      const sn: { v?: boolean; h?: boolean } = {}
      if (g.mode === "move") {
        let x = r0.x + dx
        let y = r0.y + dy
        if (!ev.altKey) {
          const th = 7 / k
          if (Math.abs((x + r0.w / 2) * W - W / 2) < th) { x = 0.5 - r0.w / 2; sn.v = true }
          if (Math.abs((y + r0.h / 2) * H - H / 2) < th) { y = 0.5 - r0.h / 2; sn.h = true }
        }
        x = isVideo ? clamp(x, 0, 1 - r0.w) : clamp(x, -0.25, 1.25 - r0.w)
        y = isVideo ? clamp(y, 0, 1 - r0.h) : clamp(y, -0.25, 1.25 - r0.h)
        if (g.t0) next = { transform: { ...g.t0, x: x + r0.w / 2, y: y + r0.h / 2 } }
        else next = { rect: { x, y, w: r0.w, h: r0.h } }
        setReadout(`X ${Math.round(x * W)} · Y ${Math.round(y * H)}`)
      } else if (g.mode === "side" && g.t0) {
        const bw = clamp(g.t0.boxWidth + (2 * dx * g.cx), 0.1, 1.5)
        next = { transform: { ...g.t0, boxWidth: bw } }
        setReadout(`W ${Math.round(bw * W)}`)
      } else if (g.t0) {
        const f = Math.hypot(ev.clientX - g.ccx, ev.clientY - g.ccy) / g.d0
        next = { transform: { ...g.t0, scale: clamp(g.t0.scale * f, 0.25, 4), boxWidth: clamp(g.t0.boxWidth * f, 0.1, 1.5) } }
        setReadout(`${Math.round(clamp(g.t0.scale * f, 0.25, 4) * 100)}%`)
      } else {
        const uniform = geoMode(st, d).uniform
        let w = Math.max(0.03, r0.w + dx * g.cx)
        let h = Math.max(0.02, r0.h + dy * g.cy)
        if (uniform) {
          const f = Math.max(0.1, (w / r0.w + h / r0.h) / 2)
          w = r0.w * f
          h = r0.h * f
        }
        const ax = g.cx > 0 ? r0.x : r0.x + r0.w
        const ay = g.cy > 0 ? r0.y : r0.y + r0.h
        if (isVideo) {
          // the box stays inside the canvas: the corner opposite to the handle doesn't move
          w = clamp(w, LIMITES_DOC_V3.minBoxFrac, g.cx > 0 ? 1 - ax : ax)
          h = clamp(h, LIMITES_DOC_V3.minBoxFrac, g.cy > 0 ? 1 - ay : ay)
        }
        next = { rect: { x: g.cx > 0 ? ax : ax - w, y: g.cy > 0 ? ay : ay - h, w, h } }
        setReadout(`${Math.round(w * W)} × ${Math.round(h * H)}`)
      }
      setSnap(sn)
      s.live((doc) => (isVideo ? setVideoGeo(doc, fmt, principal, { box: clampVideoBox(next.rect ?? r0) }) : setGeometry(doc, g.id, fmt, principal, next)))
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      drag.current = null
      setSnap({})
      setReadout(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  // guides: face + protected caption band (from the guard, projected through layout.video.sourceRect) + app UI bands
  const src = st.source as AutoPieceSource
  const v = r?.layout.video ?? null
  const proj = (px: Rect): Rect | null => {
    if (!v) return null
    const sx = v.sourceRect.w / src.guard.source.width
    const sy = v.sourceRect.h / src.guard.source.height
    const a = { x: v.sourceRect.x + px.x * sx, y: v.sourceRect.y + px.y * sy, w: px.w * sx, h: px.h * sy }
    const x0 = Math.max(a.x, v.box.x), y0 = Math.max(a.y, v.box.y), x1 = Math.min(a.x + a.w, v.box.x + v.box.w), y1 = Math.min(a.y + a.h, v.box.y + v.box.h)
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
  }
  const faceSeg = src.guard?.faceTrack.find((x) => (x.role ?? "main") === "main" && x.faceInRegion.length)
  const facePx = faceSeg ? { x: faceSeg.region.x + faceSeg.faceInRegion[0].box.x * faceSeg.region.w, y: faceSeg.region.y + faceSeg.faceInRegion[0].box.y * faceSeg.region.h, w: faceSeg.faceInRegion[0].box.w * faceSeg.region.w, h: faceSeg.faceInRegion[0].box.h * faceSeg.region.h } : null
  const faceAny = facePx && st.manifest.clientImage ? proj(facePx) : null
  const faceR = guides ? faceAny : null
  const bandRs = guides && st.manifest.clientImage && v?.checksCaption !== false ? (src.guard?.protectedBands ?? []).map(proj).filter((x): x is Rect => !!x) : []
  const ui = UI_BANDS[fmt]
  const px = (rf: Rect) => ({ left: rf.x * W * k, top: rf.y * H * k, width: rf.w * W * k, height: rf.h * H * k })

  const showCover = !fontsReady || s.building
  const selBad = !!sel && badIds.has(sel)
  const capSel = selD?.kind === "caption" && !reframing
  const capWarnOn = cap.has && cap.warn.any && !capDrag
  const capRect = cap.layer?.rect ?? null
  const capText = capRect ? layers.find((l) => l.kind === "text" && l.rect.w > 0 && (() => {
    const y0 = Math.max(l.rect.y, capRect.y), y1 = Math.min(l.rect.y + l.rect.h, capRect.y + capRect.h)
    const x0 = Math.max(l.rect.x, capRect.x), x1 = Math.min(l.rect.x + l.rect.w, capRect.x + capRect.w)
    return x1 > x0 && (y1 - y0) / capRect.h > 0.15
  })()) ?? null : null
  const handles = !!selL && !!selD && !phone && !ro && canMove(selD) && selD.editable.resize
  const sideHandles = handles && !!selD && geoMode(st, selD).mode === "transform"
  const canReframe = !phone && !ro && selD?.kind === "video" && selD.editable.reframe

  return (
    <section ref={wrap} className={cn("stage", reframing && "reframing")} aria-label={t("canvas.aria")}>
      <div className="stage-head">
        {/* 16/11 (editor simples): sem "1080 × 1920" nem o seletor de guias; as guias aparecem sozinhas ao reenquadrar */}
        <span><b>{U.label("__template")}</b></span>
      </div>
      <LayerChips />
      {size ? (
        <div ref={frameEl} className={cn("viewport", reframing && "reframing", capDrag && "capdrag")} style={{ width: size.w, height: size.h }} onPointerDown={() => select(null)}>
          {fontsReady && r ? (
            <Player
              ref={(p) => {
                playerRef.current = p
                if (p && !mounted) setTimeout(() => setMounted(true), 0)
              }}
              component={r.component}
              inputProps={r.props}
              durationInFrames={r.meta.durationInFrames}
              fps={r.meta.fps}
              compositionWidth={r.meta.compositionWidth}
              compositionHeight={r.meta.compositionHeight}
              style={{ width: size.w, height: size.h }}
              controls={false}
              clickToPlay={false}
              doubleClickToFullscreen={false}
              spaceKeyToPlayOrPause={false}
              initiallyMuted
              loop
              acknowledgeRemotionLicense
            />
          ) : null}

          {guides ? (
            <>
              <div className="g-ui" style={{ top: 0, height: (ui.t / 1080) * W * k }}><span>{t("guides.appUi")}</span></div>
              <div className="g-ui" style={{ bottom: 0, height: (ui.b / 1080) * W * k }}><span>{t("guides.appUi")}</span></div>
              {faceR ? <div className="g-rect g-face" style={px(faceR)}><span>{t("guides.face")}</span></div> : null}
              {bandRs.map((b, i) => <div key={i} className="g-rect g-band" style={px(b)}><span>{t("guides.band")}</span></div>)}
            </>
          ) : null}

          {capSel && !guides ? (
            <>
              <div className="g-ui" style={{ top: 0, height: `${LEGENDA_FAIXA_SEGURA[fmt].top * 100}%` }}><span>{t("simples.cap.appUi")}</span></div>
              <div className="g-ui" style={{ bottom: 0, height: `${(1 - LEGENDA_FAIXA_SEGURA[fmt].bottom) * 100}%` }}><span>{t("simples.cap.appUi")}</span></div>
            </>
          ) : null}
          {capWarnOn && cap.warn.face && faceAny && !guides ? <div className="g-rect g-warn" style={px(faceAny)}><span>{t("simples.cap.tagFace")}</span></div> : null}
          {capWarnOn && cap.warn.text && capText ? <div className="g-rect g-warn" style={px(capText.rect)}><span>{t("simples.cap.tagTitle")}</span></div> : null}
          {capDrag && cap.def !== null ? <i className="cap-orig" style={{ top: cap.def * H * k }}><span>{t("simples.cap.posHome")}</span></i> : null}
          {hits.map((l) => {
            const d = decl(l.id)
            const movable = !phone && !ro && !!d && canMove(d) && d.editable.move
            return (
              <button
                key={l.id}
                type="button"
                className={cn("hit", badIds.has(l.id) && "badL", movable && "move", d?.kind === "caption" && "capH")}
                style={px(l.rect)}
                onPointerDown={(e) => start(e, l.id, "move")}
                onDoubleClick={() => {
                  if (d?.kind !== "video" || !d.editable.reframe || phone || ro) return
                  select(l.id)
                  setReframing(true)
                }}
                aria-label={label(l.id)}
                aria-pressed={sel === l.id}
              />
            )
          })}

          {selL && reframing ? <Reframer k={k} frameEl={frameEl} setSnap={setSnap} setReadout={setReadout} /> : null}

          {selL && !reframing ? (
            <div className={cn("sel", selBad && "bad", selD?.kind === "caption" && "capsel", capWarnOn && "warn", selD?.kind === "burned" && "lockd")} style={px(selL.rect)}>
              <span className="tagx">{selD?.kind === "burned" ? t("simples.cap.burnedChip") : label(selL.id)}</span>
              {selD?.kind === "caption" && !phone && !ro ? <i className="capgrip" title={t("simples.cap.grip")} onPointerDown={(e) => start(e, selL.id, "move")}><EdIcon name="up" /><EdIcon name="down" /></i> : null}
              {canReframe ? (
                <button type="button" className="rf-cta" onPointerDown={(e) => e.stopPropagation()} onClick={() => setReframing(true)}>
                  {t("reframe.cta")}
                </button>
              ) : null}
              {handles ? (
                <>
                  {([["nw", -1, -1], ["ne", 1, -1], ["sw", -1, 1], ["se", 1, 1]] as const).map(([h, cx, cy]) => (
                    <i key={h} className="hd" data-h={h} onPointerDown={(e) => start(e, selL.id, "corner", cx, cy)} />
                  ))}
                  {sideHandles ? (
                    <>
                      <i className="hd" data-h="w" onPointerDown={(e) => start(e, selL.id, "side", -1)} />
                      <i className="hd" data-h="e" onPointerDown={(e) => start(e, selL.id, "side", 1)} />
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          {capSnap ? <span className="capchip" style={{ right: 6, top: (cap.def ?? 0.5) * H * k + 4 }}>{t("simples.cap.snap")}</span> : null}
          {snap.v ? <i className="g-center" style={{ left: ((reframing && v ? v.box.x + v.box.w / 2 : 0.5) * W) * k }} /> : null}
          {snap.h ? <i className="g-mid" style={{ top: ((reframing && v ? v.box.y + v.box.h / 2 : 0.5) * H) * k }} /> : null}
          {readout && selL ? <span className="readout" style={{ left: (selL.rect.x + selL.rect.w / 2) * W * k, top: Math.max(2, selL.rect.y * H * k - 40) }}>{readout}</span> : null}

          {showCover ? (
            <div className="cover" role="status">
              <b>{t("cover.title")}</b>
              <span>{t("cover.body")}</span>
              <div className="row done"><i />{t("cover.piece")}</div>
              <div className={cn("row", s.building ? "now" : "done")}><i />{t("cover.proxy", { s: st.proxy.etaSec ?? 4 })}</div>
              <div className={cn("row", fontsReady ? "done" : s.building ? "" : "now")}><i />{t("cover.fonts")}</div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="ctrl">
        <button type="button" className="ibtn" onClick={U.togglePlay} aria-label={playing ? t("pause") : t("play")}>
          {playing ? (
            <svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
          )}
        </button>
        <Scrub dur={dur} />
        <span className="time">{timecode(time)} / {timecode(dur)}</span>
        <button
          type="button"
          className="ibtn"
          aria-label={muted ? t("soundOn") : t("mute")}
          onClick={() => {
            const p = playerRef.current
            if (!p) return
            if (muted) p.unmute()
            else p.mute()
            setMuted(!muted)
          }}
        >
          <svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />{muted ? <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : null}</svg>
        </button>
      </div>
      <Pills capDrag={capDrag} />
    </section>
  )
}

/**
 * Reframe mode (§7.4 desktop only): the box gets a dashed lime outline, the cropped part of the video shows as a ghost, dragging
 * inside the box pans, the wheel / pinch / corners zoom. Everything goes to `video.framing`; the picture comes from the resolver.
 */
function Reframer({ k, frameEl, setSnap, setReadout }: {
  k: number
  frameEl: React.RefObject<HTMLDivElement | null>
  setSnap: (v: { v?: boolean; h?: boolean }) => void
  setReadout: (v: string | null) => void
}) {
  const { t, s, r, fmt, principal, time, setReframing, issues } = useU()
  const v = r?.layout.video
  const W = r?.layout.canvas.width ?? 1080
  const H = r?.layout.canvas.height ?? 1920
  const latest = useRef({ r, fmt, principal })
  useEffect(() => {
    latest.current = { r, fmt, principal }
  })
  const zoomEnd = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d0: number; z0: number } | null>(null)
  const drag = useRef<{ sx: number; sy: number; moved: boolean; f0: VideoFraming } | null>(null)

  const now = useCallback((d: EditDocV3) => {
    const c = latest.current
    return framingNow(c.r, d, c.fmt, c.principal)
  }, [])
  const put = useCallback((d: EditDocV3, f: VideoFraming) => {
    const c = latest.current
    return setVideoGeo(d, c.fmt, c.principal, { framing: clampFraming(f) })
  }, [])
  const hist = t("hist.reframe")

  // wheel + trackpad pinch (ctrlKey): React's onWheel is passive, and the page must not scroll here
  useEffect(() => {
    const el = frameEl.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
      s.typing("reframe:zoom", hist, (d) => {
        const c = now(d)
        const zoom = clamp(c.zoom * f, 0.5, 3)
        setReadout(`${zoom.toFixed(2)}×`)
        return put(d, { ...c, zoom })
      })
      if (zoomEnd.current) clearTimeout(zoomEnd.current)
      zoomEnd.current = setTimeout(() => {
        s.endTyping()
        setReadout(null)
      }, 400)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [frameEl, s, hist, now, put, setReadout])

  // the ghost plays the same second as the Player
  const ghost = useRef<HTMLVideoElement>(null)
  const srcSec = time + (v?.trim.inSec ?? 0)
  useEffect(() => {
    const el = ghost.current
    if (el && Math.abs(el.currentTime - srcSec) > 0.12) el.currentTime = srcSec
  }, [srcSec])

  if (!v) return null
  const px = (rf: { x: number; y: number; w: number; h: number }) => ({ left: rf.x * W * k, top: rf.y * H * k, width: rf.w * W * k, height: rf.h * H * k })
  const sr = px(v.sourceRect)
  const bx = px(v.box)
  // the ghost only draws what the box crops: a hole with the box's shape, in the ghost's own coordinates
  const hx = bx.left - sr.left
  const hy = bx.top - sr.top
  const hole = `path(evenodd, "M0 0H${sr.width}V${sr.height}H0Z M${hx} ${hy}H${hx + bx.width}V${hy + bx.height}H${hx}Z")`
  const url = videoUrlOf(r)
  const cut = issues.some((i) => i.rule === "caption_cut" || i.rule === "face_cut")

  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.button > 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const d0 = s.doc ? now(s.doc).zoom : 1
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: d0 }
      drag.current = null
      return
    }
    drag.current = { sx: e.clientX, sy: e.clientY, moved: false, f0: s.doc ? now(s.doc) : { fit: "cover", zoom: 1, panX: 0, panY: 0 } }
  }
  const drag2 = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const z = clamp((pinch.current.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d0, 0.5, 3)
      s.typing("reframe:zoom", hist, (d) => put(d, { ...now(d), zoom: z }))
      setReadout(`${z.toFixed(2)}×`)
      return
    }
    const g = drag.current
    if (!g) return
    const dxp = e.clientX - g.sx
    const dyp = e.clientY - g.sy
    if (!g.moved && Math.hypot(dxp, dyp) < 3) return
    if (!g.moved) {
      g.moved = true
      s.begin(hist)
    }
    let panX = g.f0.panX + dxp / k / W
    let panY = g.f0.panY + dyp / k / H
    const sn: { v?: boolean; h?: boolean } = {}
    if (!e.altKey) {
      if (Math.abs(panX) * W * k < 7) { panX = 0; sn.v = true }
      if (Math.abs(panY) * H * k < 7) { panY = 0; sn.h = true }
    }
    setSnap(sn)
    setReadout(`${Math.round(panX * W)} · ${Math.round(panY * H)}`)
    s.live((d) => put(d, { ...g.f0, panX, panY }))
  }
  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2 && pinch.current) {
      pinch.current = null
      s.endTyping()
    }
    if (!pointers.current.size) drag.current = null
    setSnap({})
    setReadout(null)
  }
  const startZoom = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button > 0 || !s.doc) return
    e.preventDefault()
    const fr = frameEl.current?.getBoundingClientRect()
    if (!fr) return
    const cx = fr.left + bx.left + bx.width / 2
    const cy = fr.top + bx.top + bx.height / 2
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1
    const f0 = now(s.doc)
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const z = clamp((f0.zoom * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0, 0.5, 3)
      if (!moved) {
        moved = true
        s.begin(hist)
      }
      setReadout(`${z.toFixed(2)}×`)
      s.live((d) => put(d, { ...f0, zoom: z }))
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      setReadout(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  return (
    <>
      {url ? (
        <div className="rf-ghost" style={{ ...sr, clipPath: hole }} aria-hidden="true">
          <video ref={ghost} src={url} muted playsInline preload="auto" />
        </div>
      ) : null}
      <div className="rf-ghost-edge" style={sr} aria-hidden="true" />
      <div className="rf-cap" style={bx} onPointerDown={startPan} onPointerMove={drag2} onPointerUp={endPan} onPointerCancel={endPan} />
      <div className={cn("sel reframe", cut && "bad")} style={bx}>
        <span className="tagx">{t("reframe.tag")}</span>
        {(["nw", "ne", "sw", "se"] as const).map((h) => <i key={h} className="hd" data-h={h} onPointerDown={startZoom} />)}
      </div>
      <div className="rf-hint" onPointerDown={(e) => e.stopPropagation()}>
        <span>{t("reframe.hint")}</span>
        <button type="button" className="btn sm" onClick={() => setReframing(false)}>{t("reframe.done")}</button>
      </div>
    </>
  )
}

function Scrub({ dur }: { dur: number }) {
  const { time, seek, t } = useU()
  const el = useRef<HTMLDivElement>(null)
  const down = useRef(false)
  const go = (x: number) => {
    const r = el.current?.getBoundingClientRect()
    if (r) seek(clamp((x - r.left) / r.width, 0, 1) * dur)
  }
  const pct = `${clamp(time / dur, 0, 1) * 100}%`
  return (
    <div
      ref={el}
      className="scrub"
      role="slider"
      tabIndex={0}
      aria-label={t("timeAria")}
      aria-valuemin={0}
      aria-valuemax={Math.round(dur * 10) / 10}
      aria-valuenow={Math.round(time * 10) / 10}
      onPointerDown={(e) => {
        down.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        go(e.clientX)
      }}
      onPointerMove={(e) => down.current && go(e.clientX)}
      onPointerUp={() => (down.current = false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") seek(time + 0.5)
        if (e.key === "ArrowLeft") seek(time - 0.5)
      }}
    >
      <div className="rail2" />
      <div className="prog" style={{ width: pct }} />
      <div className="head" style={{ left: pct }} />
    </div>
  )
}

/**
 * 16/11 (editor simples): no lugar das pílulas, UMA faixa de aviso só quando há problema, com o conserto num clique.
 * Legenda/rosto cortados só avisam (dá pra baixar); texto que não cabe ainda trava o download.
 */
function Pills({ capDrag }: { capDrag: boolean }) {
  const { issues, t, select, s, fmt, principal, ro, cap, sel, tab, setTab, decl, st } = useU()
  const de = (k: ReturnType<typeof pillOf>) => issues.filter((i) => pillOf(i) === k)
  const capw = de("capwarn")
  const texto = de("text"), legenda = de("caption"), rosto = de("face"), numero = de("numbers")
  const enquadrar = () => s.commit(t("hist.autoReframe"), (d) => setVideoGeo(d, fmt, principal, { framing: null }))
  const corte = legenda.some((i) => i.rule === "caption_cut") || rosto.some((i) => i.rule === "face_cut")
  const verEnq = () => {
    setTab("video")
    const v = st.manifest.layers.find((l) => l.kind === "video" && l.editable.reframe)?.id
    if (v) select(v, true)
  }
  const capMsg = capw.some((i) => i.rule === "caption_over_face") && capw.some((i) => i.rule === "caption_over_text") ? t("simples.cap.warnBoth")
    : capw.some((i) => i.rule === "caption_over_face") ? t("simples.cap.warnFace") : capw.some((i) => i.rule === "caption_over_text") ? t("simples.cap.warnText") : t("simples.cap.warnSafe")
  const burnedInfo = sel && decl(sel)?.kind === "burned" && tab === "estilo"
  if (capDrag) return null
  const item = texto[0] ? { tom: "bad", msg: t("simples.avisoTexto"), acao: [t("simples.verTexto"), () => texto[0].layerId && select(texto[0].layerId, true)] as const }
    : capw[0] && cap.has ? { tom: "warn", msg: capMsg, acao: [t("simples.cap.home"), cap.home] as const }
      : burnedInfo ? { tom: "info", msg: t("simples.cap.burnedInfo"), acao: [t("simples.cap.goFraming"), verEnq] as const }
        : legenda[0] ? { tom: "warn", msg: t("simples.avisoCaption"), acao: corte ? [t("simples.enquadrarSozinho"), enquadrar] as const : legenda[0].layerId ? [t("simples.verTexto"), () => select(legenda[0].layerId!, true)] as const : null }
          : rosto[0] ? { tom: "warn", msg: t("simples.avisoFace"), acao: corte ? [t("simples.enquadrarSozinho"), enquadrar] as const : rosto[0].layerId ? [t("simples.verTexto"), () => select(rosto[0].layerId!, true)] as const : null }
            : numero[0] ? { tom: "warn", msg: t("simples.avisoNumero"), acao: numero[0].layerId ? [t("simples.verTexto"), () => select(numero[0].layerId!, true)] as const : null }
              : null
  if (!item) return null
  return (
    <div className={cn("aviso1", item.tom)} role="status" aria-live="polite">
      <p>{item.msg}</p>
      {item.acao ? <button type="button" className="btn sm" disabled={ro} onClick={item.acao[1]}>{item.acao[0]}</button> : null}
    </div>
  )
}
