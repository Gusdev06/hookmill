"use client"

import { useEffect } from "react"
import { useFormatter, useTranslations } from "next-intl"
import type { AutoInsight, AutoVariationType, IteratePiece, FileRef, FormatCode, FrameTemplateId, IterateBatch, PieceFormat, PieceFormatState, VariationAxis } from "@/lib/api/types"
import { FlowBar } from "@/components/flow-bar"
import { NavIcon } from "@/components/shell/nav-icon"
import { useSession } from "@/components/providers/session-provider"
import { iterateHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import "./iterate.css"

/* Building blocks of the automatic variation screens (design/variacao-auto-v1-2026-10-12.md §7, skin fase2 §3-4). */

/** 25/10 (estatico-montado-e-molduras-v1 §C.0, TRANSIÇÃO): the API sends `type: 'FRAME'` before the architect merges it into
 *  `AutoVariationType`; the web reads the superset so nothing breaks on either side of the merge. */
export type PieceType = AutoVariationType
export const pieceType = (p: Pick<IteratePiece, "type">) => p.type as PieceType

// ───────────── headline-e-legenda-v1 (25/10, TRANSIÇÃO) ─────────────
/** HEADLINE piece: the champion's headline and the new one (`original: null` = the champion had none, mode `add`). */
export const pieceHeadline = (p: IteratePiece) => (p as IteratePiece).headline ?? null
/** §2.1: the champion has no burned-in captions, so every video piece of the batch gets word-by-word captions. */
export const captionsAuto = (b: Pick<IterateBatch, "insight">) => (b.insight as AutoInsight | null)?.captionsAuto === true

/** "original → new" of a HEADLINE piece; the highlight of the new one in bold. `compact` = one block, smaller. */
export function HeadlineChange({ p, compact, className }: { p: IteratePiece; compact?: boolean; className?: string }) {
  const t = useTranslations("iterate.headline")
  const h = pieceHeadline(p)
  if (!h) return null
  const i = h.highlight ? h.text.indexOf(h.highlight) : -1
  const fresh =
    i >= 0 ? (
      <>
        {h.text.slice(0, i)}
        <b className="font-extrabold">{h.highlight}</b>
        {h.text.slice(i + h.highlight!.length)}
      </>
    ) : (
      h.text
    )
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-md border border-line-soft bg-card-2 px-2.5 py-2", compact ? "text-xs" : "text-[13px]", className)}>
      <span className="text-fg-3 [overflow-wrap:anywhere]">
        {h.original ? <s className="decoration-fg-3/60">“{h.original}”</s> : <i>{t("none")}</i>}
      </span>
      <span className="flex min-w-0 items-start gap-1.5 font-semibold text-fg [overflow-wrap:anywhere]">
        <span aria-hidden="true" className="text-fg-3">→</span>
        <span className="sr-only">{t("becomes")}</span>
        <span>“{fresh}”</span>
      </span>
    </div>
  )
}

/** Batch badge (§2): "Captions added" when `captionsAuto` is on; a one-line why under it. */
export function CaptionsBadge({ batch }: { batch: Pick<IterateBatch, "insight"> }) {
  const t = useTranslations("iterate.captions")
  if (!captionsAuto(batch)) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <Tag tone="info">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 12h3M12 12h5M7 15.5h6M15 15.5h2" />
        </svg>
        {t("badge")}
      </Tag>
      <span className="text-xs text-fg-3">{t("why")}</span>
    </div>
  )
}

// ───────────── layout ─────────────
/** mockup .wrap: one column of 1160 px; extra bottom room for the sticky / fixed action bar. */
export function IterWrap({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-5 px-[var(--gut)] pt-4 pb-[170px] tablet:pt-6 tablet:pb-8">{children}</div>
}
/** mockup .cols: work on the left, the dark panel on the right (drops below at ≤900 px, flex-wrap). */
export function Cols({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">{main}</div>
      <aside className="flex max-w-full min-w-0 flex-[1_1_300px] flex-col gap-4 desktop:sticky desktop:top-4">{side}</aside>
    </div>
  )
}
export function Head({ eyebrow, title, lede }: { eyebrow?: React.ReactNode; title: React.ReactNode; lede?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h1>{title}</h1>
      {lede ? <p className="m-0 max-w-[680px] text-fg-3 text-pretty">{lede}</p> : null}
    </div>
  )
}
export function Card({ children, className, ...rest }: React.ComponentProps<"section">) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-card p-[18px]", className)} {...rest}>
      {children}
    </section>
  )
}

/** FlowBar of the 3 steps, current step from the batch phase (or the screen being viewed). */
export function IterFlow({ current, running, batchId, done }: { current: "analyze" | "generate" | "download"; running?: boolean; batchId?: string; done?: "generate" | "download" }) {
  const { session } = useSession()
  const hrefs = batchId
    ? { analyze: iterateHref(batchId, "analyze"), generate: iterateHref(batchId, "generate"), ...(done === "download" ? { download: iterateHref(batchId, "download") } : {}) }
    : {}
  return <FlowBar flow="iterate" current={current} running={running} client={session.workspace.name} hrefs={hrefs} />
}

/**
 * Action bar (fase2 §2.6): sticky card at the bottom on desktop, fixed full width on the phone with the safe area.
 * Hint on the left, one lime action per screen.
 */
export function IterActionBar({ hint, children }: { hint: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.style.setProperty("--toast-bottom", "120px")
    return () => {
      document.documentElement.style.removeProperty("--toast-bottom")
    }
  }, [])
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-2.5 border-t border-line bg-card px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] shadow-[0_-6px_24px_rgba(21,23,26,0.06)] tablet:sticky tablet:mt-1 tablet:rounded-lg tablet:border tablet:py-2.5 tablet:pr-2.5 tablet:pl-[18px]">
      <span className="min-w-0 flex-[1_1_100%] text-[13px] text-fg-2 tablet:flex-[1_1_220px]">{hint}</span>
      <div className="grid w-full auto-cols-auto grid-flow-col grid-cols-[auto_1fr] gap-2 has-[>:only-child]:grid-cols-1 tablet:flex tablet:w-auto tablet:flex-wrap [&>*]:w-full tablet:[&>*]:w-auto">
        {children}
      </div>
    </div>
  )
}

// ───────────── small pieces ─────────────
/** mockup .code: the variable's code (same as in the file name), mono. */
export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("rounded-[6px] border border-line-soft bg-card-2 px-[7px] py-0.5 font-mono text-xs font-semibold tracking-[0.02em] whitespace-nowrap", className)}>
      {children}
    </span>
  )
}
type TagTone = "ok" | "warn" | "bad" | "info" | "neutral" | "ink"
const TAG: Record<TagTone, string> = {
  ok: "bg-status-approved-bg text-status-approved",
  warn: "bg-status-waiting-bg text-status-waiting",
  bad: "bg-status-failed-bg text-status-failed",
  info: "bg-status-progress-bg text-status-progress",
  neutral: "border border-line-soft bg-card-2 text-fg-2",
  ink: "bg-fg text-brand",
}
export function Tag({ tone, children, className }: { tone: TagTone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-fit items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap", TAG[tone], className)}>{children}</span>
}
/** Iteration = neutral tag (Stretch), diversity = ink tag with lime text (New audience). Not a status. */
export function AxisTag({ axis, short, className }: { axis: VariationAxis; short?: boolean; className?: string }) {
  const t = useTranslations("iterate")
  const label = axis === "ITERATION" ? (short ? t("download.tagStretch") : t("analyze.stretch")) : short ? t("download.tagNew") : t("analyze.newAudience")
  return (
    <Tag tone={axis === "ITERATION" ? "neutral" : "ink"} className={className}>
      {label}
    </Tag>
  )
}
export function Dot({ pulse }: { pulse?: boolean }) {
  return <span className={cn("size-2 flex-none rounded-full bg-current", pulse && "animate-pulse")} aria-hidden="true" />
}

/** Plain bar (mockup .bar). On ink the track is ink-line and the fill lime. */
export function Bar({ value, ink, className, label }: { value: number; ink?: boolean; className?: string; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-2 overflow-hidden rounded-full", ink ? "bg-ink-line" : "bg-line-soft", className)}
    >
      <i className={cn("block h-full rounded-full transition-[width] duration-500", ink ? "bg-brand" : "bg-fg")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

// ───────────── the dark instrument panel (fase2 §2.4) ─────────────
export function InkPanel({ label, beam, children, className, ...rest }: { label: React.ReactNode; beam?: boolean } & React.ComponentProps<"div">) {
  return (
    <div className={cn("on-ink relative flex min-w-0 flex-col gap-4 rounded-xl bg-ink p-[22px] text-ink-body", beam && "beam", className)} {...rest}>
      <span className="eyebrow text-ink-fg-2">{label}</span>
      {children}
    </div>
  )
}
export function InkBig({ value, unit }: { value: React.ReactNode; unit: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="font-mono text-[42px] leading-none font-semibold text-brand tabular-nums tablet:text-[54px]">{value}</span>
      <span className="font-semibold text-white">{unit}</span>
    </div>
  )
}
export function InkList({ rows, className }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-2.5 p-0", className)}>
      {rows.map(([k, v], i) => (
        <li key={i} className="flex justify-between gap-2.5 border-b border-ink-line pb-2.5 last:border-b-0 last:pb-0">
          <span className="text-ink-fg-2">{k}</span>
          <span className="text-right font-semibold text-white">{v}</span>
        </li>
      ))}
    </ul>
  )
}
export function InkNote({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[13px] text-ink-fg-2">{children}</p>
}

// ───────────── TypeThumb ─────────────
const TONES = ["night", "plum", "sand", "dawn"] as const
const SEARCH_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="#5F6368" strokeWidth={2.4} aria-hidden="true">
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </svg>
)
function V({ tone = "night", style }: { tone?: string; style?: React.CSSProperties }) {
  return (
    <div className={`v tn-${tone}`} style={style}>
      <i className="o" />
      <i className="p" />
      <i className="m" />
    </div>
  )
}
function Art({ type, tone }: { type: PieceType | "orig"; tone: string }) {
  switch (type) {
    case "CUT":
      return (
        <>
          <V tone={tone} />
          <span className="chipf" style={{ top: "5%", left: "6%" }}>↘ 0:15</span>
          <div className="tlf">
            <i style={{ ["--w" as string]: 1 }} /><i className="x" style={{ ["--w" as string]: 2 }} /><i style={{ ["--w" as string]: 2 }} /><i className="x" style={{ ["--w" as string]: 1 }} /><i style={{ ["--w" as string]: 1.4 }} />
          </div>
        </>
      )
    case "COLD_OPEN":
      return (
        <>
          <V tone="sand" />
          <span className="chipf" style={{ top: "5%", left: "6%" }}>→ 0:00</span>
          <div className="tlf">
            <i className="y" style={{ ["--w" as string]: 1.3 }} /><i /><i style={{ ["--w" as string]: 2 }} /><i style={{ ["--w" as string]: 2 }} /><i style={{ ["--w" as string]: 1.4 }} />
          </div>
        </>
      )
    case "HOOK_TEXT":
      return (
        <>
          <V tone={tone} />
          <div className="capt"><i style={{ width: "92%" }} /><i style={{ width: "64%" }} /></div>
        </>
      )
    case "ENDCARD":
      return (
        <div className="ec">
          <b /><b /><span /><u />
        </div>
      )
    case "SPLIT_LP":
      return (
        <>
          <div className="lp" style={{ left: 0, right: 0, top: 0, height: "46%" }}>
            <div className="nb"><b /><i /></div>
            <div className="pr" />
            <div className="pt" />
            <div className="by" />
          </div>
          <V tone={tone} style={{ top: "46%" }} />
        </>
      )
    case "STORY":
      return (
        <>
          <V tone="plum" />
          <div className="sb"><i /><i /><i /></div>
          <div className="sn"><i /><b /></div>
          <div className="rp" />
        </>
      )
    case "REVIEW":
      return (
        <>
          <div className="v" style={{ background: "#F3EEE4" }} />
          <div className="rv">
            <span className="stars">★★★★★</span>
            <i style={{ width: "94%" }} /><i style={{ width: "70%" }} /><i className="s" />
          </div>
          <V tone={tone} style={{ top: "46%", left: "10%", right: "10%", bottom: "4%", borderRadius: "4cqw" }} />
        </>
      )
    case "NATIVE_SEARCH":
      return (
        <>
          <div className="v" style={{ background: "#F6F6F4" }} />
          <div className="srch">{SEARCH_SVG}<b /><u /></div>
          <div className="res"><i /><i /><i /></div>
          <V tone={tone} style={{ top: "44%" }} />
        </>
      )
    case "STATIC":
      return (
        <>
          <V tone="ink" />
          <div className="hl"><i style={{ width: "96%" }} /><i style={{ width: "88%" }} /><i style={{ width: "54%" }} /></div>
          <span className="chipf" style={{ bottom: "5%", right: "6%" }}>PNG</span>
        </>
      )
    case "HEADLINE":
      return (
        <>
          <V tone={tone} />
          <div className="capt" style={{ top: "4%", left: "4%", right: "4%", padding: "2cqw 0", background: "#f7e04b", borderRadius: "1.5cqw" }}>
            <i style={{ width: "86%", background: "#17191c" }} />
            <i style={{ width: "58%", background: "#17191c" }} />
          </div>
        </>
      )
    case "FRAME":
      return (
        <>
          <div className="v" style={{ background: "#F3EEE4" }} />
          <div className="capt" style={{ top: "6%" }}>
            <i style={{ width: "90%", background: "#1e2550" }} />
            <i style={{ width: "60%", background: "#1e2550" }} />
          </div>
          <V tone={tone} style={{ top: "26%", left: "8%", right: "8%", bottom: "16%", borderRadius: "3cqw" }} />
        </>
      )
    case "CHAT_DM":
      // iterate-v2 F1.9: conversa do Direct desenhada (sem pessoa)
      return (
        <>
          <div className="v" style={{ background: "#0b0b0d" }} />
          <div className="capt" style={{ top: "5%" }}><i style={{ width: "80%", background: "#f2c14e" }} /></div>
          <div style={{ position: "absolute", right: "8%", top: "26%", width: "58%", height: "12%", borderRadius: "3cqw", background: "linear-gradient(135deg,#7b3ff2,#3797f0)" }} />
          <div style={{ position: "absolute", left: "8%", top: "42%", width: "62%", height: "12%", borderRadius: "3cqw", background: "#262626" }} />
          <div style={{ position: "absolute", left: "8%", top: "58%", width: "50%", height: "9%", borderRadius: "3cqw", background: "#262626" }} />
          <div style={{ position: "absolute", left: "6%", right: "6%", bottom: "6%", height: "7%", borderRadius: "4cqw", background: "#1c1c1e" }} />
        </>
      )
    case "PERSON_MOTION":
      // iterate-v2 F1.9: palco de motion em cima, rosto do próprio anúncio na caixa redonda embaixo
      return (
        <>
          <div className="v" style={{ background: "#0b0a10" }} />
          <div className="capt" style={{ top: "12%" }}><i style={{ width: "84%" }} /><i style={{ width: "56%", background: "#f2c14e" }} /></div>
          <div style={{ position: "absolute", left: "50%", bottom: "8%", width: "38%", aspectRatio: "1", translate: "-50% 0", borderRadius: "50%", border: "1cqw solid #f2c14e", overflow: "hidden" }}>
            <V tone={tone} />
          </div>
        </>
      )
    default:
      return <V tone={tone} />
  }
}

/**
 * TypeThumb (spec §7): the piece's poster once rendered; before that, the illustration of its type (same frames as the
 * catalog). `play` adds the play badge of the result grid.
 */
export function TypeThumb({
  type, poster, tone = 0, play, label, className,
}: { type: PieceType | "orig"; poster?: FileRef | null; tone?: number; play?: boolean; label?: string; className?: string }) {
  return (
    <div className={cn("tf", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, expires
        <img src={poster.url} alt="" loading="lazy" decoding="async" />
      ) : (
        <Art type={type} tone={TONES[tone % TONES.length]} />
      )}
      {play ? (
        <span className="play">
          <NavIcon name="play" size={12} />
        </span>
      ) : null}
    </div>
  )
}

/** Waiting thumbnails: Image Generation while rendering, dashed while queued (mockup .imggen / .qthumb). */
export function GenThumb({ queued, className }: { queued?: boolean; className?: string }) {
  return queued ? (
    <div className={cn("aspect-[9/16] rounded-sm border border-dashed border-control bg-card-2", className)} aria-hidden="true" />
  ) : (
    <div className={cn("imggen aspect-[9/16] rounded-sm border border-line", className)} aria-hidden="true" />
  )
}

// ───────────── formatting ─────────────
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
export const FORMAT_LABEL = { "9x16": "9:16", "4x5": "4:5", "1x1": "1:1" } as const
export const FORMAT_CODES: readonly FormatCode[] = ["9x16", "4x5", "1x1"]
export const FORMAT_ASPECT: Record<FormatCode, string> = { "9x16": "aspect-[9/16]", "4x5": "aspect-[4/5]", "1x1": "aspect-square" }
export const FORMAT_PX: Record<FormatCode, [number, number]> = { "9x16": [1080, 1920], "4x5": [1080, 1350], "1x1": [1080, 1080] }

// ───────────── formats per piece (variacao-auto-v1 §14.2) ─────────────
/** STATIC = an image created from scratch (GPT Image 2), not a frame of the video. */
export const isImagePiece = (p: Pick<IteratePiece, "media" | "type">) => (p.media ?? (p.type === "STATIC" ? "image" : "video")) === "image"

/**
 * The piece's 3 formats in the order 9:16, 4:5, 1:1. `formats[]` comes from the API (rev. 23/10); while an API without it
 * answers (TRANSIÇÃO), it is derived from `files` (ready) and the current render, and nothing can be requested.
 */
export function pieceFormats(p: IteratePiece): PieceFormat[] {
  if (p.formats?.length) return FORMAT_CODES.map((c) => p.formats!.find((f) => f.format === c) ?? { format: c, state: "none", progress: null, errorCode: null, failReason: null, requestUsd: null })
  return FORMAT_CODES.map((format) => {
    const ready = p.files.some((f) => f.format === format)
    const running = p.render?.format === format
    const lead = format === "9x16"
    const state: PieceFormatState = ready ? "ready" : running ? "rendering"
      : lead && p.status === "failed" ? "failed" : lead && (p.status === "queued" || p.status === "rendering") ? "queued" : "none"
    return {
      format, state, progress: running ? p.render!.progress : null,
      errorCode: state === "failed" ? p.errorCode : null, failReason: state === "failed" ? p.failReason : null, requestUsd: null,
    }
  })
}
/** §B4 (25/10): false = the frame template has no such format; the web hides its button. Absent = true. */
export const isSupported = (f: PieceFormat) => f.supported !== false
/** Formats the user can still ask for (4:5 / 1:1 not made, or failed; never one the template doesn't have). */
export const canAsk = (f: PieceFormat) => isSupported(f) && f.format !== "9x16" && (f.state === "none" || f.state === "failed")

/**
 * Format chip of the Download card (and the preview tabs): state per format. Ready = green check; queued/rendering =
 * progress; failed = red, press to try again; not made = dashed "+ 4:5", press to make it. CLIENT sees the state only.
 */
export function FormatChip({ f, canMake, busy, priceLabel, onMake }: { f: PieceFormat; canMake: boolean; busy?: boolean; priceLabel?: string | null; onMake?: () => void }) {
  const t = useTranslations("iterate.formats")
  const tt = useTranslations("iterate.textCheck")
  if (!isSupported(f)) return null
  const label = FORMAT_LABEL[f.format]
  const base = "inline-flex min-h-7 items-center gap-[3px] rounded-full px-[6px] text-[11px] font-bold whitespace-nowrap tabular-nums"
  const ask = canMake && canAsk(f) && !!onMake
  const title = f.state === "failed" ? t("retryAria", { format: label }) : t("makeAria", { format: label })
  const aria = priceLabel ? `${title} · ${priceLabel}` : title
  // §A10: a ready STATIC format whose own text check found an error (PieceFormat.textCheck)
  const tcBad = f.state === "ready" && f.textCheck?.status === "mismatch"
  if (tcBad) {
    const crit = (f.textCheck!.extraText?.length ?? 0) > 0 || f.textCheck!.items.some((i) => i.critical && i.match === false)
    return (
      <span className={cn(base, crit ? "bg-status-failed-bg text-status-failed" : "bg-status-waiting-bg text-status-waiting")} aria-label={tt("chip.formatError", { format: label })} title={tt("chip.formatError", { format: label })}>
        <NavIcon name="alert" size={11} strokeWidth={2.6} />
        {label}
      </span>
    )
  }
  if (f.state === "ready")
    return (
      <span className={cn(base, "bg-status-approved-bg text-status-approved")} aria-label={t("readyAria", { format: label })}>
        <NavIcon name="check" size={11} strokeWidth={3} />
        {label}
      </span>
    )
  if (f.state === "queued" || f.state === "rendering")
    return (
      <span className={cn(base, "bg-status-progress-bg text-status-progress")} aria-label={f.state === "queued" ? t("queuedAria", { format: label }) : t("renderingAria", { format: label, p: f.progress ?? 0 })}>
        <Dot pulse={f.state === "rendering"} />
        {label}
        {f.state === "rendering" && f.progress !== null ? <span className="font-mono font-medium">{f.progress}%</span> : null}
      </span>
    )
  if (!ask)
    return (
      <span
        className={cn(base, f.state === "failed" ? "bg-status-failed-bg text-status-failed" : "border border-dashed border-control text-fg-3")}
        aria-label={f.state === "failed" ? t("failedAria", { format: label }) : t("noneAria", { format: label })}
      >
        {label}
      </span>
    )
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onMake}
      title={aria}
      aria-label={aria}
      className={cn(
        base,
        "cursor-pointer transition-colors disabled:cursor-wait disabled:opacity-60",
        f.state === "failed" ? "bg-status-failed-bg text-status-failed hover:brightness-95" : "border border-dashed border-control bg-transparent text-fg-2 hover:border-fg hover:text-fg"
      )}
    >
      {f.state === "failed" ? <NavIcon name="refresh" size={11} strokeWidth={2.5} /> : <span aria-hidden="true">+</span>}
      {label}
    </button>
  )
}

export function useIterFormat() {
  const format = useFormatter()
  const t = useTranslations("iterate.analyze")
  return {
    usd: (v: number) => format.number(v, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    eta: (sec: number | null) => (sec === null ? null : sec < 90 ? t("aboutSec", { n: Math.max(5, Math.round(sec / 5) * 5) }) : t("aboutMin", { n: Math.round(sec / 60) })),
    size: (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${bytes ? Math.max(1, Math.round(bytes / 1024 ** 2)) : 0} MB`),
  }
}

/** Name of the type in the interface language. */
export function useTypeName() {
  const t = useTranslations("iterate.analyze.type")
  return (type: PieceType) => t(type)
}

/** Name of the piece: the type, or "Frame · News" for a FRAME (template name by i18n, §B2). */
export function usePieceName() {
  const t = useTranslations("iterate")
  const typeName = useTypeName()
  return (p: Pick<IteratePiece, "type" | "frame">) =>
    pieceType(p) === "FRAME" && p.frame ? t("frame.named", { name: t(`frame.name.${p.frame.template}`) }) : typeName(pieceType(p))
}

/** Type line of a piece: the template icon for a FRAME, then its name. */
export function PieceKind({ p, className }: { p: Pick<IteratePiece, "type" | "frame"> & { isNewTemplate?: boolean }; className?: string }) {
  const name = usePieceName()
  const t = useTranslations("iterate")
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {pieceType(p) === "FRAME" && p.frame ? <FrameIcon id={p.frame.template} className="flex-none" /> : null}
      <span className="min-w-0">{name(p)}</span>
      {/* iterate-v2 F1.9: selo dos templates grátis */}
      {p.isNewTemplate ? <span className="flex-none rounded-full border border-current px-1.5 text-[10px] leading-4 opacity-80">{t("template.badge")}</span> : null}
    </span>
  )
}

/* One quiet line glyph per frame template (own SVG, no third-party logos — contract D12). */
const FRAME_GLYPH: Record<FrameTemplateId, React.ReactNode> = {
  question_box: <><path d="M4 5h16v11H10l-4 3.5V16H4z" /><path d="M10.2 9.2a1.9 1.9 0 1 1 2.5 1.8c-.5.2-.7.5-.7 1v.3" /><path d="M12 14.2v.1" /></>,
  meme: <><circle cx="12" cy="12" r="8" /><path d="M8.5 13.5c.9 1.4 2.1 2 3.5 2s2.6-.6 3.5-2" /><path d="M9.5 9.5v.5M14.5 9.5v.5" /></>,
  cinema: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M3 15h18M7.5 5v4M12 5v4M16.5 5v4M7.5 15v4M12 15v4M16.5 15v4" /></>,
  news: <><rect x="3" y="4" width="14" height="16" rx="1.5" /><path d="M17 8h3v10a2 2 0 0 1-2 2H5" /><path d="M6.5 8h7M6.5 12h7M6.5 16h4" /></>,
  ranking: <><path d="M3 20h18M5 20v-6h4v6M10 20V8h4v12M15 20v-4h4v4" /><path d="M12 3.5l.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2z" /></>,
  post_card: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="7.5" cy="9.5" r="1.8" /><path d="M11 9h6M7 13.5h10M7 16h7" /></>,
  direct_offer: <><path d="M3 12V4h8l10 10-7 7z" /><circle cx="7.5" cy="8" r="1.4" /></>,
  story: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M8.5 5.5h3M12.5 5.5h3" /><rect x="8.5" y="10" width="7" height="5" rx="1" /></>,
  read_caption: <><path d="M4 5h16M4 9h16M4 13h10" /><path d="M17 13v7M14.5 17.5 17 20l2.5-2.5" /></>,
  pov_testimonial: <><path d="M6 10.5a3 3 0 1 1 3 3v3c-3 0-5-2.5-5-6" /><path d="M14 10.5a3 3 0 1 1 3 3v3c-3 0-5-2.5-5-6" /></>,
  live: <><circle cx="12" cy="12" r="2.2" /><path d="M8 8a5.5 5.5 0 0 0 0 8M16 8a5.5 5.5 0 0 1 0 8M5 5a9.8 9.8 0 0 0 0 14M19 5a9.8 9.8 0 0 1 0 14" /></>,
  call: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5 21 7.5v9l-5-3" /></>,
  call_dialog: <><rect x="4" y="3" width="16" height="8" rx="2" /><rect x="4" y="13" width="16" height="8" rx="2" /><circle cx="12" cy="7" r="1.5" /><circle cx="12" cy="17" r="1.5" /></>,
  split_stack: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 12h16" /></>,
  split_torn: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 12l3-1.5 3 1.5 4-1.5 3 1.5 3-1.5" /></>,
  gossip_page: <><path d="M4 10v4h3l7 4V6L7 10z" /><path d="M17 9.5a3.5 3.5 0 0 1 0 5M19.5 7a7 7 0 0 1 0 10" /></>,
  gossip_white: <><path d="M4 5h16v11H10l-4 3.5V16H4z" /><path d="M12 8v4M12 14.2v.1" /></>,
  gossip_pink: <><path d="M4 5h16v11H10l-4 3.5V16H4z" /><path d="M12 13.2c-2.6-1.6-3.4-2.7-3.4-3.7a1.7 1.7 0 0 1 3.4-.4 1.7 1.7 0 0 1 3.4.4c0 1-.8 2.1-3.4 3.7z" /></>,
}
export function FrameIcon({ id, size = 14, className }: { id: FrameTemplateId; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {FRAME_GLYPH[id]}
    </svg>
  )
}

export const ITERATION_FIRST = (b: Pick<IterateBatch, "pieces">) => ({
  stretch: b.pieces.filter((p) => p.axis === "ITERATION"),
  newAudience: b.pieces.filter((p) => p.axis === "DIVERSITY"),
})
