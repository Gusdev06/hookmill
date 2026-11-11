"use client"

import { Fragment } from "react"
import { useTranslations } from "next-intl"
import type { AiFormat, AiPreview, IterateBatch } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { NavIcon } from "@/components/shell/nav-icon"
import { mmss } from "@/components/iterate/parts"
import { AdStill, Pill } from "./parts"

/* Building blocks of Templates › With AI with previews (design/mockup-with-ai-previas.html, approved 07/11). */

/** The 4-step trail after the gallery (design §2): Format · Winner · Previews · Videos. ≤760 px only the current one keeps its name. */
export function AiSteps({ current, hrefs = {} }: { current: 0 | 1 | 2 | 3; hrefs?: Partial<Record<0 | 1 | 2 | 3, string>> }) {
  const t = useTranslations("adTemplates.ai.steps")
  const steps = [t("format"), t("winner"), t("previews"), t("videos")]
  return (
    <nav aria-label={t("aria")} className="flex flex-wrap items-center gap-1.5 text-xs">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "cur" : "todo"
        const href = state === "done" ? hrefs[i as 0 | 1 | 2 | 3] : undefined
        const Tag = href ? "a" : "span"
        return (
          <Fragment key={s}>
            {i ? <i aria-hidden="true" className="h-px w-2.5 bg-line-strong" /> : null}
            <Tag
              {...(href ? { href } : {})}
              aria-current={state === "cur" ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-line py-1 pr-2 pl-1 text-fg-3 tablet:pr-2.5",
                state === "done" && "bg-card text-fg-2",
                state === "cur" && "border-fg font-semibold text-fg",
                href && "hover:border-line-strong"
              )}
            >
              <i
                aria-hidden="true"
                className={cn(
                  "grid size-[18px] place-items-center rounded-full bg-card-2 font-mono text-[10px] not-italic",
                  state === "done" && "bg-fg text-card",
                  state === "cur" && "bg-brand text-fg"
                )}
              >
                {state === "done" ? <NavIcon name="check" size={10} strokeWidth={3} /> : i + 1}
              </i>
              <em className={cn("not-italic", state !== "cur" && "max-tablet:hidden")}>{s}</em>
            </Tag>
          </Fragment>
        )
      })}
    </nav>
  )
}

/** "price TBD": a dashed mono pill while the video has no price (`prices.videoEach = null`). */
export function Tbd({ ink, className }: { ink?: boolean; className?: string }) {
  const t = useTranslations("adTemplates.ai")
  return (
    <span className={cn("inline-block rounded-[5px] border border-dashed px-1.5 py-px font-mono text-[10.5px] whitespace-nowrap", ink ? "border-ink-fg-3 text-ink-fg-2" : "border-line-strong text-fg-3", className)}>
      {t("priceTbd")}
    </span>
  )
}

/** The card pill of a With AI template: "AI · —" while the video has no price, "AI · N credits" after. */
export function AiPricePill({ credits }: { credits: number | null }) {
  const t = useTranslations("adTemplates.ai")
  const tc = useTranslations("adTemplates")
  return <Pill tone="ai">{t("pill", { price: credits == null ? "—" : tc("credits", { n: credits }) })}</Pill>
}

/** The winner strip, sticky from Previews to the videos (design §2.4): still + name + kind/duration + "becomes → format". */
export function ChampionStrip({ batch, format }: { batch: IterateBatch; format: string }) {
  const t = useTranslations("adTemplates.ai.champ")
  const s = batch.source
  const line = [s.ratioLabel, s.durationSec ? mmss(s.durationSec) : null, batch.offer.name].filter(Boolean).join(" · ")
  return (
    <section
      aria-label={t("aria")}
      className="sticky top-14 z-[12] flex min-w-0 items-center gap-2.5 rounded-lg border border-line bg-card py-1.5 pr-2.5 pl-1.5 shadow-[0_6px_14px_-12px_rgba(22,24,27,.4)] tablet:top-0 tablet:gap-3 tablet:py-2 tablet:pr-3 tablet:pl-2"
    >
      <AdStill file={s.thumbnail} className="w-[30px] flex-none tablet:w-10" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="eyebrow flex-none max-tablet:text-[10px]">{t("from")}</span>
          <b className="truncate text-sm">{s.name}</b>
        </div>
        {line ? <span className="truncate text-xs text-fg-3 max-tablet:hidden">{line}</span> : null}
      </div>
      <span className="flex flex-none items-center gap-1.5 font-mono text-[11px] whitespace-nowrap text-fg-3">
        <span className="max-tablet:hidden">{t("becomes")}</span> → <b className="font-sans text-[13px] text-fg">{format}</b>
      </span>
    </section>
  )
}

/** The magnifier on a preview (no NavIcon for it). */
export function ZoomIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  )
}

/**
 * The key frame of a preview (contract §4.1/§6): F04/F09 one 9:16 image; F10 two halves side by side, HOST | GUEST, one per
 * speaker. An image not there yet = the Image Generation wait (`gen`) or a hatched block (failed).
 */
export function PreviewImage({
  preview, format, gen, failed, badge, compact, className,
}: { preview: AiPreview | null; format: AiFormat; gen?: boolean; failed?: boolean; badge?: boolean; /** thumbnails: no labels */ compact?: boolean; className?: string }) {
  const t = useTranslations("adTemplates.ai.previews")
  const duo = format === "F10"
  const cast = preview?.cast ?? []
  const slots = duo ? [cast.find((c) => c.speaker === "host") ?? null, cast.find((c) => c.speaker === "presenter") ?? null] : [cast[0] ?? null]
  return (
    <div className={cn("relative isolate grid aspect-[9/16] w-full overflow-hidden rounded-[10px] bg-ink", duo && "grid-cols-2", className)}>
      {slots.map((c, i) => {
        const url = !gen && !failed ? c?.image?.url : null
        return (
          <div key={i} className={cn("relative min-w-0 overflow-hidden", duo && i === 1 && "border-l border-ink")}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
              <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
            ) : failed ? (
              <span className="example-stripes absolute inset-0" />
            ) : (
              <span className="imggen absolute inset-0" />
            )}
            {duo && !compact ? (
              <span className={cn("absolute top-[26px] z-[5] rounded-[3px] bg-ink/75 px-1 py-px font-mono text-[8.5px] tracking-[0.06em] text-ink-fg uppercase", i ? "right-[7px]" : "left-[7px]")}>
                {i ? t("guest") : t("host")}
              </span>
            ) : null}
          </div>
        )
      })}
      {badge ? (
        <span className="pointer-events-none absolute top-[7px] left-[7px] z-[5] rounded-[4px] bg-ink/80 px-[5px] py-0.5 font-mono text-[9px] tracking-[0.06em] text-ink-fg uppercase max-tablet:hidden">{t("badge")}</span>
      ) : null}
      {compact ? null : <span className="pointer-events-none absolute top-[7px] right-[7px] z-[5] rounded-[4px] bg-white/90 px-[5px] py-0.5 font-mono text-[9px] text-fg max-tablet:hidden">9:16</span>}
    </div>
  )
}
