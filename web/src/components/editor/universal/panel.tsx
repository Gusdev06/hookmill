"use client"

import { useState } from "react"
import { useFormatter } from "next-intl"
import type { RemixKeepProps } from "@maquina/video/player"
import type { ControlDecl, EditIssue, LayerStyle, LayerTransform, Rect, TextProvenance, VideoFraming } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { editorFonts } from "@/lib/editor-fonts"
import { EdIcon } from "@/components/editor/ed-icon"
import { useU } from "./context"
import { KIND_ICON } from "./layers"
import {
  FORMAT_LABEL, MIN_TRIM_SEC, PAN_MAX, ZOOM_MAX, ZOOM_MIN, baseOf, canMove, clamp, clampFraming, clampVideoBox, confirmNumbers, framingNow, geoMode, geometryOf, layerOf, patchLayer, resetLayer, setGeometry, setOpt, setText, setTrim,
  setVideoGeo, timecode, videoGeo, visibleChars,
  type Row,
} from "./model"

const SW = ["#FFFFFF", "#111111", "#E32222", "#FFE14D", "#3BE38B", "#3B5BFF", "#FF3EA5", "#F3EFE8"]
const HEX = /^#[0-9a-f]{6}$/i
const UI_TOP: Record<string, number> = { "9x16": 200, "4x5": 60, "1x1": 50 }
const UI_BOT: Record<string, number> = { "9x16": 340, "4x5": 110, "1x1": 50 }
const humanize = (s: string) => s.replace(/^.*[:.]/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase())

// ───────────── small controls (the catalog of the spec §8, ported from the prototype) ─────────────
export function Seg({ value, options, onChange, disabled, label, tight }: { value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean; label: string; tight?: boolean }) {
  return (
    <div className={cn("seg", tight && "tight")} role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} disabled={disabled} onClick={() => value !== v && onChange(v)}>{l}</button>
      ))}
    </div>
  )
}
export function Swatches({ value, onChange, extra = [], disabled, label }: { value: string | null; onChange: (v: string) => void; extra?: (string | null | undefined)[]; disabled?: boolean; label: string }) {
  const list = [...new Set([...SW, ...extra.filter((x): x is string => !!x && HEX.test(x)).map((x) => x.toUpperCase())])]
  const [hex, setHex] = useState<{ base: string | null; v: string } | null>(null)
  const shown = hex && hex.base === value ? hex.v : value ?? ""
  return (
    <div className="sws" role="group" aria-label={label}>
      {list.map((c) => (
        <button key={c} type="button" className="sw" style={{ background: c }} aria-label={c} aria-pressed={(value ?? "").toLowerCase() === c.toLowerCase()} disabled={disabled} onClick={() => onChange(c)} />
      ))}
      <input
        className="inp hex"
        value={shown}
        disabled={disabled}
        aria-label={`${label} · hex`}
        onChange={(e) => {
          setHex({ base: value, v: e.target.value })
          if (HEX.test(e.target.value)) onChange(e.target.value.toUpperCase())
        }}
      />
    </div>
  )
}
function NumField({ lab, value, onCommit, disabled, step = 1 }: { lab: string; value: number; onCommit: (v: number) => void; disabled?: boolean; step?: number }) {
  return (
    <label className={cn("nf", disabled && "dis")}>
      <span>{lab}</span>
      <input
        key={value}
        type="number"
        inputMode="decimal"
        step={step}
        defaultValue={value}
        disabled={disabled}
        onBlur={(e) => {
          const n = parseFloat(e.target.value)
          if (Number.isFinite(n) && n !== value) onCommit(n)
          else e.target.value = String(value)
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}
function Memo({ tone, children }: { tone?: "bad" | "warn"; children: React.ReactNode }) {
  return (
    <div className={cn("memo", tone)}>
      <EdIcon name="info" />
      {children}
    </div>
  )
}

// ───────────── shared reads ─────────────
function useTexts() {
  const { r, doc, st } = useU()
  const textOf = (path: string, layerId: string, itemId: string | null): string => {
    if (!itemId) {
      const t = layerOf(doc, layerId)?.text
      if (typeof t === "string") return t
    } else {
      const t = doc.items?.[layerId]?.find((x) => x.id === itemId)?.text
      if (typeof t === "string") return t
    }
    return r?.textos.find((x) => x.path === path)?.text ?? st.provenance[path]?.original ?? ""
  }
  return textOf
}
/** HEADLINE: the base text layer (style, font size and plate color as the template made them). */
const headlineBase = (st: ReturnType<typeof useU>["st"], fmt: ReturnType<typeof useU>["fmt"]) =>
  (baseOf(st, fmt) as unknown as RemixKeepProps | null)?.textLayers?.find((x) => x.id === "headline-nova") ?? null

// ───────────── Template tab: built from manifest.controls ─────────────
const FIXED = ["appearance", "position", "format"] as const
export function TemplateTab() {
  const U = useU()
  const { st, t } = U
  if (!U.r) return <section className="card"><div className="skel"><i /><i /><i /><i /><i /></div></section>
  const groups = new Map<string, ControlDecl[]>()
  for (const c of st.manifest.controls) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
  const custom = [...groups.keys()].filter((g) => !["appearance", "position", "format", "content", "guides"].includes(g))
  const order = [...FIXED, ...custom, "content", "guides"].filter((g) => groups.has(g))
  return (
    <>
      {order.map((g) => {
        const cs = groups.get(g)!
        if (g === "content") return <ContentCard key={g} controls={cs} />
        const head = (FIXED as readonly string[]).includes(g) || g === "guides" ? t(`group.${g}` as never) : t.has(`group.${g}` as never) ? t(`group.${g}` as never) : humanize(g)
        return (
          <section key={g} className="card">
            <h2>{head}</h2>
            <div className="grid2" style={{ marginTop: 12 }}>
              {cs.map((c, i) => <Control key={i} c={c} />)}
            </div>
            {g === "position" ? <p className="hint" style={{ margin: "10px 0 0" }}>{t("tpl.positionHint")}</p> : null}
            {g === "format" ? <p className="hint" style={{ margin: "10px 0 0" }}>{t("tpl.formatHint")}</p> : null}
          </section>
        )
      })}
      {process.env.NODE_ENV !== "production" ? (
        <details className="schema">
          <summary>{t("tpl.schema")}</summary>
          <pre>{schemaText(U)}</pre>
        </details>
      ) : null}
    </>
  )
}
function schemaText({ st }: ReturnType<typeof useU>) {
  const m = st.manifest
  const ed = (e: Record<string, boolean>) => Object.entries(e).filter(([, v]) => v).map(([k]) => k).join(", ") || "—"
  const lyr = m.layers.map((l) => `    { id: '${l.id}', kind: '${l.kind}', editable: [${ed(l.editable as unknown as Record<string, boolean>)}]${l.limits?.maxChars ? `, maxChars: ${l.limits.maxChars}` : ""}${l.lockedReason ? `, locked: '${l.lockedReason}'` : ""} }`).join(",\n")
  const ctl = m.controls.map((c) => `    { group: '${c.group}', type: '${c.type}'${"key" in c ? `, key: '${c.key}'` : ""}${"formats" in c ? `, formats: [${c.formats.join(", ")}]` : ""}${"layers" in c ? `, layers: [${c.layers.join(", ")}]${c.itemsOf ? `, itemsOf: '${c.itemsOf}'` : ""}` : ""} }`).join(",\n")
  return `templateKey: '${m.templateKey}'  ·  formats: ${m.formats.join(", ")}\nlayers: [\n${lyr}\n]\ncontrols: [\n${ctl}\n]`
}

function ctlLabel(t: ReturnType<typeof useU>["t"], key: string) {
  const k = `control.${key.split(".").pop()}`
  return t.has(k as never) ? t(k as never) : humanize(key)
}
function Control({ c }: { c: ControlDecl }) {
  const U = useU()
  const { st, doc, s, t, ro, fmt, setFmt, guides, setGuides } = U
  const val = (key: string) => doc.templateOpts?.[key] ?? st.manifest.defaults[key]
  if (c.type === "color") {
    const v = val(c.key)
    return (
      <div className="field">
        <span className="fl">{ctlLabel(t, c.labelKey)}<em>{c.from === "workspace" ? t("tpl.fromWorkspace") : t("tpl.templateDefault")}</em></span>
        <Swatches label={ctlLabel(t, c.labelKey)} value={typeof v === "string" ? v : null} extra={[st.brandColor, String(st.manifest.defaults[c.key] ?? "")]} disabled={ro} onChange={(x) => s.commit(t("hist.opt", { name: ctlLabel(t, c.labelKey) }), (d) => setOpt(d, c.key, x))} />
      </div>
    )
  }
  if (c.type === "segmented") {
    const v = String(val(c.key) ?? "")
    return (
      <div className="field">
        <span className="fl">{ctlLabel(t, c.labelKey)}</span>
        <Seg label={ctlLabel(t, c.labelKey)} value={v} disabled={ro} options={c.options.map((o) => [o.value, ctlLabel(t, o.labelKey)])} onChange={(x) => s.commit(t("hist.opt", { name: ctlLabel(t, c.labelKey) }), (d) => setOpt(d, c.key, x))} />
      </div>
    )
  }
  if (c.type === "toggle") {
    const v = String(!!val(c.key))
    return (
      <div className="field">
        <span className="fl">{ctlLabel(t, c.labelKey)}</span>
        <Seg label={ctlLabel(t, c.labelKey)} value={v} disabled={ro} options={[["false", t("off")], ["true", t("on")]]} onChange={(x) => s.commit(t("hist.opt", { name: ctlLabel(t, c.labelKey) }), (d) => setOpt(d, c.key, x === "true"))} />
      </div>
    )
  }
  if (c.type === "format") {
    return (
      <div className="field">
        <span className="fl">{t("group.format")}</span>
        <Seg label={t("group.format")} value={fmt} options={c.formats.map((f) => [f, FORMAT_LABEL[f]])} onChange={(f) => setFmt(f as typeof fmt)} />
      </div>
    )
  }
  if (c.type === "guides") {
    return (
      <div className="field">
        <span className="fl">{t("guides.show")}</span>
        <Seg label={t("guides.show")} value={guides ? "1" : "0"} options={[["0", t("off")], ["1", t("guides.on")]]} onChange={(x) => setGuides(x === "1")} />
      </div>
    )
  }
  // messages / words / clips: F-U3 (no F-U1 template declares them)
  return <Memo>{t("tpl.later")}</Memo>
}

// ───────────── Content: the text table (rows), with time, limit and where each line came from ─────────────
function ContentCard({ controls }: { controls: ControlDecl[] }) {
  const U = useU()
  const { t, st, r, decl, label } = U
  const textOf = useTexts()
  const rows: Row[] = []
  for (const c of controls) {
    if (c.type !== "rows") continue
    for (const id of c.layers) {
      const path = `layer:${id}`
      rows.push({ path, layerId: id, itemId: null, label: label(id), mark: label(id).slice(0, 1).toUpperCase(), text: textOf(path, id, null), maxChars: decl(id)?.limits?.maxChars ?? null, hidden: layerOf(U.doc, id)?.visible === false })
    }
    if (c.itemsOf) {
      const items = (r?.textos ?? []).filter((x) => x.layerId === c.itemsOf && x.itemId)
      items.forEach((x, i) => rows.push({ path: x.path, layerId: x.layerId, itemId: x.itemId, label: t("content.item", { n: i + 1 }), mark: String(i + 1), text: textOf(x.path, x.layerId, x.itemId), maxChars: x.maxChars, hidden: false }))
    }
  }
  const timed = controls.some((c) => c.type === "rows" && c.timed)
  return (
    <section className="card">
      <div className="chead"><h2>{t("group.content")}</h2><span className="hint">{t("content.lines", { n: rows.length })}</span></div>
      <p className="sub">{t(timed ? "content.subTimed" : "content.sub")}</p>
      {rows.length ? (
        <div className="lines" style={{ marginTop: 4 }}>
          <div className="lrow hdr"><span /><span>{t("content.at")}</span><span>{t("content.line")}</span><span className="h-src">{t("content.from")}</span></div>
          {rows.map((row) => <ContentRow key={row.path} row={row} prov={st.provenance[row.path]} />)}
        </div>
      ) : <Memo>{t("content.none")}</Memo>}
    </section>
  )
}
function provLabel(t: ReturnType<typeof useU>["t"], p: TextProvenance | undefined) {
  if (!p) return t("prov.template")
  const field = p.field ? (t.has(`brainField.${p.field}` as never) ? t(`brainField.${p.field}` as never) : humanize(p.field)) : null
  if (p.source === "transcript") return t("prov.transcript")
  if (p.source === "brain") return field ? t("prov.brainField", { field }) : t("prov.brain")
  if (p.source === "both") return field ? t("prov.bothField", { field }) : t("prov.both")
  if (p.source === "generic") return t("prov.generic")
  return t("prov.template")
}
function ContentRow({ row, prov }: { row: Row; prov: TextProvenance | undefined }) {
  const U = useU()
  const { t, s, ro, sel, select, issues, userId } = U
  const n = visibleChars(row.text)
  const over = row.maxChars !== null && n > row.maxChars
  const edited = !!prov && row.text !== prov.original
  const inv = issues.filter((i) => i.rule === "invented_number" && i.layerId === row.layerId && (i.itemId ?? null) === row.itemId)
  return (
    <div className={cn("lrow", sel === row.layerId && "sel2")}>
      <span className="mark">{row.mark}</span>
      <button type="button" className="at" onClick={() => select(row.layerId, false)}>{row.hidden ? t("content.hidden") : t("content.whole")}</button>
      <div className="edit">
        <input
          className={cn("inp", over && "over")}
          value={row.text}
          aria-label={row.label}
          disabled={ro}
          onFocus={() => sel !== row.layerId && select(row.layerId, false)}
          onChange={(e) => s.typing(`text:${row.path}`, t("hist.text", { layer: row.label }), (d) => setText(d, row.path, e.target.value))}
          onBlur={() => s.endTyping()}
        />
        {row.maxChars !== null ? <span className={cn("count", over && "over")}><span>{n} / {row.maxChars}</span></span> : null}
      </div>
      <div className="src">
        <span className={cn("tag", edited ? "you" : prov?.source)}>{edited ? t("prov.youEdited") : provLabel(t, prov)}</span>
        {edited ? <q>{t("prov.was", { text: prov!.original })}</q> : prov?.quote ? <q>{prov.quote}</q> : null}
      </div>
      {inv.map((o, i) => (
        <div key={i} className="inv memo warn">
          <EdIcon name="info" />
          <div className="mx">
            <span>{t("number.memo", { n: (o.detail?.numbers ?? []).join(", ") })}</span>
            <div className="acts">
              <button type="button" className="btn sm" disabled={ro} onClick={() => s.commit(t("hist.confirm"), (d) => confirmNumbers(d, row.path, o.detail?.numbers ?? [], userId))}>{t("number.keep")}</button>
              <button type="button" className="btn sm" disabled={ro || !prov} onClick={() => prov && s.commit(t("hist.text", { layer: row.label }), (d) => setText(d, row.path, prov.original))}>{t("number.undo")}</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ───────────── Layer tab: by the layer's kind, only what `editable` allows (§4) ─────────────
export function LayerTab() {
  const U = useU()
  const { t, sel, decl, label, st, doc, s, ro, issues, r, fmt, principal, setTab, phone, select } = U
  const textOf = useTexts()
  if (!sel) return <section className="card"><h2>{t("lyr.noneTitle")}</h2><p className="sub">{t("lyr.noneBody")}</p></section>
  const d = decl(sel)
  if (!d) return null
  if (d.lockedReason === "burned_caption_pixels" || d.kind === "burned") {
    return (
      <section className="card">
        <div className="lhead"><span className="ic"><EdIcon name="lock" /></span><h2>{label(sel)}</h2></div>
        <p className="sub">{t("lyr.burnedBody")}</p>
        <Memo><span>{t("lyr.burnedHow")}</span></Memo>
      </section>
    )
  }
  const L = r?.layout.layers.find((l) => l.id === sel) ?? null
  const ed = d.editable
  const hidden = layerOf(doc, sel)?.visible === false
  const mine = issues.filter((i) => i.layerId === sel && (i.level === "block" || i.level === "warn"))
  const itemsHere = st.manifest.controls.some((c) => c.type === "rows" && c.itemsOf === sel)
  const anyEdit = Object.values(ed).some(Boolean)
  const W = r?.layout.canvas.width ?? 1080
  const H = r?.layout.canvas.height ?? 1920
  const hb = d.kind === "text" && st.templateKey === "headline" ? headlineBase(st, fmt) : null
  const docStyle = (layerOf(doc, sel)?.style ?? {}) as Partial<LayerStyle>
  const style = (k: keyof LayerStyle) => (docStyle[k] ?? (hb?.style as Record<string, unknown> | undefined)?.[k]) as never
  const setStyle = (name: string, p: Partial<LayerStyle>) => s.commit(t("hist.style", { layer: label(sel), name }), (x) => patchLayer(x, sel, { style: p }))
  const gm = geoMode(st, d)

  // geometry from the layout (px of the canvas) → doc
  const rect = L?.rect ?? { x: 0, y: 0, w: 0, h: 0 }
  const tf = (): LayerTransform => {
    const g = geometryOf(doc, sel, fmt, principal)
    if (g.transform) return g.transform
    const scale = hb ? (rect.h * H) / hb.box.h : 1
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, scale, rotationDeg: 0, boxWidth: rect.w }
  }
  const putRect = (n: Rect, what: string) => {
    s.commit(t("hist.field", { layer: label(sel), name: what }), (x) => {
      if (gm.mode === "transform") {
        const t0 = tf()
        const f = n.h / (rect.h || 1)
        return setGeometry(x, sel, fmt, principal, { transform: { ...t0, x: n.x + n.w / 2, y: n.y + n.h / 2, boxWidth: clamp(n.w, 0.1, 1.5), scale: clamp(t0.scale * f, 0.25, 4) } })
      }
      if (d.kind === "video") return setVideoGeo(x, fmt, principal, { box: clampVideoBox(n) })
      return setGeometry(x, sel, fmt, principal, { rect: n })
    })
  }
  const setXYWH = (k: "x" | "y" | "w" | "h", px: number) => {
    const n = { ...rect }
    if (k === "x") n.x = px / W
    if (k === "y") n.y = px / H
    if (k === "w" || k === "h") {
      const f = k === "w" ? px / W / (rect.w || 1) : px / H / (rect.h || 1)
      if (gm.uniform || gm.mode === "transform" && k === "h") { n.w = rect.w * f; n.h = rect.h * f }
      else if (k === "w") n.w = px / W
      else n.h = px / H
    }
    if (n.w <= 0 || n.h <= 0) return
    putRect(n, k.toUpperCase())
  }
  const place = (p: "top" | "mid" | "bot" | "cx") => {
    const n = { ...rect }
    const u = W / 1080
    if (p === "top") n.y = (UI_TOP[fmt] * u) / H
    if (p === "bot") n.y = 1 - (UI_BOT[fmt] * u) / H - rect.h
    if (p === "mid") n.y = 0.5 - rect.h / 2
    if (p === "cx") n.x = 0.5 - rect.w / 2
    putRect(n, t(`lyr.pos.${p}` as never))
  }
  const sizePx = hb ? Math.round(hb.style.fontSizePx * tf().scale * (1080 / W)) : null

  return (
    <section className="card">
      <div className="lhead">
        <span className="ic"><EdIcon name={KIND_ICON[d.kind]} /></span>
        <h2>{label(sel)}</h2>
        <div className="acts">
          {ed.hide || d.optional ? (
            <button type="button" className="btn sm" disabled={ro} onClick={() => s.commit(t(hidden ? "hist.show" : "hist.hide", { layer: label(sel) }), (x) => patchLayer(x, sel, { visible: hidden ? undefined : false }))}>
              {hidden ? t("lyr.show") : t("lyr.hide")}
            </button>
          ) : null}
          {anyEdit ? <button type="button" className="btn sm" disabled={ro} onClick={() => s.commit(t("hist.reset", { layer: label(sel) }), (x) => resetLayer(x, sel))}>{t("lyr.reset")}</button> : null}
        </div>
      </div>
      {mine.map((o, i) => <div key={i} style={{ marginTop: 10 }}><IssueMemo o={o} /></div>)}

      {d.kind === "text" && ed.text && !itemsHere ? (
        <div className="sec">
          <div className="sech">{t("lyr.text")} <small>{t("lyr.accentHint")}</small></div>
          <TextArea id={sel} max={d.limits?.maxChars ?? null} value={textOf(`layer:${sel}`, sel, null)} />
        </div>
      ) : null}
      {itemsHere ? (
        <div className="sec">
          <div className="sech">{t("lyr.lines")}</div>
          <Memo><span>{t("lyr.linesBody")}</span></Memo>
          <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setTab("tpl")}>{t("lyr.openContent")}</button>
        </div>
      ) : null}

      {ed.style ? (
        <div className="sec">
          <div className="sech">{t("lyr.style")}</div>
          <div className="grid2">
            <div className="field">
              <span className="fl">{t("lyr.font")}</span>
              <select className="inp" disabled={ro} value={String(style("fontId") ?? "")} onChange={(e) => setStyle(t("lyr.font"), { fontId: e.target.value as LayerStyle["fontId"] })}>
                {editorFonts(st.fonts, String(style("fontId") ?? "")).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            {sizePx !== null ? (
              <div className="field">
                <span className="fl">{t("lyr.size")} <em>{t("lyr.sizeUnit")}</em></span>
                <div className="nums">
                  <NumField lab="px" value={sizePx} disabled={ro} onCommit={(v) => {
                    const t0 = tf()
                    const scale = clamp((v * (W / 1080)) / hb!.style.fontSizePx, 0.25, 4)
                    s.commit(t("hist.field", { layer: label(sel), name: t("lyr.size") }), (x) => setGeometry(x, sel, fmt, principal, { transform: { ...t0, scale } }))
                  }} />
                </div>
              </div>
            ) : null}
          </div>
          <div className="field"><span className="fl">{t("lyr.color")}</span><Swatches label={t("lyr.color")} disabled={ro} value={style("color") ?? null} onChange={(c) => setStyle(t("lyr.color"), { color: c })} /></div>
          <div className="field"><span className="fl">{t("lyr.accentColor")}</span><Swatches label={t("lyr.accentColor")} disabled={ro} value={style("highlightColor") ?? null} extra={[st.brandColor]} onChange={(c) => setStyle(t("lyr.accentColor"), { highlightColor: c })} /></div>
          <div className="grid2">
            <div className="field"><span className="fl">{t("lyr.align")}</span><Seg label={t("lyr.align")} disabled={ro} value={String(style("align") ?? "center")} options={[["left", t("lyr.left")], ["center", t("lyr.center")], ["right", t("lyr.right")]]} onChange={(v) => setStyle(t("lyr.align"), { align: v as LayerStyle["align"] })} /></div>
            <div className="field"><span className="fl">{t("lyr.caps")}</span><Seg label={t("lyr.caps")} disabled={ro} value={String(!!style("uppercase"))} options={[["false", t("lyr.asTyped")], ["true", t("lyr.allCaps")]]} onChange={(v) => setStyle(t("lyr.caps"), { uppercase: v === "true" })} /></div>
          </div>
        </div>
      ) : null}

      {ed.fill ? (
        <div className="sec">
          <div className="sech">{t("lyr.fill")}</div>
          <Swatches
            label={t("lyr.fill")}
            disabled={ro}
            value={layerOf(doc, sel)?.fill ?? (st.templateKey === "headline" ? headlineBase(st, fmt)?.background.color ?? null : null)}
            extra={[st.brandColor]}
            onChange={(c) => s.commit(t("hist.style", { layer: label(sel), name: t("lyr.fill") }), (x) => patchLayer(x, sel, { fill: c }))}
          />
        </div>
      ) : null}

      {d.kind === "broll" ? (
        <div className="sec">
          <div className="sech">{t("lyr.framing")}</div>
          <Memo><span>{t("lyr.brollNext")}</span></Memo>
        </div>
      ) : null}
      {d.kind === "video" && ed.reframe ? <VideoFramingSec /> : null}
      {d.kind === "video" && ed.trim ? <VideoTrimSec /> : null}

      <div className="sec">
        <div className="sech">{t("lyr.position")} <small>{phone ? t("lyr.positionPhone") : t("lyr.positionDesk")}</small></div>
        {canMove(d) && L ? (
          <>
            <div className="nums">
              <NumField lab="X" value={Math.round(rect.x * W)} disabled={ro || !ed.move} onCommit={(v) => setXYWH("x", v)} />
              <NumField lab="Y" value={Math.round(rect.y * H)} disabled={ro || !ed.move} onCommit={(v) => setXYWH("y", v)} />
              <NumField lab="W" value={Math.round(rect.w * W)} disabled={ro || !ed.resize} onCommit={(v) => setXYWH("w", v)} />
              <NumField lab="H" value={Math.round(rect.h * H)} disabled={ro || !ed.resize} onCommit={(v) => setXYWH("h", v)} />
              {d.kind === "video" ? null : <NumField lab="°" value={Math.round(L.rotationDeg)} disabled onCommit={() => {}} />}
            </div>
            {ed.move ? (
              <div className="rowbtns">
                {(["top", "mid", "bot", "cx"] as const).map((p) => <button key={p} type="button" className="btn sm" disabled={ro} onClick={() => place(p)}>{t(`lyr.pos.${p}` as never)}</button>)}
              </div>
            ) : null}
            {gm.uniform ? <p className="hint" style={{ margin: 0 }}>{t("lyr.uniformHint")}</p> : null}
          </>
        ) : (
          <p className="hint" style={{ margin: 0 }}>{d.kind === "video" ? t(ed.reframe ? "lyr.videoFixedReframe" : "lyr.videoFixed") : t("lyr.fixed")}</p>
        )}
      </div>

      {L && (L.fromSec > 0.05 || L.toSec < (r?.layout.durationSec ?? 0) - 0.05) ? (
        <div className="sec">
          <div className="sech">{t("lyr.when")} <small>{timecode(L.fromSec)} – {timecode(L.toSec)}</small></div>
          <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => { U.seek(L.fromSec + 0.05); select(sel) }}>{t("lyr.jumpStart")}</button>
        </div>
      ) : null}
    </section>
  )
}

function Slider({ lab, value, min, max, step, shown, disabled, onChange, onEnd }: { lab: string; value: number; min: number; max: number; step: number; shown: string; disabled?: boolean; onChange: (v: number) => void; onEnd: () => void }) {
  return (
    <label className="rng">
      <span>{lab}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-valuetext={shown} onChange={(e) => onChange(parseFloat(e.target.value))} onPointerUp={onEnd} onKeyUp={onEnd} onBlur={onEnd} />
      <output>{shown}</output>
    </label>
  )
}

/** Fill/Fit, zoom, pan, Auto reframe, Reframe on canvas. Same controls with or without a mouse (§7.4). */
function VideoFramingSec() {
  const U = useU()
  const { t, s, r, doc, fmt, principal, ro, phone, reframing, setReframing } = U
  const format = useFormatter()
  const f = framingNow(r, doc, fmt, principal)
  const auto = r?.layout.video?.auto ?? !videoGeo(doc, fmt, principal).framing
  const W = r?.layout.canvas.width ?? 1080
  const H = r?.layout.canvas.height ?? 1920
  const put = (field: string, label: string, n: Partial<VideoFraming>) =>
    s.typing(`video:${field}`, label, (d) => setVideoGeo(d, fmt, principal, { framing: clampFraming({ ...framingNow(r, d, fmt, principal), ...n }) }))
  const end = () => s.endTyping()
  const signed = (n: number) => `${n > 0 ? "+" : ""}${format.number(n)} px`
  return (
    <div className="sec">
      <div className="sech">{t("lyr.framing")} <small>{phone ? t("reframe.subPhone") : reframing ? t("reframe.subOn") : t("reframe.subOff")}</small></div>
      <div className="field">
        <span className="fl">{t("reframe.fitLabel")}</span>
        <Seg
          label={t("reframe.fitLabel")}
          disabled={ro}
          value={f.fit}
          options={[["cover", t("reframe.fill")], ["contain_blur", t("reframe.fit")]]}
          onChange={(v) => s.commit(t("hist.reframe"), (d) => setVideoGeo(d, fmt, principal, { framing: { fit: v as VideoFraming["fit"], zoom: 1, panX: 0, panY: 0 } }))}
        />
      </div>
      <Slider lab={t("reframe.zoom")} disabled={ro} min={ZOOM_MIN} max={ZOOM_MAX} step={0.01} value={f.zoom} shown={`${format.number(f.zoom, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`} onChange={(zoom) => put("zoom", t("hist.reframe"), { zoom })} onEnd={end} />
      <Slider lab={t("reframe.panX")} disabled={ro} min={-PAN_MAX} max={PAN_MAX} step={0.002} value={f.panX} shown={signed(Math.round(f.panX * W))} onChange={(panX) => put("panX", t("hist.reframe"), { panX })} onEnd={end} />
      <Slider lab={t("reframe.panY")} disabled={ro} min={-PAN_MAX} max={PAN_MAX} step={0.002} value={f.panY} shown={signed(Math.round(f.panY * H))} onChange={(panY) => put("panY", t("hist.reframe"), { panY })} onEnd={end} />
      <div className="rowbtns">
        <button type="button" className="btn sm" disabled={ro || auto} onClick={() => s.commit(t("hist.autoReframe"), (d) => setVideoGeo(d, fmt, principal, { framing: null }))}>{t("reframe.auto")}</button>
        {phone ? null : <button type="button" className="btn sm" disabled={ro} aria-pressed={reframing} onClick={() => setReframing(!reframing)}>{reframing ? t("reframe.done") : t("reframe.onCanvas")}</button>}
      </div>
      <p className="hint" style={{ margin: 0 }}>{auto ? t("reframe.autoOn") : t("reframe.autoOff")}</p>
    </div>
  )
}

/** Start and end of your video, in seconds of the video itself. Lines outside the trim hide, they aren't deleted (§4). */
function VideoTrimSec() {
  const { t, s, r, ro, time, videoFull, seek } = useU()
  const format = useFormatter()
  const cur = r?.layout.video?.trim
  if (!cur || !videoFull) return null
  const full = videoFull
  const put = (n: { inSec: number; outSec: number }, seekTo: number) => {
    const whole = n.inSec <= full.inSec + 1e-3 && n.outSec >= full.outSec - 1e-3
    s.commit(t("hist.trim"), (d) => setTrim(d, whole ? null : n))
    seek(seekTo)
  }
  const round = (v: number) => Math.round(v * 100) / 100
  const setIn = (v: number) => put({ inSec: round(clamp(v, full.inSec, cur.outSec - MIN_TRIM_SEC)), outSec: cur.outSec }, 0)
  const setOut = (v: number) => {
    const outSec = round(clamp(v, cur.inSec + MIN_TRIM_SEC, full.outSec))
    put({ inSec: cur.inSec, outSec }, outSec - cur.inSec)
  }
  const span = full.outSec - full.inSec || 1
  const here = time + cur.inSec
  const trimmed = cur.inSec > full.inSec + 1e-3 || cur.outSec < full.outSec - 1e-3
  return (
    <div className="sec">
      <div className="sech">{t("trim.title")} <small>{t("trim.sub")}</small></div>
      <div className="trimbar" role="img" aria-label={t("trim.kept", { from: timecode(cur.inSec), to: timecode(cur.outSec) })}>
        <i style={{ left: `${((cur.inSec - full.inSec) / span) * 100}%`, width: `${((cur.outSec - cur.inSec) / span) * 100}%` }} />
        <b style={{ left: `${(clamp(here - full.inSec, 0, span) / span) * 100}%` }} />
      </div>
      <div className="nums">
        <NumField lab={t("trim.start")} step={0.1} value={round(cur.inSec)} disabled={ro} onCommit={setIn} />
        <NumField lab={t("trim.end")} step={0.1} value={round(cur.outSec)} disabled={ro} onCommit={setOut} />
      </div>
      <div className="rowbtns">
        <button type="button" className="btn sm" disabled={ro || here >= cur.outSec - MIN_TRIM_SEC} onClick={() => setIn(here)}>{t("trim.startHere")}</button>
        <button type="button" className="btn sm" disabled={ro || here <= cur.inSec + MIN_TRIM_SEC} onClick={() => setOut(here)}>{t("trim.endHere")}</button>
        <button type="button" className="btn sm" disabled={ro || !trimmed} onClick={() => put({ inSec: full.inSec, outSec: full.outSec }, 0)}>{t("trim.whole")}</button>
      </div>
      <p className="hint" style={{ margin: 0 }}>{t("trim.output", { s: format.number(cur.outSec - cur.inSec, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</p>
    </div>
  )
}

function TextArea({ id, value, max }: { id: string; value: string; max: number | null }) {
  const { s, t, ro, label } = useU()
  const n = visibleChars(value)
  const over = max !== null && n > max
  return (
    <>
      <textarea
        className={cn("inp", over && "over")}
        value={value}
        disabled={ro}
        aria-label={label(id)}
        onChange={(e) => s.typing(`text:layer:${id}`, t("hist.text", { layer: label(id) }), (d) => setText(d, `layer:${id}`, e.target.value))}
        onBlur={() => s.endTyping()}
      />
      {max !== null ? <span className={cn("count", over && "over")}><span>{n} / {max}</span></span> : null}
    </>
  )
}

export function IssueMemo({ o }: { o: EditIssue }) {
  const { t, label } = useU()
  const msg = t(`issue.${o.rule}` as never, { layer: o.layerId ? label(o.layerId) : "", n: (o.detail?.numbers ?? []).join(", "), chars: o.detail?.chars ?? 0, max: o.detail?.maxChars ?? 0 } as never)
  const how = t.has(`fix.${o.rule}` as never) ? ` ${t(`fix.${o.rule}` as never)}` : ""
  return <Memo tone={o.level === "block" ? "bad" : "warn"}><span>{msg}.{how}</span></Memo>
}
