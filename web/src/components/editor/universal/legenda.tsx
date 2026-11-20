"use client"

// Legenda móvel (20/11, protótipo aprovado pelo Gusta): a NOSSA legenda (peças com legenda refeita) vira camada `caption` no
// editor simples. Só sobe e desce, 3 tamanhos, 2 cores. Sem limite duro: fora da faixa segura do Reels/TikTok, em cima do rosto
// ou do título só AVISA (faixa de aviso embaixo do vídeo) e o "Baixar vídeo" continua liberado.
import { useCallback, useEffect, useMemo, useRef } from "react"
import { LEGENDA_CORES_PALAVRA, LEGENDA_CORES_TEXTO, type MolduraProps } from "@maquina/video/player"
import type { EditDocV3, EditIssue, EditLayoutLayer, EditorStateV3, FormatCode } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { EdIcon } from "@/components/editor/ed-icon"
import { useU } from "./context"
import { CAPTION_ID, baseOf, captionY, clamp, layoutLayer, resolve, setCaptionStyle, setCaptionY, type CaptionSize, type Resolved } from "./model"
import { Seg } from "./panel"
import type { UniversalSession } from "./use-universal"

/** Toque anda 2 %; segurar anda contínuo (0,8 % a cada 50 ms depois de 380 ms). Setas: 1 % (Shift 5 %). */
export const STEP_TAP = 0.02
const STEP_HOLD = 0.008
const HOLD_AFTER_MS = 380
const HOLD_EVERY_MS = 50
export const STEP_KEY = 0.01
export const STEP_KEY_SHIFT = 0.05
/** Encaixe magnético na posição original (fração da altura) */
export const SNAP = 0.014

export interface CapWarn { face: boolean; text: boolean; safe: boolean; any: boolean }
export interface CapModel {
  /** a legenda é nossa e dá pra mexer (peça com `caption` no manifesto) */
  has: boolean
  /** a peça usa a legenda original do vídeo (queimada): travada */
  burned: boolean
  layer: EditLayoutLayer | null
  /** centro da legenda (fração da altura) onde o template a põe, e onde ela está agora */
  def: number | null
  cur: number | null
  moved: boolean
  /** > 0 desceu, < 0 subiu (pontos percentuais da altura) */
  deltaPct: number
  size: CaptionSize
  color: string
  highlight: string
  warn: CapWarn
  nudge: (dy: number) => void
  endNudge: () => void
  home: () => void
  setSize: (z: CaptionSize) => void
  setColor: (c: string) => void
  setHighlight: (c: string) => void
}

const SEM_AVISO: CapWarn = { face: false, text: false, safe: false, any: false }
const mesma = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** Tudo que o painel, a prévia e o teclado precisam da legenda, calculado uma vez no editor. */
export function useCaptionModel(a: { st: EditorStateV3; doc: EditDocV3; fmt: FormatCode; principal: FormatCode; r: Resolved | null; issues: EditIssue[]; s: UniversalSession; t: (k: never, v?: never) => string; ro: boolean }): CapModel {
  const { st, doc, fmt, principal, r, issues, s, t, ro } = a
  const has = st.manifest.layers.some((l) => l.id === CAPTION_ID && l.kind === "caption")
  const burned = !has && st.manifest.layers.some((l) => l.kind === "burned")
  const layer = has ? layoutLayer(r, CAPTION_ID) : null
  // onde o template põe a legenda (com o tamanho de agora): resolve o doc sem a posição deste formato
  const semPos = useMemo(() => JSON.stringify(has ? setCaptionY(doc, fmt, principal, null) : null), [has, doc, fmt, principal])
  const def = useMemo(() => {
    if (!has) return null
    const l = layoutLayer(resolve(st, JSON.parse(semPos) as EditDocV3, fmt), CAPTION_ID)
    return l && l.rect.h > 0 ? l.rect.y + l.rect.h / 2 : null
  }, [has, st, semPos, fmt])
  const cur = layer && layer.rect.h > 0 ? layer.rect.y + layer.rect.h / 2 : null
  const h = layer?.rect.h ?? 0
  const delta = cur !== null && def !== null ? (cur - def) * 100 : 0
  const moved = captionY(doc, fmt, principal) !== null && Math.abs(delta) >= 0.5
  const doc0 = doc.layers.find((l) => l.id === CAPTION_ID)
  const size: CaptionSize = (doc0?.style?.size as CaptionSize | undefined) ?? "md"
  const cap = (baseOf(st, fmt) as unknown as MolduraProps | null)?.captions
  const color = (doc0?.style?.color ?? cap?.style?.color ?? "#ffffff").toLowerCase()
  const highlight = (doc0?.style?.highlightColor ?? (cap?.style ? cap.style.highlightColor ?? cap.style.color : cap?.highlightColor) ?? "").toLowerCase()
  const warn = useMemo<CapWarn>(() => {
    const mine = issues.filter((i) => i.layerId === CAPTION_ID)
    const w = { face: mine.some((i) => i.rule === "caption_over_face"), text: mine.some((i) => i.rule === "caption_over_text"), safe: mine.some((i) => i.rule === "caption_off_safe") }
    return w.face || w.text || w.safe ? { ...w, any: true } : SEM_AVISO
  }, [issues])

  // o que o passo precisa de "agora", pra o botão segurado não usar um valor velho
  const live = useRef({ def, h, fmt, principal })
  useEffect(() => {
    live.current = { def, h, fmt, principal }
  })
  const label = t("hist.move" as never, { layer: t("layer.caption" as never) } as never)
  const nudge = useCallback((dy: number) => {
    s.typing("cap:move", label, (d) => {
      const L = live.current
      const y0 = captionY(d, L.fmt, L.principal) ?? L.def ?? 0.7
      const lo = L.h / 2, hi = 1 - L.h / 2
      const y = clamp(y0 + dy, lo, Math.max(lo, hi))
      // voltou ao lugar: sai do doc
      if (L.def !== null && Math.abs(y - L.def) < 0.004) return setCaptionY(d, L.fmt, L.principal, null)
      return setCaptionY(d, L.fmt, L.principal, y)
    })
  }, [s, label])
  const endNudge = useCallback(() => s.endTyping(), [s])
  const home = useCallback(() => s.commit(label, (d) => setCaptionY(d, live.current.fmt, live.current.principal, null)), [s, label])
  const styleLabel = (nameKey: string) => t("hist.style" as never, { layer: t("layer.caption" as never), name: t(nameKey as never) } as never)
  const setSize = useCallback((z: CaptionSize) => s.commit(styleLabel("simples.cap.size"), (d) => setCaptionStyle(d, { size: z })), [s]) // eslint-disable-line react-hooks/exhaustive-deps
  const setColor = useCallback((c: string) => s.commit(styleLabel("simples.cap.color"), (d) => setCaptionStyle(d, { color: c })), [s]) // eslint-disable-line react-hooks/exhaustive-deps
  const setHighlight = useCallback((c: string) => s.commit(styleLabel("simples.cap.highlight"), (d) => setCaptionStyle(d, { highlightColor: c })), [s]) // eslint-disable-line react-hooks/exhaustive-deps
  void ro
  return { has, burned, layer, def, cur, moved, deltaPct: Math.round(delta), size, color, highlight, warn, nudge, endNudge, home, setSize, setColor, setHighlight }
}

/** Botão de subir/descer: toque = 2 %, segurar = anda contínuo; um passo só no desfazer por gesto. Teclado (Enter/Espaço) = 1 toque. */
function HoldBtn({ dir, children, disabled }: { dir: -1 | 1; children: React.ReactNode; disabled: boolean }) {
  const { cap } = useU()
  const latest = useRef(cap)
  useEffect(() => {
    latest.current = cap
  })
  const timers = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({})
  const parar = useCallback(() => {
    clearTimeout(timers.current.t)
    clearInterval(timers.current.i)
    timers.current = {}
    latest.current.endNudge()
  }, [])
  useEffect(() => parar, [parar])
  return (
    <button
      type="button"
      className="btn big"
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button > 0) return
        latest.current.nudge(dir * STEP_TAP)
        timers.current.t = setTimeout(() => {
          timers.current.i = setInterval(() => latest.current.nudge(dir * STEP_HOLD), HOLD_EVERY_MS)
        }, HOLD_AFTER_MS)
      }}
      onPointerUp={parar}
      onPointerLeave={() => timers.current.t !== undefined && parar()}
      onPointerCancel={parar}
      // clique vindo do teclado (detail 0): um passo, um item no desfazer
      onClick={(e) => {
        if (e.detail !== 0) return
        latest.current.nudge(dir * STEP_TAP)
        latest.current.endNudge()
      }}
    >
      {children}
    </button>
  )
}

function CapSwatches({ lista, value, other, onChange, label, disabled }: { lista: readonly string[]; value: string; other: string; onChange: (c: string) => void; label: string; disabled: boolean }) {
  const { t } = useU()
  return (
    <div className="sws capsw" role="radiogroup" aria-label={label}>
      {lista.map((c) => {
        const nome = t(`simples.cap.c_${c.slice(1)}` as never)
        const usada = mesma(c, other)
        return (
          <button
            key={c}
            type="button"
            role="radio"
            className={cn("sw", usada && "taken")}
            style={{ background: c }}
            aria-label={nome}
            aria-checked={mesma(c, value)}
            title={usada ? `${nome} · ${t("simples.cap.taken")}` : nome}
            disabled={disabled || usada}
            onClick={() => !mesma(c, value) && onChange(c)}
          />
        )
      })}
    </div>
  )
}

/** Aba Estilo, peça com legenda nossa. */
export function LegendaCard() {
  const U = useU()
  const { t, cap, ro, phone, sel } = U
  if (!cap.has) return null
  const pos = !cap.moved ? t("simples.cap.posHome") : cap.deltaPct < 0 ? t("simples.cap.posUp", { n: Math.abs(cap.deltaPct) }) : t("simples.cap.posDown", { n: cap.deltaPct })
  return (
    <section className={cn("card capcard", sel === "caption" && "hi")} id="legenda-card" aria-label={t("simples.cap.title")}>
      <div className="chead"><h2>{t("simples.cap.title")}</h2><span className="hint">{t("simples.cap.sub")}</span></div>
      <p className="sub" style={{ margin: "4px 0 12px" }}>{t(phone ? "simples.cap.hintPhone" : "simples.cap.hintDesktop")}</p>
      <div className="field">
        <span className="fl">{t("simples.cap.position")}<em>{pos}</em></span>
        <div className="caprow">
          <HoldBtn dir={-1} disabled={ro}><EdIcon name="up" />{t("simples.cap.higher")}</HoldBtn>
          <HoldBtn dir={1} disabled={ro}><EdIcon name="down" />{t("simples.cap.lower")}</HoldBtn>
        </div>
        <button type="button" className="linkbtn" disabled={ro || !cap.moved} onClick={cap.home}>{t("simples.cap.home")}</button>
      </div>
      <div className="field">
        <span className="fl">{t("simples.cap.size")}</span>
        <Seg label={t("simples.cap.size")} value={cap.size} disabled={ro} options={[["sm", t("simples.cap.sm")], ["md", t("simples.cap.md")], ["lg", t("simples.cap.lg")]]} onChange={(v) => cap.setSize(v as CaptionSize)} />
      </div>
      <div className="field">
        <span className="fl">{t("simples.cap.color")}</span>
        <CapSwatches lista={LEGENDA_CORES_TEXTO} value={cap.color} other={cap.highlight} onChange={cap.setColor} label={t("simples.cap.color")} disabled={ro} />
      </div>
      <div className="field">
        <span className="fl">{t("simples.cap.highlight")}</span>
        <CapSwatches lista={LEGENDA_CORES_PALAVRA} value={cap.highlight} other={cap.color} onChange={cap.setHighlight} label={t("simples.cap.highlight")} disabled={ro} />
      </div>
      <p className="hint" style={{ margin: "2px 0 0" }}>{t("simples.cap.outlineNote")}</p>
    </section>
  )
}

/** Aba Estilo, peça com a legenda original do vídeo: só o cadeado e o texto, sem controles. */
export function LegendaTravada() {
  const { t, cap } = useU()
  if (!cap.burned) return null
  return (
    <section className="card capcard" aria-label={t("simples.cap.title")}>
      <div className="chead"><h2>{t("simples.cap.title")}</h2></div>
      <div className="lockcard"><EdIcon name="lock" /><p>{t("simples.cap.burnedPanel")}</p></div>
    </section>
  )
}
