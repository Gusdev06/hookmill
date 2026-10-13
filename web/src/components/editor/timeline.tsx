"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useEd } from "./context"
import { EdIcon, type EdIconName } from "./ed-icon"
import { FPS, MIN_CLIP_SEC, clamp, deleteBlock, minClipFor, timecode, toFrame, type LayerKey } from "./model"

const PAD = 12
type TDrag = { kind: "scene" | LayerKey; id?: string; side: "l" | "r"; moved: boolean; orig: { a: number; b: number } }
type RDrag = { id: string; dx: number; moved: boolean; target: number }

/** Multi-track timeline (spec §2.6-§2.10): ruler, scenes (magnetic main track), hook, captions, CTA, end card. */
export function Timeline() {
  const E = useEd()
  const { t, ui, setUi, phone, placed, clips, layers, sel, select, time, seek, totalSec, cenasSec, act, work, lines, lname, sec } = E
  const Z = phone ? Math.min(ui.zoom, 24) : ui.zoom
  const laneW = Math.ceil(Math.max(totalSec + 4, phone ? 14 : 30) * Z + PAD * 2)
  const scroll = useRef<HTMLDivElement>(null)
  const [td, setTd] = useState<TDrag | null>(null)
  const [rd, setRd] = useState<RDrag | null>(null)
  const [snapT, setSnapT] = useState<number | null>(null)
  const deleted = clips.filter((c) => !c.enabled)
  const isScene = sel?.k === "scene"
  const delWhy = sel?.k === "scene" ? deleteBlock(placed, sel.id) : null

  const xToSec = (clientX: number) => {
    const lane = scroll.current?.querySelector<HTMLElement>(".ed-lane")
    if (!lane) return 0
    return (clientX - lane.getBoundingClientRect().left - PAD) / Z
  }
  const snapTime = (v: number, ignore: LayerKey | null) => {
    if (!ui.snap) return { v: toFrame(v), s: null as number | null }
    const th = 8 / Z
    const c = [0, time, cenasSec, ...placed.map((p) => p.end)]
    for (const k of ["hook", "caption", "cta"] as LayerKey[]) if (k !== ignore && layers[k].exists) c.push(layers[k].from, layers[k].to)
    let best: number | null = null
    for (const x of c) if (Math.abs(x - v) < th && (best === null || Math.abs(x - v) < Math.abs(best - v))) best = x
    return best === null ? { v: toFrame(v), s: null } : { v: best, s: best }
  }

  const track = (e: React.PointerEvent, onMove: (dx: number, ev: PointerEvent) => void, onUp: (moved: boolean) => void, threshold = 3) => {
    const x0 = e.clientX
    let moved = false
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0
      if (!moved && Math.abs(dx) < threshold) return
      moved = true
      onMove(dx, ev)
    }
    const up = () => {
      window.removeEventListener("pointermove", mv)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      onUp(moved)
    }
    window.addEventListener("pointermove", mv)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  // ── scenes: trim by the edges (min 0.3 s), drag to reorder
  const sceneEdge = (e: React.PointerEvent, id: string, side: "l" | "r") => {
    e.stopPropagation()
    e.preventDefault()
    const c0 = clips.find((c) => c.sceneId === id)!
    const dur = E.src.scenes.find((s) => s.sceneId === id)!.durationSec
    // ≥ 0.3 s per scene and ≥ 1 s of video (validarDoc): the edge stops there and says why
    const min = minClipFor(placed, id)
    const tooShort = (len: number) => {
      if (len < min - 1e-6) E.notify(t(min > MIN_CLIP_SEC + 1e-6 ? "toast.minVideo" : "toast.minClip"), false, "ed-min")
    }
    let begun = false
    setTd({ kind: "scene", id, side, moved: false, orig: { a: c0.inSec, b: c0.outSec } })
    track(e, (dx) => {
      if (!begun) {
        begun = true
        act.begin(t("hist.trim", { n: (E.src.scenes.find((s) => s.sceneId === id)?.index ?? 0) + 1 }))
      }
      const dt = dx / Z
      const next = side === "l"
        ? { inSec: toFrame(clamp(c0.inSec + dt, 0, c0.outSec - min)) }
        : { outSec: toFrame(clamp(c0.outSec + dt, c0.inSec + min, dur)) }
      tooShort(side === "l" ? c0.outSec - (c0.inSec + dt) : c0.outSec + dt - c0.inSec)
      act.clipsLive(clips.map((c) => (c.sceneId === id ? { ...c, ...next } : c)))
      setTd((d) => (d ? { ...d, moved: true } : d))
    }, (moved) => {
      setTd(null)
      if (!moved) return
      // captions that left with the cut speech (spec §2.9)
      const cut = lines.filter((l) => l.sceneId === id && l.cut).length
      if (cut) E.notify(t("toast.linesCut", { n: cut }), true)
    }, 1)
  }
  const sceneBody = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    select({ k: "scene", id }, true)
    if (phone) return
    const me = placed.find((p) => p.scene.sceneId === id)
    if (!me) return
    let target = me.pos
    track(e, (dx) => {
      const cx = (me.start + me.dur / 2) * Z + dx
      const others = placed.filter((p) => p.scene.sceneId !== id)
      let acc = 0
      target = 0
      others.forEach((p, j) => {
        if ((acc + p.dur / 2) * Z < cx) target = j + 1
        acc += p.dur
      })
      setRd({ id, dx, moved: true, target })
    }, (moved) => {
      setRd(null)
      if (moved && target !== me.pos) act.reorder(id, target)
    }, 5)
  }

  // ── text clips: edges = start/end, body = move in time (snap to playhead, cuts, other texts)
  const textEdge = (e: React.PointerEvent, key: LayerKey, side: "l" | "r") => {
    e.stopPropagation()
    e.preventDefault()
    const o = { a: layers[key].from, b: layers[key].to }
    let begun = false
    setTd({ kind: key, side, moved: false, orig: o })
    track(e, (dx) => {
      if (!begun) {
        begun = true
        act.begin(t("hist.timing", { layer: lname(key) }))
      }
      const sv = snapTime((side === "l" ? o.a : o.b) + dx / Z, key)
      setSnapT(sv.s)
      const a = side === "l" ? clamp(sv.v, 0, o.b - MIN_CLIP_SEC) : o.a
      const b = side === "r" ? clamp(sv.v, o.a + MIN_CLIP_SEC, cenasSec) : o.b
      act.layerLive(key, { timing: { fromSec: a, durationSec: b - a } })
    }, () => {
      setTd(null)
      setSnapT(null)
    }, 1)
  }
  const textBody = (e: React.PointerEvent, key: LayerKey) => {
    e.stopPropagation()
    select({ k: key }, true)
    if (phone) {
      setUi({ sheet: null })
      return
    }
    const o = { a: layers[key].from, b: layers[key].to }
    const len = o.b - o.a
    let begun = false
    track(e, (dx) => {
      if (!begun) {
        begun = true
        act.begin(t("hist.moveTime", { layer: lname(key) }))
      }
      const s1 = snapTime(o.a + dx / Z, key)
      let a = s1.v
      if (s1.s === null) {
        const s2 = snapTime(o.b + dx / Z, key)
        if (s2.s !== null) a = s2.v - len
        setSnapT(s2.s)
      } else setSnapT(s1.s)
      a = clamp(toFrame(a), 0, Math.max(0, cenasSec - len))
      act.layerLive(key, { timing: { fromSec: a, durationSec: len } })
    }, () => setSnapT(null), 4)
  }

  const onLaneDown = (e: React.PointerEvent) => {
    const ruler = (e.target as HTMLElement).closest(".rul")
    seek(clamp(xToSec(e.clientX), 0, totalSec - 1 / FPS))
    if (!ruler) select(null)
    track(e, (_dx, ev) => seek(clamp(xToSec(ev.clientX), 0, totalSec - 1 / FPS)), () => {}, 0)
  }

  // ── ruler
  const ticks: React.ReactNode[] = []
  for (let s = 0; s <= Math.ceil(laneW / Z); s++) {
    const x = PAD + s * Z
    const big = s % 5 === 0
    ticks.push(<i key={`t${s}`} className={cn("ed-tick", big && "big")} style={{ left: x }} />)
    if (big || Z >= 70) ticks.push(<span key={`l${s}`} className="ed-tickl" style={{ left: x }}>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>)
  }

  const row = (cls: string, icon: EdIconName, name: string, lane: React.ReactNode, lockTip?: string) => (
    <div className={cn("ed-trow", cls)}>
      <div className="ed-th" title={name}>
        <EdIcon name={icon} />
        <span className="tn">{name}</span>
        {lockTip ? <span className="ml-auto text-fg-3" title={lockTip}><EdIcon name="lock" /></span> : null}
      </div>
      <div className="ed-lane" style={{ width: laneW }} onPointerDown={onLaneDown}>
        {lane}
      </div>
    </div>
  )

  // scenes lane
  const others = rd ? placed.filter((p) => p.scene.sceneId !== rd.id) : []
  const insX = rd ? PAD + others.slice(0, rd.target).reduce((a, p) => a + p.dur, 0) * Z - 1 : 0
  const scenesLane = (
    <>
      {placed.map((p) => {
        const s = sel?.k === "scene" && sel.id === p.scene.sceneId
        const lift = rd?.id === p.scene.sceneId
        const dragging = td?.kind === "scene" && td.id === p.scene.sceneId
        const n = p.scene.index + 1
        const cutDelta = dragging ? (td!.side === "l" ? -(p.clip.inSec - td!.orig.a) : p.clip.outSec - td!.orig.b) : 0
        return (
          <div
            key={p.scene.sceneId}
            className={cn("ed-clip scn", s && "sel", lift && "lift", phone && "nomove")}
            style={{
              left: PAD + p.start * Z, width: Math.max(4, p.dur * Z), transform: lift ? `translateX(${rd!.dx}px)` : undefined,
              backgroundImage: p.scene.thumbnail ? `url("${p.scene.thumbnail.url}")` : undefined,
            }}
            title={phone ? t("lock.mobile") : t("sceneTip")}
            onPointerDown={(e) => sceneBody(e, p.scene.sceneId)}
          >
            <span className="lbl">
              <i>{n}</i>
              {p.scene.label} <i>{sec(p.dur)}</i>
            </span>
            {s && !phone ? (
              <>
                <i className="ed-eg l" onPointerDown={(e) => sceneEdge(e, p.scene.sceneId, "l")} />
                <i className="ed-eg r" onPointerDown={(e) => sceneEdge(e, p.scene.sceneId, "r")} />
              </>
            ) : null}
            {dragging ? (
              <>
                <span className="ed-srcstrip" style={{ left: -p.clip.inSec * Z, width: p.scene.durationSec * Z }} />
                <span className="ed-tip" style={td!.side === "l" ? { left: 0 } : { right: 0 }}>
                  {cutDelta <= 0 ? "−" : "+"}
                  {sec(Math.abs(cutDelta))} · {sec(p.dur)}
                </span>
              </>
            ) : null}
          </div>
        )
      })}
      {rd ? <i className="ed-ins" style={{ left: insX }} /> : null}
    </>
  )

  const textClip = (key: LayerKey, icon: EdIconName) => {
    const L = layers[key]
    if (!L.exists && key === "hook" && work.settings.templateId === "headline") {
      // headline template with an empty hook: the clip is where you start writing one
      return (
        <div className={cn("ed-clip fixed", sel?.k === "hook" && "sel")} style={{ left: PAD, width: 3 * Z }} onPointerDown={(e) => { e.stopPropagation(); select({ k: "hook" }); if (phone) setUi({ sheet: "text" }) }}>
          <EdIcon name="pencil" />
          <span>{t("writeHook")}</span>
        </div>
      )
    }
    if (!L.exists) return <span className="ed-faint absolute top-2 left-3">{t(key === "hook" ? "noHook" : key === "cta" ? "noCta" : "captionsOff")}</span>
    const s = sel?.k === key
    const x = PAD + L.from * Z
    const w = Math.max(6, (L.to - L.from) * Z)
    return (
      <div
        className={cn("ed-clip", key === "caption" && "capw", s && "sel", !L.visible && "hiddenl", phone && "nomove")}
        style={{ left: x, width: w }}
        title={key === "caption" ? undefined : L.text}
        onPointerDown={(e) => textBody(e, key)}
      >
        {key === "caption" ? (
          <>
            {lines.filter((l) => !l.cut && l.abs !== null && l.abs >= L.from && l.abs < L.to).map((l) => (
              <i key={l.id} className={cn("ln", l.low && "low")} style={{ left: (l.abs! - L.from) * Z }} />
            ))}
            <span className="relative">{L.auto ? t("followsSpeech") : t("visibleWindow")}</span>
          </>
        ) : (
          <>
            <EdIcon name={icon} />
            <span>{L.text}</span>
          </>
        )}
        {s && !phone ? (
          <>
            <i className="ed-eg l" onPointerDown={(e) => textEdge(e, key, "l")} />
            <i className="ed-eg r" onPointerDown={(e) => textEdge(e, key, "r")} />
          </>
        ) : null}
        {s && td?.kind === key ? <span className="ed-tip" style={td.side === "r" ? { right: 0 } : { left: 0 }}>{timecode(td.side === "r" ? L.to : L.from)}</span> : null}
      </div>
    )
  }

  const endLane = work.settings.endCard ? (
    <div
      className={cn("ed-clip fixed", sel?.k === "end" && "sel")}
      style={{ left: PAD + cenasSec * Z, width: (totalSec - cenasSec) * Z }}
      title={t("endTip")}
      onPointerDown={(e) => {
        e.stopPropagation()
        select({ k: "end" }, true)
        if (phone) setUi({ sheet: null })
      }}
    >
      <EdIcon name="endc" />
      <span>{t("endClip")}</span>
    </div>
  ) : (
    <div
      className={cn("ed-clip fixed off", sel?.k === "end" && "sel")}
      style={{ left: PAD + cenasSec * Z, width: 2.5 * Z }}
      onPointerDown={(e) => {
        e.stopPropagation()
        select({ k: "end" })
      }}
    >
      <EdIcon name="eyeoff" />
      <span>{t("off")}</span>
    </div>
  )

  return (
    <section className="ed-tl" aria-label={t("timeline")}>
      <div className="ed-tlbar">
        {phone ? (
          <>
            <span className="ed-tlnote">
              <EdIcon name="desktop" />
              {t("tlPhoneNote")}
            </span>
            <span className="flex-1" />
            <span className="ed-mono text-[11px] text-fg-3">{sec(totalSec)}</span>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => act.trimTo("l")} title={`${t("trimStartTip")} (Q)`}>
              <EdIcon name="trimL" />
              {t("trimStart")} <span className="ed-kbd">Q</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => act.trimTo("r")} title={`${t("trimEndTip")} (W)`}>
              <EdIcon name="trimR" />
              {t("trimEnd")} <span className="ed-kbd">W</span>
            </Button>
            <div className="ed-vsep" />
            <Button variant="ghost" size="icon-sm" disabled={!isScene} onClick={() => act.moveScene(-1)} aria-label={t("moveLeft")} title={`${t("moveLeft")} ([)`}>
              <EdIcon name="left" />
            </Button>
            <Button variant="ghost" size="icon-sm" disabled={!isScene} onClick={() => act.moveScene(1)} aria-label={t("moveRight")} title={`${t("moveRight")} (])`}>
              <EdIcon name="right" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!isScene || !!delWhy}
              onClick={act.deleteScene}
              aria-label={t("deleteScene")}
              title={delWhy === "last_scene" ? t("lock.last_scene") : delWhy ? t("toast.minVideoDelete") : `${t("deleteScene")} (Delete)`}
            >
              <EdIcon name="trash" />
            </Button>
            {deleted.length ? (
              <Button size="sm" onClick={act.restoreAll}>
                {t("deletedN", { n: deleted.length })} · {t("restore")}
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button variant="ghost" size="icon-sm" aria-pressed={ui.snap} onClick={() => setUi({ snap: !ui.snap })} aria-label={t("snap")} title={`${t("snap")} (S)`} className={ui.snap ? "bg-hover text-fg" : undefined}>
              <EdIcon name="magnet" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setUi({ zoom: clamp(ui.zoom - 12, 16, 120) })} aria-label={t("zoomOut")} title={`${t("zoomOut")} (−)`}>
              <EdIcon name="minus" />
            </Button>
            <input type="range" className="ed-zoomr" min={16} max={120} value={ui.zoom} onChange={(e) => setUi({ zoom: Number(e.target.value) })} aria-label={t("zoom")} />
            <Button variant="ghost" size="icon-sm" onClick={() => setUi({ zoom: clamp(ui.zoom + 12, 16, 120) })} aria-label={t("zoomIn")} title={`${t("zoomIn")} (+)`}>
              <EdIcon name="plus" />
            </Button>
            <span className="ed-mono text-[11px] whitespace-nowrap text-fg-3">
              {sec(totalSec)} · {Math.round(totalSec * FPS)} frames
            </span>
          </>
        )}
      </div>
      <div className="ed-tlscroll" ref={scroll}>
        <div className="ed-tlinner">
          {row("rul", "clock", "", ticks)}
          {row("scn", "film", t("tracks.scenes"), scenesLane)}
          {row("", "txt", lname("hook"), textClip("hook", "txt"))}
          {row("", "cc", lname("caption"), textClip("caption", "cc"))}
          {row("", "cta", lname("cta"), textClip("cta", "cta"))}
          {row("", "endc", lname("end"), endLane)}
          <div className="ed-ph" style={{ left: `calc(var(--hw) + ${PAD + time * Z}px)` }} />
          {snapT !== null ? <div className="ed-snapl" style={{ left: `calc(var(--hw) + ${PAD + snapT * Z}px)` }} /> : null}
        </div>
      </div>
    </section>
  )
}
