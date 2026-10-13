"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Player } from "@remotion/player"
import { Criativo, carregarFontes } from "@maquina/video/player"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useEd } from "./context"
import { EdIcon } from "./ed-icon"
import { LAYER_KEYS, SAFE, clamp, timecode, type LayerKey, type WordView } from "./model"

/** Layer box measured in the Player's DOM (composition px, before scale/rotation). Center = outer box center (= x·W, y·H). */
interface M { cx: number; cy: number; uw: number; uh: number; dx: number; dy: number }
type Mode = "move" | "scale" | "width" | "rot"
interface Drag {
  key: LayerKey; mode: Mode; side: "e" | "w" | null; sx: number; sy: number; moved: boolean
  base: { x: number; y: number; scale: number; rotationDeg: number; boxWidth: number }
  m: M; ccx: number; ccy: number; a0: number; d0: number; word: WordView | null; pointerId: number
}
type Guide = { v?: number; h?: number; safe?: boolean }

const rot = (x: number, y: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as const
}

/**
 * The positioned div of each layer, marked by @maquina/video (`data-layer="hook|caption|cta"`; RemixKeep in F3:
 * `data-layer="<textLayer.id>"`). It has px `top`, % `translate`, `scale` and `rotate`; it only exists in the frames
 * where the layer shows. hook/caption: the div is the boxWidth wide, centered on (x, y). cta: the div is a canvas-wide
 * band centered on x and the pill is its FIRST CHILD (maxWidth = boxWidth).
 */
function findLayerEls(host: HTMLElement) {
  const out: Partial<Record<LayerKey, HTMLElement>> = {}
  for (const key of LAYER_KEYS) {
    const el = host.querySelector<HTMLElement>(`[data-layer="${key}"]`)
    if (el) out[key] = el
  }
  return out
}
/** Selection box = what you see: the hook block, the caption words (or their background block), the CTA pill. */
function measureEl(el: HTMLElement, key: LayerKey): M {
  const pill = key === "cta" ? (el.firstElementChild as HTMLElement | null) : null
  const kids = pill ? [pill] : ([...el.children] as HTMLElement[])
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const k of kids.length ? kids : [el]) {
    const l = kids.length ? k.offsetLeft : 0
    const tp = kids.length ? k.offsetTop : 0
    x0 = Math.min(x0, l); y0 = Math.min(y0, tp); x1 = Math.max(x1, l + k.offsetWidth); y1 = Math.max(y1, tp + k.offsetHeight)
  }
  const ow = el.offsetWidth
  const oh = el.offsetHeight
  return { cx: el.offsetLeft + ow / 2, cy: el.offsetTop, uw: x1 - x0, uh: y1 - y0, dx: (x0 + x1) / 2 - ow / 2, dy: (y0 + y1) / 2 - oh / 2 }
}

export function Stage({ onFrame, onPlaying }: { onFrame: (f: number) => void; onPlaying: (p: boolean) => void }) {
  const E = useEd()
  const { t, props, meta, layers, sel, select, phone, ui, setUi, act, playerRef, work, cenasSec, time, lines, lname, playing } = E
  const W = meta.compositionWidth
  const H = meta.compositionHeight
  const vp = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const frameEl = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [meas, setMeas] = useState<Partial<Record<LayerKey, M>>>({})
  const [shown, setShown] = useState<LayerKey[]>([])
  const [words, setWords] = useState<{ x: number; y: number; w: number; h: number; i: number; text: string }[]>([])
  const els = useRef<Partial<Record<LayerKey, HTMLElement>>>({})
  const drag = useRef<Drag | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [readout, setReadout] = useState<string | null>(null)
  const [shake, setShake] = useState<LayerKey | null>(null)

  // spec §5: the Player mounts after the fonts (otherwise it measures/paints with the fallback)
  useEffect(() => {
    let alive = true
    Promise.all([carregarFontes(), document.fonts.ready]).finally(() => alive && setFontsReady(true))
    return () => {
      alive = false
    }
  }, [])

  // frame size = what fits in the viewport (CapCut style)
  useLayoutEffect(() => {
    const el = vp.current
    if (!el) return
    const fit = () => {
      const pw = el.clientWidth - (phone ? 28 : 72)
      const ph = el.clientHeight - (phone ? 24 : 56)
      const h = Math.max(120, Math.min(ph, (pw * H) / W))
      setSize({ w: Math.round((h * W) / H), h: Math.round(h) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H, phone])
  const k = size ? size.w / W : 1

  // Player events → playhead
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

  const capOn = !!sel && sel.k === "caption"

  const measure = useCallback(() => {
    const h = host.current
    if (!h) return
    const found = findLayerEls(h)
    els.current = found
    const next: Partial<Record<LayerKey, M>> = {}
    for (const key of LAYER_KEYS) {
      const el = found[key]
      if (el) next[key] = measureEl(el, key)
    }
    setMeas((prev) => {
      const merged = { ...prev, ...next }
      return JSON.stringify(merged) === JSON.stringify(prev) ? prev : merged
    })
    const keys = LAYER_KEYS.filter((x) => !!found[x])
    setShown((prev) => (prev.join() === keys.join() ? prev : keys))
    // caption words under the pointer (fix a word by clicking it on the preview)
    const cap = found.caption
    const fr = frameEl.current?.getBoundingClientRect()
    if (cap && fr && capOn) {
      const spans = [...cap.querySelectorAll("span")].filter((s) => s.children.length === 0 && (s.textContent ?? "").trim())
      const list = spans.map((s, i) => {
        const r = s.getBoundingClientRect()
        return { x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height, i, text: (s.textContent ?? "").trim() }
      })
      setWords((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list))
    } else setWords((prev) => (prev.length ? [] : prev))
  }, [capOn])

  useEffect(() => {
    if (!mounted) return
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(measure)
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [mounted, props, time, size, measure])

  // map the rendered caption spans back to transcript words (same text sequence, nearest to the playhead)
  const flatWords = useMemo(() => lines.flatMap((l) => l.words).filter((w) => !w.cut && !w.hidden && w.abs !== null).sort((a, b) => a.abs! - b.abs!), [lines])
  const wordAt = useCallback((i: number): WordView | null => {
    const texts = words.map((w) => w.text)
    if (!texts.length) return null
    let best: number | null = null
    for (let a = 0; a + texts.length <= flatWords.length; a++) {
      if (texts.every((tx, j) => flatWords[a + j].text.trim() === tx) && (best === null || Math.abs(flatWords[a].abs! - time) < Math.abs(flatWords[best].abs! - time))) best = a
    }
    return best === null ? null : flatWords[best + i] ?? null
  }, [words, flatWords, time])

  // ── geometry on screen
  const z = SAFE[ui.plat]
  const nine16 = work.settings && props.format === "VERTICAL_9_16"
  const safeC = { l: z.l * W, r: W - z.r * W, t: z.t * H, b: H - z.b * H }
  const boxOf = (key: LayerKey) => {
    const m = meas[key]
    if (!m) return null
    const tr = layers[key].transform
    const s = tr.scale
    const [ox, oy] = rot(s * m.dx, s * m.dy, tr.rotationDeg)
    return { cx: m.cx + ox, cy: m.cy + oy, w: m.uw * s, h: m.uh * s, r: tr.rotationDeg }
  }
  const overSafe = (key: LayerKey) => {
    const b = boxOf(key)
    if (!b || !nine16) return 0
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => rot((a * b.w) / 2, (c * b.h) / 2, b.r))
    const xs = pts.map((p) => b.cx + p[0])
    const ys = pts.map((p) => b.cy + p[1])
    return Math.round(Math.max(safeC.l - Math.min(...xs), Math.max(...xs) - safeC.r, safeC.t - Math.min(...ys), Math.max(...ys) - safeC.b))
  }

  // ── drag (desktop): corner = scale, side = box width, top = rotate, body = move with snapping
  const start = (e: React.PointerEvent, key: LayerKey, mode: Mode, side: "e" | "w" | null = null, word: WordView | null = null) => {
    if (e.button > 0) return
    e.stopPropagation()
    const L0 = layers[key]
    if (phone) {
      select({ k: key })
      setUi({ sheet: key === "caption" ? "words" : "text", editWord: word?.key ?? null })
      return
    }
    const m = meas[key]
    const fr = frameEl.current?.getBoundingClientRect()
    if (!m || !fr) {
      select({ k: key })
      return
    }
    e.preventDefault()
    const base = L0.hasTransform ? { ...L0.transform } : { ...L0.transform, x: m.cx / W, y: m.cy / H }
    const ccx = fr.left + base.x * W * k
    const ccy = fr.top + base.y * H * k
    if (!sel || sel.k !== key) select({ k: key })
    drag.current = {
      key, mode, side, sx: e.clientX, sy: e.clientY, moved: false, base, m, ccx, ccy, word, pointerId: e.pointerId,
      a0: Math.atan2(e.clientY - ccy, e.clientX - ccx), d0: Math.hypot(e.clientX - ccx, e.clientY - ccy) || 1,
    }
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dxp = ev.clientX - d.sx
      const dyp = ev.clientY - d.sy
      if (!d.moved && Math.hypot(dxp, dyp) < 3) return
      if (!d.moved) {
        d.moved = true
        act.begin(t(`hist.${d.mode}` as never, { layer: lname(d.key) } as never))
        setUi({ dragging: true })
      }
      const b = d.base
      const g: Guide[] = []
      if (d.mode === "move") {
        let nx = b.x * W + dxp / k
        let ny = b.y * H + dyp / k
        if (ui.snap && !ev.altKey) {
          const th = 7 / k
          const s = b.scale
          const [ox, oy] = rot(s * d.m.dx, s * d.m.dy, b.rotationDeg)
          const hw = (d.m.uw * s) / 2
          const hh = (d.m.uh * s) / 2
          const ux = nx + ox
          const uy = ny + oy
          if (Math.abs(ux - W / 2) < th) { nx += W / 2 - ux; g.push({ v: W / 2 }) }
          else if (nine16 && Math.abs(ux - hw - safeC.l) < th) { nx += safeC.l + hw - ux; g.push({ v: safeC.l, safe: true }) }
          else if (nine16 && Math.abs(ux + hw - safeC.r) < th) { nx += safeC.r - hw - ux; g.push({ v: safeC.r, safe: true }) }
          if (Math.abs(uy - H / 2) < th) { ny += H / 2 - uy; g.push({ h: H / 2 }) }
          else if (nine16 && Math.abs(uy - hh - safeC.t) < th) { ny += safeC.t + hh - uy; g.push({ h: safeC.t, safe: true }) }
          else if (nine16 && Math.abs(uy + hh - safeC.b) < th) { ny += safeC.b - hh - uy; g.push({ h: safeC.b, safe: true }) }
        }
        act.layerLive(d.key, { transform: { ...b, x: nx / W, y: ny / H } })
        setReadout(`X ${Math.round(nx)} · Y ${Math.round(ny)}`)
      } else if (d.mode === "scale") {
        const f = Math.hypot(ev.clientX - d.ccx, ev.clientY - d.ccy) / d.d0
        const sc = clamp(Math.round(b.scale * f * 100) / 100, 0.25, 4)
        act.layerLive(d.key, { transform: { ...b, scale: sc } })
        setReadout(`${Math.round(sc * 100)}%`)
      } else if (d.mode === "width") {
        const a = (b.rotationDeg * Math.PI) / 180
        const along = ((dxp * Math.cos(a) + dyp * Math.sin(a)) / k) * (d.side === "w" ? -1 : 1)
        const bw = clamp(b.boxWidth + (2 * along) / W, 0.1, 1.5)
        act.layerLive(d.key, { transform: { ...b, boxWidth: bw } })
        setReadout(t("readBox", { px: Math.round(bw * W) }))
      } else {
        let r = b.rotationDeg + ((Math.atan2(ev.clientY - d.ccy, ev.clientX - d.ccx) - d.a0) * 180) / Math.PI
        r = ((r + 540) % 360) - 180
        if (ev.shiftKey) r = Math.round(r / 15) * 15
        else for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(r - s) < 3) r = s
        r = Math.round(r)
        act.layerLive(d.key, { transform: { ...b, rotationDeg: r } })
        if (r % 90 === 0) g.push({ v: b.x * W })
        setReadout(`${r}°`)
      }
      setGuides(g)
    }
    const onUp = () => {
      const d = drag.current
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      drag.current = null
      setGuides([])
      setReadout(null)
      if (d?.moved) setUi({ dragging: false })
      else if (d?.word) setUi({ editWord: d.word.key })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  const selKey = sel && sel.k !== "scene" && sel.k !== "end" ? sel.k : null
  const over = selKey && shown.includes(selKey) ? overSafe(selKey) : 0
  const warn = selKey && over > 2 ? t("unsafe", { layer: lname(selKey), plat: z.name, px: over }) : null
  const endShown = work.settings.endCard && time >= cenasSec - 1e-6

  useEffect(() => {
    if (!shake) return
    const tm = setTimeout(() => setShake(null), 340)
    return () => clearTimeout(tm)
  }, [shake])

  return (
    <>
      <div ref={vp} className="ed-viewport" aria-label={t("previewHint")} onPointerDown={() => select(null)}>
        {size ? (
          <div ref={frameEl} className="ed-frame" style={{ width: size.w, height: size.h }}>
            <div ref={host} className="ed-player">
              {fontsReady ? (
                <Player
                  ref={(r) => {
                    playerRef.current = r
                    if (r && !mounted) setTimeout(() => setMounted(true), 0)
                  }}
                  component={Criativo}
                  inputProps={props}
                  durationInFrames={meta.durationInFrames}
                  fps={meta.fps}
                  compositionWidth={W}
                  compositionHeight={H}
                  style={{ width: size.w, height: size.h }}
                  controls={false}
                  clickToPlay={false}
                  doubleClickToFullscreen={false}
                  spaceKeyToPlayOrPause={false}
                  moveToBeginningWhenEnded={false}
                  acknowledgeRemotionLicense
                />
              ) : (
                <span className="sk block size-full" />
              )}
            </div>

            {nine16 && (ui.safe || ui.dragging) ? (
              <div className={cn("ed-safe", ui.dragging && "strong")}>
                <i className="ed-sz" style={{ left: 0, right: 0, top: 0, height: `${z.t * 100}%` }} />
                <i className="ed-sz" style={{ left: 0, right: 0, bottom: 0, height: `${z.b * 100}%` }} />
                <i className="ed-sz" style={{ left: 0, top: `${z.t * 100}%`, bottom: `${z.b * 100}%`, width: `${z.l * 100}%` }} />
                <i className="ed-sz" style={{ right: 0, top: `${z.t * 100}%`, bottom: `${z.b * 100}%`, width: `${z.r * 100}%` }} />
                <i className="ed-safe-rect" style={{ left: `${z.l * 100}%`, right: `${z.r * 100}%`, top: `${z.t * 100}%`, bottom: `${z.b * 100}%` }} />
                <span className="ed-sz-lbl">{t("hiddenBy", { plat: z.name })}</span>
              </div>
            ) : null}

            {endShown ? (
              <div
                className={cn("ed-endsel", sel?.k === "end" && "sel")}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  select({ k: "end" })
                  if (phone) setUi({ sheet: "text" })
                }}
                aria-label={lname("end")}
              />
            ) : null}

            {LAYER_KEYS.map((key) => {
              const L0 = layers[key]
              const isSel = selKey === key
              const isShown = shown.includes(key)
              if (!L0.exists || !L0.visible || (!isShown && !isSel) || endShown) return null
              const b = boxOf(key)
              if (!b) return null
              const unsafe = isShown && overSafe(key) > 2
              return (
                <div
                  key={key}
                  className={cn("ed-hit", isSel && "sel", !isShown && "ghost", unsafe && "unsafe", phone && "nomove", shake === key && "ed-shake")}
                  style={{ left: (b.cx - b.w / 2) * k, top: (b.cy - b.h / 2) * k, width: b.w * k, height: b.h * k, rotate: `${b.r}deg` }}
                  onPointerDown={(e) => start(e, key, "move")}
                  role="button"
                  aria-label={lname(key)}
                  aria-pressed={isSel}
                >
                  {isSel && !phone ? (
                    <>
                      {(["nw", "ne", "sw", "se"] as const).map((c) => (
                        <i key={c} className={cn("ed-hd", c)} onPointerDown={(e) => start(e, key, "scale")} />
                      ))}
                      <i className="ed-hd w" title={t("boxWidth")} onPointerDown={(e) => start(e, key, "width", "w")} />
                      <i className="ed-hd e" title={t("boxWidth")} onPointerDown={(e) => start(e, key, "width", "e")} />
                      <i className="ed-hd rot" title={t("rotateTip")} onPointerDown={(e) => start(e, key, "rot")} />
                    </>
                  ) : null}
                </div>
              )
            })}

            {capOn && !ui.dragging && !playing
              ? words.map((w) => {
                  const wv = wordAt(w.i)
                  return (
                    <i
                      key={w.i}
                      className={cn("ed-word-hit", wv?.low && "low")}
                      style={{ left: w.x, top: w.y, width: w.w, height: w.h }}
                      title={t("clickToFix")}
                      data-word={wv?.key ?? ""}
                      data-text={w.text}
                      onPointerDown={(e) => start(e, "caption", "move", null, wv)}
                    />
                  )
                })
              : null}

            {guides.map((g, i) =>
              g.v !== undefined ? (
                <i key={i} className={cn("ed-gd v", g.safe && "safe-g")} style={{ left: g.v * k }} />
              ) : (
                <i key={i} className={cn("ed-gd h", g.safe && "safe-g")} style={{ top: (g.h ?? 0) * k }} />
              )
            )}
            {readout && selKey && boxOf(selKey) ? (
              <span className="ed-read" style={{ left: boxOf(selKey)!.cx * k, top: (boxOf(selKey)!.cy - boxOf(selKey)!.h / 2) * k - 18 }}>
                {readout}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="ed-stagebar">
        <Button variant="ghost" size="icon-sm" onClick={E.togglePlay} aria-label={playing ? t("pause") : t("play")} title={`${t("playPause")} (Space)`}>
          <EdIcon name={playing ? "pause" : "play"} />
        </Button>
        <span className="ed-tc">
          {timecode(time)} <span>/ {timecode(E.totalSec)}</span>
        </span>
        {warn ? (
          <span className="ed-warnchip">
            <EdIcon name="alert" />
            <span>{warn}</span>
          </span>
        ) : null}
        <span className="flex-1" />
        {nine16 ? (
          <>
            <Button variant="ghost" size="sm" aria-pressed={ui.safe} onClick={() => setUi({ safe: !ui.safe })} title={`${t("safeZones")} (G)`}>
              <EdIcon name="safe" />
              <span className="ed-hide-m">{t("safeZones")}</span>
            </Button>
            <div className="ed-seg" role="group" aria-label={t("platform")}>
              {(Object.keys(SAFE) as (keyof typeof SAFE)[]).map((p) => (
                <button key={p} type="button" aria-pressed={ui.plat === p} onClick={() => setUi({ plat: p })}>
                  {SAFE[p].name}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}

