"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Player } from "@remotion/player"
import { LIMITES_DOC_V3, carregarFontes, type RemixKeepProps } from "@maquina/video/player"
import type { AutoPieceSource, EditDocV3, EditIssue, LayerTransform, Rect, VideoFraming } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { useU } from "./context"
import { LayerChips } from "./layers"
import { baseOf, canMove, clamp, clampFraming, clampVideoBox, framingNow, geoMode, geometryOf, setGeometry, setVideoGeo, timecode, videoUrlOf } from "./model"

/** App UI bands (px of the 1080-wide canvas) per format, as in the approved prototype. */
const UI_BANDS: Record<string, { t: number; b: number }> = { "9x16": { t: 200, b: 340 }, "4x5": { t: 60, b: 110 }, "1x1": { t: 50, b: 50 } }
type Mode = "move" | "corner" | "side"
interface Drag {
  id: string; mode: Mode; cx: -1 | 1; cy: -1 | 1; sx: number; sy: number; moved: boolean
  r0: Rect; t0: LayerTransform | null; d0: number; ccx: number; ccy: number
}

/** Issue → which pill it lights (§5). */
export const pillOf = (i: EditIssue): "face" | "caption" | "text" | "numbers" | "contrast" | null =>
  i.rule === "face_covered" || i.rule === "face_cut" ? "face"
    : i.rule === "caption_covered" || i.rule === "caption_cut" ? "caption"
      : i.rule === "text_overflow" || i.rule === "too_long" ? "text"
        : i.rule === "invented_number" ? "numbers" : i.rule === "low_contrast" ? "contrast" : null

export function Canvas({ onFrame, onPlaying }: { onFrame: (f: number) => void; onPlaying: (p: boolean) => void }) {
  const U = useU()
  const { t, st, r, sel, select, phone, ro, decl, label, s, fmt, principal, issues, playerRef, guides, setGuides, time, playing, reframing, setReframing, seek } = U
  const wrap = useRef<HTMLElement>(null)
  const frameEl = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [muted, setMuted] = useState(true)
  const [snap, setSnap] = useState<{ v?: boolean; h?: boolean }>({})
  const [readout, setReadout] = useState<string | null>(null)
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
      if (!(e.target as Element | null)?.closest?.(".viewport, .ctrl, .panel, .tl, .stage-head")) setReframing(false)
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
      const maxH = phone ? window.innerHeight * 0.58 : Math.max(380, window.innerHeight - 330)
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
  }, [W, H, phone])
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
  const faceR = guides && facePx && st.manifest.clientImage ? proj(facePx) : null
  const bandRs = guides && st.manifest.clientImage && v?.checksCaption !== false ? (src.guard?.protectedBands ?? []).map(proj).filter((x): x is Rect => !!x) : []
  const ui = UI_BANDS[fmt]
  const px = (rf: Rect) => ({ left: rf.x * W * k, top: rf.y * H * k, width: rf.w * W * k, height: rf.h * H * k })

  const showCover = !fontsReady || s.building
  const selBad = !!sel && badIds.has(sel)
  const handles = !!selL && !!selD && !phone && !ro && canMove(selD) && selD.editable.resize
  const sideHandles = handles && !!selD && geoMode(st, selD).mode === "transform"
  const canReframe = !phone && !ro && selD?.kind === "video" && selD.editable.reframe

  return (
    <section ref={wrap} className={cn("stage", reframing && "reframing")} aria-label={t("canvas.aria")}>
      <div className="stage-head">
        <span>
          <b>{U.label("__template")}</b> · <span>{W} × {H}</span>
        </span>
        <div className="seg tight" role="group" aria-label={t("guides.aria")}>
          <button type="button" aria-pressed={!guides} onClick={() => setGuides(false)}>{t("guides.off")}</button>
          <button type="button" aria-pressed={guides} onClick={() => setGuides(true)}>{t("guides.on")}</button>
        </div>
      </div>
      <LayerChips />
      {size ? (
        <div ref={frameEl} className={cn("viewport", reframing && "reframing")} style={{ width: size.w, height: size.h }} onPointerDown={() => select(null)}>
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

          {hits.map((l) => {
            const d = decl(l.id)
            const movable = !phone && !ro && !!d && canMove(d) && d.editable.move
            return (
              <button
                key={l.id}
                type="button"
                className={cn("hit", badIds.has(l.id) && "badL", movable && "move")}
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
            <div className={cn("sel", selBad && "bad")} style={px(selL.rect)}>
              <span className="tagx">{label(selL.id)}</span>
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
      <Pills />
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

/** Live checks under the canvas (§5): red = blocks the Export (click selects the culprit), amber = confirm the number. */
function Pills() {
  const { issues, st, t, select, label, r } = useU()
  const src = st.source as AutoPieceSource
  const hasFace = st.manifest.clientImage && (src.guard?.faceTrack ?? []).some((x) => (x.role ?? "main") === "main" && x.faceInRegion.length)
  const hasBand = st.manifest.clientImage && r?.layout.video?.checksCaption !== false && (src.guard?.protectedBands ?? []).length > 0
  const pill = (key: "face" | "caption" | "text" | "numbers" | "contrast", name: string) => {
    const list = issues.filter((i) => pillOf(i) === key)
    if (!list.length) return key === "contrast" ? null : <span key={key} className="chk"><i /><span>{name}</span></span>
    const o = list[0]
    const msg = t(`issue.${o.rule}` as never, { layer: o.layerId ? label(o.layerId) : "", n: (o.detail?.numbers ?? [])[0] ?? "", chars: o.detail?.chars ?? 0, max: o.detail?.maxChars ?? 0 } as never)
    return (
      <button key={key} type="button" className={cn("chk", o.level === "block" ? "bad" : "warn")} onClick={() => o.layerId && select(o.layerId, true)}>
        <i />
        <span>{msg}{list.length > 1 ? ` · +${list.length - 1}` : ""}</span>
      </button>
    )
  }
  return (
    <div className="checks" aria-live="polite">
      {!st.manifest.clientImage ? <span className="chk info"><i /><span>{t("pill.noPicture")}</span></span> : null}
      {hasFace ? pill("face", t("pill.face")) : null}
      {hasBand ? pill("caption", t("pill.caption")) : null}
      {pill("text", t("pill.text"))}
      {pill("numbers", t("pill.numbers"))}
      {pill("contrast", t("pill.contrast"))}
    </div>
  )
}
