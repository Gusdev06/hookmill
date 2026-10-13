"use client"

import { useEffect } from "react"
import { useFormatter, useTranslations } from "next-intl"
import type { AutoVariationType, FileRef, IterateBatch, VariationAxis } from "@/lib/api/types"
import { FlowBar } from "@/components/flow-bar"
import { NavIcon } from "@/components/shell/nav-icon"
import { useSession } from "@/components/providers/session-provider"
import { iterateHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import "./iterate.css"

/* Building blocks of the automatic variation screens (design/variacao-auto-v1-2026-10-12.md §7, skin fase2 §3-4). */

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
function Art({ type, tone }: { type: AutoVariationType | "orig"; tone: string }) {
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
}: { type: AutoVariationType | "orig"; poster?: FileRef | null; tone?: number; play?: boolean; label?: string; className?: string }) {
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
  return (type: AutoVariationType) => t(type)
}

export const ITERATION_FIRST = (b: Pick<IterateBatch, "pieces">) => ({
  stretch: b.pieces.filter((p) => p.axis === "ITERATION"),
  newAudience: b.pieces.filter((p) => p.axis === "DIVERSITY"),
})
