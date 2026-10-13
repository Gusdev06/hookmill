"use client"

import { useState } from "react"
import { useFormatter, useNow } from "next-intl"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { FontId, LayerStyle } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { useEd, type Ed } from "./context"
import { EdIcon, type EdIconName } from "./ed-icon"
import { FPS, HEX, MIN_CLIP_SEC, SWATCHES, clamp, deleteBlock, minClipFor, timecode, toFrame, type LayerKey, type WordView } from "./model"

interface Sec { id: string; title: string; node: React.ReactNode; right?: React.ReactNode }

// ───────────── small controls (mockup .nf / .sws / .seg / .lockrow) ─────────────
function Num({ label, unit, value, step = 1, disabled, onValue, onBlur, id }: {
  label: string; unit?: string; value: number; step?: number; disabled?: boolean; onValue: (v: number) => void; onBlur?: () => void; id: string
}) {
  return (
    <label className={cn("ed-nf", disabled && "dis")} htmlFor={id}>
      {label ? <span>{label}</span> : null}
      <input id={id} type="number" step={step} value={value} disabled={disabled} onBlur={onBlur}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onValue(v)
        }} />
      {unit ? <em>{unit}</em> : null}
    </label>
  )
}
function Swatches({ value, onPick, disabled, label }: { value: string; onPick: (c: string) => void; disabled?: boolean; label: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="ed-sws">
      {SWATCHES.map((c) => (
        <button key={c} type="button" className="ed-sw" style={{ background: c }} aria-label={c} aria-pressed={c.toLowerCase() === value.toLowerCase()} disabled={disabled} onClick={() => onPick(c)} />
      ))}
      <input
        className="ed-hex"
        aria-label={`${label} (hex)`}
        value={draft ?? value}
        disabled={disabled}
        aria-invalid={draft !== null && !HEX.test(draft)}
        onChange={(e) => {
          setDraft(e.target.value)
          if (HEX.test(e.target.value)) onPick(e.target.value.toUpperCase())
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  )
}
function Seg<T extends string>({ value, opts, onPick, disabled, label }: { value: T; opts: [T, string][]; onPick: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="ed-seg" role="group" aria-label={label}>
      {opts.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={v === value} disabled={disabled} onClick={() => v !== value && onPick(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}
function SwitchRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="ed-rowb">
      <span className="text-fg-2">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  )
}
function Memo({ icon = "info", amber, children }: { icon?: EdIconName; amber?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("ed-memo", amber && "amber")}>
      <EdIcon name={icon} />
      <span>{children}</span>
    </div>
  )
}
export function LockRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="ed-lockrow">
      <EdIcon name="lock" className="mt-px size-3.5" />
      <span>{children}</span>
    </div>
  )
}
const Field = ({ label, children, htmlFor }: { label: React.ReactNode; children: React.ReactNode; htmlFor?: string }) => (
  <div className="ed-fld">
    {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="lbl">{label}</span>}
    {children}
  </div>
)

// ───────────── sections ─────────────
function textSec(E: Ed, key: "hook" | "cta"): Sec {
  const { t, layers, act } = E
  const L = layers[key]
  const field = key === "hook" ? "headline" : "ctaText"
  return {
    id: "text",
    title: t("sec.text"),
    node: (
      <div className="ed-fld">
        <Textarea
          id={`f-${key}-text`}
          rows={2}
          aria-label={t("sec.text")}
          value={L.text}
          maxLength={300}
          onChange={(e) => act.typingSettings(`text-${key}`, t("hist.text", { layer: E.lname(key) }), { [field]: key === "hook" ? e.target.value || null : e.target.value })}
          onBlur={act.endTyping}
        />
        {!L.exists ? <Memo icon="alert" amber>{t(key === "hook" ? "hookEmpty" : "ctaEmpty")}</Memo> : null}
      </div>
    ),
  }
}

function styleSec(E: Ed, key: LayerKey): Sec {
  const { t, layers, act, st, work } = E
  const L = layers[key]
  const s = L.style
  const cap = key === "caption"
  const label = (w: string) => t("hist.style", { layer: E.lname(key), what: w })
  const set = (what: string, p: Partial<LayerStyle>) => act.layer(key, label(what), { style: p })
  const bgs: [LayerStyle["background"]["kind"], string][] = [["none", t("bg.none")], ["box", t("bg.box")], ["pill", t("bg.pill")]]
  if (cap) bgs.push(["word", t("bg.word")])
  const pctV = Math.round(L.transform.scale * 100)
  const setScale = (v: number) => act.typingLayer(`scale-${key}`, key, t("hist.scale", { layer: E.lname(key) }), { transform: { ...L.transform, scale: clamp(v / 100, 0.25, 4) } })
  return {
    id: "style",
    title: t("sec.style"),
    node: (
      <>
        {cap ? (
          <Field label={t("animation")}>
            <Seg label={t("animation")} value={work.settings.captionStyle === "line" ? "line" : "word"} opts={[["word", t("wordByWord")], ["line", t("fullLine")]]}
              onPick={(v) => act.settings(label(t("animation")), { captionStyle: v })} />
          </Field>
        ) : null}
        <Field label={t("font")}>
          <Select value={s.fontId} onValueChange={(v) => set(t("font"), { fontId: v as FontId })}>
            <SelectTrigger className="h-[30px] w-full text-[13px]" aria-label={t("font")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              {st.fonts.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={<>{t("size")} <span className="text-fg-3">{t("sizeNote")}</span></>}>
          <div className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
            <input type="range" className="ed-range" min={25} max={400} value={pctV} aria-label={t("size")} onChange={(e) => setScale(Number(e.target.value))} onPointerUp={act.endTyping} />
            <Num id={`f-${key}-size`} label="" unit="%" value={pctV} step={5} onValue={setScale} onBlur={act.endTyping} />
          </div>
        </Field>
        <Field label={t("textColor")}>
          <Swatches label={t("textColor")} value={s.color} onPick={(c) => set(t("textColor"), { color: c })} />
        </Field>
        {cap && work.settings.captionStyle !== "line" ? (
          <Field label={t("spokenColor")}>
            <Swatches label={t("spokenColor")} value={s.highlightColor ?? s.color} onPick={(c) => set(t("spokenColor"), { highlightColor: c })} />
          </Field>
        ) : null}
        <Field label={t("background")}>
          <Seg label={t("background")} value={s.background.kind} opts={bgs}
            onPick={(v) => set(t("background"), { background: { kind: v, color: s.background.color ?? (v === "word" ? "#0000008C" : "#0A0A0A") } })} />
        </Field>
        {s.background.kind !== "none" ? (
          <Field label={t("bgColor")}>
            <Swatches label={t("bgColor")} value={s.background.color ?? "#0A0A0A"} onPick={(c) => set(t("bgColor"), { background: { kind: s.background.kind, color: c } })} />
          </Field>
        ) : null}
        <SwitchRow label={t("outline")} checked={!!s.strokeColor && s.strokeWidthPx > 0}
          onChange={(v) => set(t("outline"), v ? { strokeColor: s.strokeColor ?? "#000000", strokeWidthPx: s.strokeWidthPx > 0 ? s.strokeWidthPx : Math.max(4, Math.round(L.fontPx * 0.09)) } : { strokeColor: null })} />
        {s.strokeColor && s.strokeWidthPx > 0 ? (
          <>
            <div className="ed-g2 items-center">
              <Num id={`f-${key}-sw`} label={t("strokeW")} unit="px" value={s.strokeWidthPx} onValue={(v) => act.typingLayer(`sw-${key}`, key, label(t("outline")), { style: { strokeWidthPx: clamp(Math.round(v), 0, 60) } })} onBlur={act.endTyping} />
              <span />
            </div>
            <Swatches label={t("outline")} value={s.strokeColor} onPick={(c) => set(t("outline"), { strokeColor: c })} />
          </>
        ) : null}
        <SwitchRow label={t("shadow")} checked={s.shadow} onChange={(v) => set(t("shadow"), { shadow: v })} />
        <SwitchRow label={t("allCaps")} checked={s.uppercase} onChange={(v) => set(t("allCaps"), { uppercase: v })} />
        <Field label={t("align")}>
          <Seg label={t("align")} value={s.align} opts={[["left", t("alignLeft")], ["center", t("alignCenter")], ["right", t("alignRight")]]} onPick={(v) => set(t("align"), { align: v })} />
        </Field>
        {cap ? <p className="ed-faint">{t("capStyleNote")}</p> : null}
        <Button variant="ghost" size="sm" className="justify-self-start" disabled={!L.styleChanged && !L.hasTransform} onClick={() => act.resetStyle(key)}>
          <EdIcon name="refresh" />
          {t("resetDefault")}
        </Button>
      </>
    ),
  }
}

function posSec(E: Ed, key: LayerKey): Sec {
  const { t, layers, act, meta } = E
  const L = layers[key]
  const W = meta.compositionWidth
  const H = meta.compositionHeight
  const tr = L.transform
  const lb = t("hist.move", { layer: E.lname(key) })
  const set = (f: string, p: Partial<typeof tr>) => act.typingLayer(`${f}-${key}`, key, lb, { transform: { ...tr, ...p } })
  return {
    id: "pos",
    title: t("sec.position"),
    node: (
      <>
        <div className="ed-g2">
          <Num id={`f-${key}-x`} label="X" unit="px" value={Math.round(tr.x * W)} onValue={(v) => set("x", { x: clamp(v / W, -0.25, 1.25) })} onBlur={act.endTyping} />
          <Num id={`f-${key}-y`} label="Y" unit="px" value={Math.round(tr.y * H)} onValue={(v) => set("y", { y: clamp(v / H, -0.25, 1.25) })} onBlur={act.endTyping} />
          <Num id={`f-${key}-w`} label={t("box")} unit="px" value={Math.round(tr.boxWidth * W)} onValue={(v) => set("w", { boxWidth: clamp(v / W, 0.1, 1.5) })} onBlur={act.endTyping} />
          <Num id={`f-${key}-r`} label="↻" unit="°" value={Math.round(tr.rotationDeg)} onValue={(v) => set("r", { rotationDeg: clamp(Math.round(v), -180, 180) })} onBlur={act.endTyping} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => act.layer(key, t("hist.center", { layer: E.lname(key) }), { transform: { ...tr, x: 0.5 } })}>{t("centerX")}</Button>
          <Button size="sm" onClick={() => act.layer(key, t("hist.rot0"), { transform: { ...tr, rotationDeg: 0 } })}>{t("rot0")}</Button>
        </div>
        {key === "caption" && E.work.settings.captionPosition && L.hasTransform ? <Memo>{t("capPosNote")}</Memo> : null}
        <p className="ed-faint">{t("posNote")}</p>
      </>
    ),
  }
}

function timeSec(E: Ed, key: LayerKey): Sec {
  const { t, layers, act, cenasSec } = E
  const L = layers[key]
  const lb = t("hist.timing", { layer: E.lname(key) })
  const setIn = (v: number) => {
    const a = clamp(toFrame(v), 0, L.to - MIN_CLIP_SEC)
    act.typingLayer(`in-${key}`, key, lb, { timing: { fromSec: a, durationSec: L.to - a } })
  }
  const setOut = (v: number) => {
    const b = clamp(toFrame(v), L.from + MIN_CLIP_SEC, cenasSec)
    act.typingLayer(`out-${key}`, key, lb, { timing: { fromSec: L.from, durationSec: b - L.from } })
  }
  return {
    id: "time",
    title: t("sec.timing"),
    right: L.auto ? <span className="ed-tag">{t("automatic")}</span> : undefined,
    node: (
      <>
        <div className="ed-g2">
          <Num id={`f-${key}-in`} label={t("in")} unit="s" step={0.1} value={Number(L.from.toFixed(2))} onValue={setIn} onBlur={act.endTyping} />
          <Num id={`f-${key}-out`} label={t("out")} unit="s" step={0.1} value={Number(L.to.toFixed(2))} onValue={setOut} onBlur={act.endTyping} />
        </div>
        <div className="ed-rowb">
          <span className="text-fg-2">{t("duration")}</span>
          <span className="ed-mono">{E.sec(L.to - L.from)}</span>
        </div>
        {key === "caption" ? <Memo>{t("capWindowNote")}</Memo> : null}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => act.trimTo("l")}><EdIcon name="trimL" />{t("startAtPh")}</Button>
          <Button size="sm" onClick={() => act.trimTo("r")}><EdIcon name="trimR" />{t("endAtPh")}</Button>
          {!L.auto ? <Button size="sm" variant="ghost" onClick={() => act.autoTime(key)}>{t("backAuto")}</Button> : null}
        </div>
      </>
    ),
  }
}

function WordEdit({ w }: { w: WordView }) {
  const { t, act, setUi } = useEd()
  const [v, setV] = useState(w.text || w.original)
  const save = () => {
    const x = v.trim()
    if (!x) act.hideWord(w)
    else if (x !== w.text) act.fixWord(w, x)
    setUi({ editWord: null })
  }
  return (
    <div className="ed-wedit">
      <label htmlFor="wfix" className="text-[12px] text-fg-2">
        {t("fixWord")} <span className="text-fg-3">“{w.original}”</span>
      </label>
      <input id="wfix" autoFocus className="h-[30px] rounded-sm border border-line bg-surface px-2 text-[13px]" value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save() }
          if (e.key === "Escape") setUi({ editWord: null })
        }} />
      {w.suggestion && w.suggestion !== v ? (
        <div className="acts">
          <span className="ed-faint">{t("fromScript")}</span>
          <Button size="sm" onClick={() => setV(w.suggestion!)}>{w.suggestion}</Button>
        </div>
      ) : null}
      <div className="acts">
        <Button size="sm" variant="default" onClick={save}>{t("save")}</Button>
        <Button size="sm" onClick={() => setUi({ editWord: null })}>{t("cancel")}</Button>
        <Button size="sm" variant="ghost" onClick={() => { act.hideWord(w); setUi({ editWord: null }) }}><EdIcon name="eyeoff" />{t("hideWord")}</Button>
        {w.fixed ? <Button size="sm" variant="ghost" onClick={() => { act.resetWord(w); setUi({ editWord: null }) }}>{t("originalWord")}</Button> : null}
      </div>
      <p className="ed-faint">{t("fixNote")}</p>
    </div>
  )
}

function wordsSec(E: Ed): Sec {
  const { t, lines, ui, setUi, time, seek } = E
  const low = lines.flatMap((l) => l.words).filter((w) => w.low)
  const cur = lines.find((l) => l.abs !== null && !l.cut && time >= l.abs && time < (l.words.filter((w) => !w.cut).slice(-1)[0]?.absEnd ?? l.abs))
  const open = (w: WordView) => {
    setUi({ editWord: w.key })
    if (w.abs !== null) seek(w.abs + 0.02)
  }
  return {
    id: "words",
    title: t("sec.transcript"),
    right: low.length ? <Button size="sm" onClick={() => open(low.find((w) => w.key !== ui.editWord) ?? low[0])}>{t("next")}</Button> : undefined,
    node: (
      <>
        {low.length ? <Memo icon="alert" amber>{t("lowN", { n: low.length })}</Memo> : <Memo icon="check">{t("noLow")}</Memo>}
        <div className="ed-wl">
          {lines.map((l) => {
            const editing = l.words.find((w) => w.key === ui.editWord)
            return (
              <div key={l.id}>
                <div className={cn("ed-wl-row", cur?.id === l.id && "cur", l.cut && "cut")}>
                  <span className="t">{l.cut ? t("cutLine") : timecode(l.abs ?? 0).slice(3)}</span>
                  <span>
                    {l.words.map((w) => (
                      <button key={w.key} type="button" className={cn("ed-wd", w.low && "low", w.fixed && !w.hidden && "fixed", w.hidden && "hidden")} disabled={w.cut}
                        title={w.low ? t("lowTip") : t("clickToFix")} onClick={() => open(w)}>
                        {w.hidden ? w.original : w.text}
                      </button>
                    ))}
                  </span>
                </div>
                {editing ? <WordEdit key={editing.key} w={editing} /> : null}
              </div>
            )
          })}
        </div>
      </>
    ),
  }
}

function sceneSecs(E: Ed, id: string): Sec[] {
  const { t, placed, act, lines, sec, src } = E
  const p = placed.find((x) => x.scene.sceneId === id)
  if (!p) return []
  const sc = p.scene
  const c = p.clip
  const n = placed.length
  const cut = lines.filter((l) => l.sceneId === id && l.cut)
  const lb = t("hist.trim", { n: sc.index + 1 })
  // ≥ 0.3 s per scene and ≥ 1 s of video (validarDoc): the field stops at the limit and says why
  const minLen = minClipFor(placed, id)
  const guard = (wanted: number) => {
    if (wanted < minLen - 1e-6) E.notify(t(minLen > MIN_CLIP_SEC + 1e-6 ? "toast.minVideo" : "toast.minClip"), false, "ed-min")
    return minLen
  }
  const delWhy = deleteBlock(placed, id)
  const delText = delWhy === "last_scene" ? t("lock.last_scene") : t("toast.minVideoDelete")
  const setC = (patch: { inSec?: number; outSec?: number }, f: string) =>
    E.s.typing(`${f}-${id}`, lb, (w) => ({ ...w, doc: { ...w.doc, clips: E.clips.map((x) => (x.sceneId === id ? { ...x, ...patch } : x)) } }))
  return [
    {
      id: "trim",
      title: t("sec.trim"),
      node: (
        <>
          <div className="ed-trimviz" aria-hidden="true">
            <b style={{ left: `${(c.inSec / sc.durationSec) * 100}%`, width: `${((c.outSec - c.inSec) / sc.durationSec) * 100}%` }} />
            <span style={{ left: 0 }}>0</span>
            <span style={{ right: 0 }}>{sec(sc.durationSec)}</span>
          </div>
          <div className="ed-g2">
            <Num id="f-sc-in" label={t("start")} unit="s" step={0.1} value={Number(c.inSec.toFixed(2))} onValue={(v) => setC({ inSec: toFrame(clamp(v, 0, c.outSec - guard(c.outSec - v))) }, "in")} onBlur={act.endTyping} />
            <Num id="f-sc-out" label={t("end")} unit="s" step={0.1} value={Number(c.outSec.toFixed(2))} onValue={(v) => setC({ outSec: toFrame(clamp(v, c.inSec + guard(v - c.inSec), sc.durationSec)) }, "out")} onBlur={act.endTyping} />
          </div>
          <dl className="ed-kv">
            <dt>{t("inVideo")}</dt>
            <dd>{timecode(p.start)} – {timecode(p.end)}</dd>
            <dt>{t("duration")}</dt>
            <dd>{t("durOf", { a: sec(p.dur), b: sec(sc.durationSec) })}</dd>
          </dl>
          {cut.length ? (
            <div className="ed-fld">
              <span className="lbl text-status-waiting"><EdIcon name="alert" />{t("linesLeave")}</span>
              <ul className="ed-cutlist">
                {cut.map((l) => (
                  <li key={l.id}><s>{l.words.map((w) => w.text).join(" ")}</s></li>
                ))}
              </ul>
            </div>
          ) : (
            <Memo>{t("trimNote")}</Memo>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => act.trimTo("l")}><EdIcon name="trimL" />{t("trimStartTip")}</Button>
            <Button size="sm" onClick={() => act.trimTo("r")}><EdIcon name="trimR" />{t("trimEndTip")}</Button>
            <Button size="sm" variant="ghost" disabled={c.inSec === 0 && c.outSec === sc.durationSec}
              onClick={() => act.clips(t("hist.restoreCut"), E.clips.map((x) => (x.sceneId === id ? { ...x, inSec: 0, outSec: src.scenes.find((s) => s.sceneId === id)!.durationSec } : x)))}>
              {t("restoreCut")}
            </Button>
          </div>
        </>
      ),
    },
    {
      id: "order",
      title: t("sec.order"),
      node: (
        <>
          <div className="ed-rowb">
            <span className="text-fg-2">{t("position")}</span>
            <span className="ed-mono">{t("posOf", { a: p.pos + 1, b: n })}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={p.pos === 0} onClick={() => act.moveScene(-1)}><EdIcon name="left" />{t("moveLeftShort")}</Button>
            <Button size="sm" disabled={p.pos === n - 1} onClick={() => act.moveScene(1)}>{t("moveRightShort")}<EdIcon name="right" /></Button>
          </div>
          <p className="ed-faint">{t("orderNote")}</p>
        </>
      ),
    },
    {
      id: "del",
      title: t("sec.delete"),
      node: (
        <>
          <Button size="sm" variant="destructive" className="justify-self-start" disabled={!!delWhy} title={delWhy ? delText : undefined} onClick={act.deleteScene}>
            <EdIcon name="trash" />
            {t("deleteScene")}
          </Button>
          <p className="ed-faint">{delWhy ? delText : t("deleteNote")}</p>
        </>
      ),
    },
  ]
}

function endSecs(E: Ed): Sec[] {
  const { t, work, act, select, setUi } = E
  return [{
    id: "text",
    title: t("layer.end"),
    node: (
      <>
        <SwitchRow label={t("showEnd")} checked={work.settings.endCard} onChange={(v) => act.settings(t("hist.endCard"), { endCard: v })} />
        <Memo>{t("endNote")}</Memo>
        <Button size="sm" className="justify-self-start" onClick={() => { select({ k: "cta" }, true); setUi({ sheet: "text" }) }}>
          <EdIcon name="cta" />
          {t("editCta")}
        </Button>
      </>
    ),
  }]
}

function ProjectAgo({ iso }: { iso: string }) {
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  return <>{format.relativeTime(new Date(iso), now)}</>
}

function projectSecs(E: Ed): Sec[] {
  const { t, totalSec, work, clips, src, act, sec, s, setUi, meta } = E
  const fmt = { VERTICAL_9_16: "9:16", PORTRAIT_4_5: "4:5", SQUARE_1_1: "1:1" }[src.format]
  const off = clips.filter((c) => !c.enabled)
  const last = s.edit.data?.previewRender
  const out: Sec[] = [{
    id: "proj",
    title: t("sec.video"),
    node: (
      <>
        <dl className="ed-kv">
          <dt>{t("format")}</dt><dd>{fmt} · {meta.compositionWidth} × {meta.compositionHeight}</dd>
          <dt>{t("length")}</dt><dd>{sec(totalSec)} · {Math.round(totalSec * FPS)} frames</dd>
          <dt>FPS</dt><dd>{FPS}</dd>
          <dt>Template</dt><dd>{t(`tpl.${work.settings.templateId}` as never)}</dd>
          <dt>{t("lastExport")}</dt><dd>{last ? <ProjectAgo iso={last.createdAt} /> : "—"}</dd>
        </dl>
        <p className="ed-faint">{t("tplNote")}</p>
      </>
    ),
  }]
  if (off.length) {
    out.push({
      id: "deleted",
      title: t("sec.deleted"),
      node: (
        <div>
          {off.map((c) => {
            const sc = src.scenes.find((x) => x.sceneId === c.sceneId)!
            return (
              <div key={c.sceneId} className="ed-dlrow">
                <span>{t("sceneN", { n: sc.index + 1 })} · {sc.label} <span className="ed-mono text-fg-3">{sec(c.outSec - c.inSec)}</span></span>
                <Button size="sm" onClick={() => act.restoreScene(c.sceneId)}>{t("restore")}</Button>
              </div>
            )
          })}
        </div>
      ),
    })
  }
  out.push({
    id: "how",
    title: t("sec.how"),
    node: (
      <>
        <Memo>{t("howBody")}</Memo>
        {E.phone ? null : (
          <Button size="sm" className="justify-self-start" onClick={() => setUi({ help: true })}>
            <EdIcon name="kbd" />
            {t("shortcuts")} <span className="ed-kbd">?</span>
          </Button>
        )}
      </>
    ),
  })
  return out
}

function sections(E: Ed): Sec[] {
  const sl = E.sel
  if (!sl) return projectSecs(E)
  if (sl.k === "scene") return sceneSecs(E, sl.id)
  if (sl.k === "end") return endSecs(E)
  if (sl.k === "caption") return [wordsSec(E), styleSec(E, "caption"), posSec(E, "caption"), timeSec(E, "caption")]
  return [textSec(E, sl.k), styleSec(E, sl.k), posSec(E, sl.k), timeSec(E, sl.k)]
}
const PHONE_OK = ["text", "style", "words"]
function phoneSections(E: Ed): Sec[] {
  const ok = sections(E).filter((x) => PHONE_OK.includes(x.id))
  return ok.length ? ok : [{ id: "mob", title: E.t("onComputer"), node: <LockRow>{E.t("lock.mobile")}</LockRow> }]
}

const SEL_ICON: Record<string, EdIconName> = { hook: "txt", cta: "cta", caption: "cc", end: "endc", scene: "film" }
function selName(E: Ed) {
  const sl = E.sel
  if (!sl) return E.t("project")
  if (sl.k === "scene") {
    const p = E.placed.find((x) => x.scene.sceneId === sl.id)
    return p ? `${E.t("sceneN", { n: p.scene.index + 1 })} · ${p.scene.label}` : ""
  }
  return E.lname(sl.k)
}

function Head({ closeIcon, onClose }: { closeIcon: EdIconName; onClose: () => void }) {
  const E = useEd()
  const { t, sel, layers, act } = E
  const canHide = sel && (sel.k === "hook" || sel.k === "cta") && layers[sel.k].exists
  return (
    <>
      <EdIcon name={sel ? SEL_ICON[sel.k] : "film"} />
      <b>{selName(E)}</b>
      {canHide ? (
        <Button variant="ghost" size="icon-sm" onClick={() => act.hideLayer(sel.k as "hook" | "cta")} aria-label={t("hide")} title={`${t("hideLayer")} (Delete)`}>
          <EdIcon name={layers[sel.k as "hook" | "cta"].visible ? "eye" : "eyeoff"} />
        </Button>
      ) : null}
      {sel ? (
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("clearSel")} title="Esc">
          <EdIcon name={closeIcon} />
        </Button>
      ) : null}
    </>
  )
}

/** Desktop properties panel (320 px). */
export function Panel() {
  const E = useEd()
  const secs = sections(E)
  return (
    <aside className="ed-panel on-light" aria-label={E.t("properties")}>
      <div className="ed-phead">
        <Head closeIcon="x" onClose={() => E.select(null)} />
      </div>
      {secs.map((x) => (
        <section key={x.id} className="ed-psec">
          <div className="ed-psec-h">
            <h3 className="step-lbl">{x.title}</h3>
            {x.right}
          </div>
          {x.node}
        </section>
      ))}
    </aside>
  )
}

/** Phone: bottom sheet in place of the timeline (spec §2.20). */
export function Sheet() {
  const E = useEd()
  if (!E.phone || !E.sel || !E.ui.sheet) return <div className="ed-sheet on-light" />
  const secs = phoneSections(E)
  const cur = secs.find((x) => x.id === E.ui.sheet) ?? secs[0]
  return (
    <div className="ed-sheet on-light">
      <div className="ed-shhead">
        <Head closeIcon="check" onClose={() => E.setUi({ sheet: null })} />
      </div>
      {secs.length > 1 ? (
        <div className="px-3 pt-2">
          <div className="ed-seg w-full" role="tablist">
            {secs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={x.id === cur.id} className="flex-1" onClick={() => E.setUi({ sheet: x.id })}>
                {x.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="ed-shbody">
        <section className="ed-psec border-b-0">{cur.node}</section>
      </div>
    </div>
  )
}

const SHEET_ICON: Record<string, EdIconName> = { text: "txt", style: "style", words: "words", mob: "desktop" }
/** Phone dock: pick a layer; with a selection, Back + Text · Style · Transcript. */
export function Dock() {
  const E = useEd()
  const { t, sel, select, setUi, layers, phone } = E
  if (!phone) return <div className="ed-dock" />
  return (
    <div className="ed-dock">
      {!sel ? (
        (["hook", "caption", "cta"] as LayerKey[]).map((k) => (
          <button key={k} type="button" disabled={!layers[k].exists && k !== "cta" && k !== "hook"} onClick={() => { select({ k }, true); setUi({ sheet: null }) }}>
            <EdIcon name={SEL_ICON[k]} />
            {E.lname(k)}
          </button>
        )).concat(
          <button key="end" type="button" onClick={() => { select({ k: "end" }, true); setUi({ sheet: null }) }}>
            <EdIcon name="endc" />
            {E.lname("end")}
          </button>
        )
      ) : (
        <>
          <button type="button" onClick={() => select(null)}>
            <EdIcon name="back" />
            {t("back")}
          </button>
          {phoneSections(E).map((x) => (
            <button key={x.id} type="button" onClick={() => setUi({ sheet: x.id })}>
              <EdIcon name={SHEET_ICON[x.id] ?? "info"} />
              {x.title}
            </button>
          ))}
        </>
      )}
      <span className="dnote">
        <EdIcon name="desktop" />
        {t("dockNote")}
      </span>
    </div>
  )
}
