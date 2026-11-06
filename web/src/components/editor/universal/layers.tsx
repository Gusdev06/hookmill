"use client"

import type { EditLayerKind } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { EdIcon, type EdIconName } from "@/components/editor/ed-icon"
import { useU } from "./context"
import { MIN_TRIM_SEC, VIDEO_ID, clamp, layerOf, setTrim, timecode } from "./model"

export const KIND_ICON: Record<EditLayerKind, EdIconName> = { video: "film", broll: "film", text: "txt", box: "cta", list: "words", chat: "words", caption: "cc", burned: "lock" }

/** Visible in the doc (Hide = visible false, in every format). */
const useHidden = () => {
  const { doc } = useU()
  return (id: string) => layerOf(doc, id)?.visible === false
}

/** Left rail (desktop): manifest order = front to back (§3.1). Red name = a blocking check on that layer. */
export function LayerRail() {
  const { st, sel, select, issues, label, t } = useU()
  const hidden = useHidden()
  const bad = new Set(issues.filter((i) => i.level === "block" && i.layerId).map((i) => i.layerId!))
  return (
    <aside className="rail" aria-label={t("layers.title")}>
      <div className="h3"><span>{t("layers.title")}</span><span className="mono">{st.manifest.layers.length}</span></div>
      <div className="layers">
        {st.manifest.layers.map((l) => (
          <button key={l.id} type="button" className={cn("lyr", bad.has(l.id) && "bad", hidden(l.id) && "off")} aria-current={sel === l.id} onClick={() => select(l.id, true)}>
            <span className="ic"><EdIcon name={KIND_ICON[l.kind]} /></span>
            <span className="nm">{label(l.id)}</span>
            <span className="st">{l.lockedReason ? t("layers.locked") : hidden(l.id) ? <EdIcon name="eyeoff" /> : null}</span>
          </button>
        ))}
      </div>
      <p className="hint">{t("layers.hint")}</p>
    </aside>
  )
}

/** Phone (< 900 px): the layers as chips right above the canvas. */
export function LayerChips() {
  const { st, sel, select, issues, label, t } = useU()
  const hidden = useHidden()
  const bad = new Set(issues.filter((i) => i.level === "block" && i.layerId).map((i) => i.layerId!))
  return (
    <div className="chips" role="group" aria-label={t("layers.title")}>
      {st.manifest.layers.map((l) => (
        <button key={l.id} type="button" aria-current={sel === l.id} className={cn(bad.has(l.id) && "bad")} onClick={() => select(l.id, true)}>
          {label(l.id)}{hidden(l.id) ? ` (${t("layers.hidden")})` : ""}
        </button>
      ))}
    </div>
  )
}

/** Timeline (desktop, §7): one lane per layer with when it shows; the burned caption is locked. Click = seek + select.
 *  The scale is your whole video, so trimming doesn't rescale anything: what the trim cuts stays visible as a hatched area. */
export function Timeline() {
  const { st, r, sel, select, seek, time, label, t, s, ro, videoFull, decl } = useU()
  const dur = r?.layout.durationSec ?? 1
  const cur = r?.layout.video?.trim ?? null
  const axis = videoFull?.durationSec || dur
  // layout times are output seconds; the scale is the video before the trim
  const off = cur && videoFull ? cur.inSec - videoFull.inSec : 0
  const frac = (x: number) => Math.max(0, Math.min(axis, x)) / axis
  const pct = (x: number) => `${frac(x) * 100}%`
  const ticks: number[] = []
  const stepS = axis > 30 ? 5 : 2
  for (let x = 0; x <= axis + 1e-6; x += stepS) ticks.push(x)
  const lay = (id: string) => r?.layout.layers.find((l) => l.id === id)
  const fps = r?.meta.fps ?? 30
  const canTrim = !ro && !!cur && !!videoFull && !!decl(VIDEO_ID)?.editable.trim
  const startTrim = (e: React.PointerEvent, edge: "in" | "out") => {
    e.stopPropagation()
    e.preventDefault()
    if (!cur || !videoFull) return
    const track = (e.currentTarget as HTMLElement).closest(".tr")?.getBoundingClientRect()
    if (!track) return
    const c0 = cur
    const full = videoFull
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const sec = Math.round((full.inSec + clamp((ev.clientX - track.left) / track.width, 0, 1) * axis) * fps) / fps
      const n = edge === "in" ? { inSec: clamp(sec, full.inSec, c0.outSec - MIN_TRIM_SEC), outSec: c0.outSec } : { inSec: c0.inSec, outSec: clamp(sec, c0.inSec + MIN_TRIM_SEC, full.outSec) }
      if (!moved) {
        moved = true
        s.begin(t("hist.trim"))
      }
      const whole = n.inSec <= full.inSec && n.outSec >= full.outSec
      s.live((d) => setTrim(d, whole ? null : n))
      seek(edge === "in" ? 0 : n.outSec - n.inSec)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }
  const cutR = off + dur
  return (
    <section className="tl" aria-label={t("timeline.title")}>
      <div className="tlhead">
        <div className="h3"><span>{t("timeline.title")}</span></div>
        <span className="hint">{t(canTrim ? "timeline.hintTrim" : "timeline.hint")}</span>
      </div>
      <div className="tlbody">
        <div className="tlin">
          <div className="ruler"><span /><div className="sc">{ticks.map((x) => <span key={x} style={{ left: pct(x) }}>{x}s</span>)}</div></div>
          {st.manifest.layers.map((l) => {
            const L = lay(l.id)
            const isVid = l.kind === "video"
            return (
              <div key={l.id} className={cn("lane", sel === l.id && "cur")}>
                <button type="button" className="ln" onClick={() => select(l.id, true)}>{label(l.id)}</button>
                <div
                  className="tr"
                  onPointerDown={(e) => {
                    const rc = e.currentTarget.getBoundingClientRect()
                    seek(((e.clientX - rc.left) / rc.width) * axis - off)
                    if (sel !== l.id) select(l.id, true)
                  }}
                >
                  {L && (L.visible || isVid) ? (
                    <div className={cn("blk", isVid && "vid", l.kind === "broll" && "br", l.kind === "burned" && "lock")} style={{ left: pct(L.fromSec + off), width: `calc(${(frac(L.toSec + off) - frac(L.fromSec + off)) * 100}% - 1px)` }}>
                      {l.kind === "burned" ? t("layers.locked") : isVid ? `${t("timeline.yourVideo")} · ${timecode(L.toSec - L.fromSec)}` : label(l.id)}
                      {isVid && canTrim ? (
                        <>
                          <i className="eh l" title={t("timeline.trimStart")} onPointerDown={(e) => startTrim(e, "in")} />
                          <i className="eh r" title={t("timeline.trimEnd")} onPointerDown={(e) => startTrim(e, "out")} />
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
          {off > 0.001 ? <div className="tlcut" style={{ left: 150, width: `calc((100% - 150px) * ${frac(off)})` }} title={t("timeline.cutAway")} /> : null}
          {cutR < axis - 0.001 ? <div className="tlcut" style={{ left: `calc(150px + (100% - 150px) * ${frac(cutR)})`, right: 0 }} title={t("timeline.cutAway")} /> : null}
          <div className="tlhead2" style={{ left: `calc(150px + (100% - 150px) * ${frac(time + off)})` }} />
        </div>
      </div>
    </section>
  )
}
