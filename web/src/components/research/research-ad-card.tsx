"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import type { ResearchAdCard as Ad } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { PageAvatar, RPill, mmss, usePlatformsLine, useCountryName } from "./parts"

/*
 * mockup .ad: 4:5 media (Likely winner / Inactive top-left, VIDEO 0:41 top-right), Page + "214 d", 2 lines of text, pills,
 * and the actions pinned to the card's foot (Gusta 04/11: aligned across a row, whatever the text above).
 * Desktop: the video plays muted on hover, one at a time (leaving the card stops it); touch never plays in the card.
 * Clicking the media opens the detail.
 */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return reduced
}

export function AdMedia({ ad, playing, className, badges = true }: { ad: Ad; playing?: boolean; className?: string; badges?: boolean }) {
  const t = useTranslations("radar.card")
  const tf = useTranslations("radar.format")
  const vid = useRef<HTMLVideoElement>(null)
  const [pct, setPct] = useState(0)
  const poster = ad.media.poster?.url ?? null
  const canPlay = !!playing && ad.media.playable && !!ad.media.video
  return (
    <span className={cn("relative block aspect-[4/5] w-full overflow-hidden rounded-[10px] bg-ink-3", className)}>
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element -- poster from our storage / Meta CDN
        <img src={poster} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 grid place-items-center px-3 text-center font-mono text-[11px] text-ink-fg-3">{t("unavailable")}</span>
      )}
      {canPlay ? (
        <video
          ref={vid}
          src={ad.media.video!.url}
          poster={poster ?? undefined}
          muted
          playsInline
          autoPlay
          loop
          preload="none"
          onTimeUpdate={(e) => setPct(e.currentTarget.duration ? (e.currentTarget.currentTime / e.currentTarget.duration) * 100 : 0)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {badges ? (
        <>
          <span className="absolute top-1.5 right-1.5 rounded-[4px] bg-ink/75 px-[5px] py-px font-mono text-[9.5px] text-ink-fg">
            <span className={cn(ad.hasVideo && ad.media.durationSec ? "max-tablet:hidden" : undefined)}>{tf(ad.hasVideo ? "VIDEO" : ad.format).toUpperCase()}</span>
            {ad.hasVideo && ad.media.durationSec ? ` ${mmss(ad.media.durationSec)}` : ""}
          </span>
          {ad.tier === "winner" ? (
            <span className="absolute top-1.5 left-1.5 rounded-[4px] border border-brand-edge bg-brand px-1.5 py-px font-mono text-[9.5px] font-semibold text-[#15171a]">{t("winner")}</span>
          ) : !ad.isActive ? (
            <span className="absolute top-1.5 left-1.5 rounded-[4px] bg-ink/75 px-1.5 py-px font-mono text-[9.5px] text-ink-fg-2">{t("inactive")}</span>
          ) : null}
        </>
      ) : null}
      {ad.hasVideo && badges ? (
        <>
          <span
            className={cn(
              "absolute top-1/2 left-1/2 grid size-10 -translate-1/2 place-items-center rounded-full bg-ink/60 text-ink-fg opacity-0 transition-opacity group-hover/ad:opacity-100",
              canPlay && "group-hover/ad:opacity-0"
            )}
            aria-hidden="true"
          >
            <NavIcon name="play" size={16} />
          </span>
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-ink/35" aria-hidden="true">
            <i className="block h-full bg-white" style={{ width: canPlay ? `${pct}%` : 0 }} />
          </span>
        </>
      ) : null}
    </span>
  )
}

export function ResearchAdCard({
  ad, onOpen, onUse, onSave, readOnly, savePending,
}: { ad: Ad; onOpen: () => void; onUse: () => void; onSave: () => void; readOnly: boolean; savePending?: boolean }) {
  const t = useTranslations("radar.card")
  const plats = usePlatformsLine()
  const country = useCountryName()
  const reduced = useReducedMotion()
  const [playing, setPlaying] = useState(false)
  const name = ad.competitors[0]?.name ?? ad.page.name
  const canUse = !readOnly && ad.usable && ad.hasVideo
  return (
    <article
      className="group/ad flex min-w-0 flex-col gap-2 rounded-[16px] border border-line bg-card p-[7px] hover:border-line-strong"
      onPointerEnter={(e) => e.pointerType === "mouse" && !reduced && setPlaying(true)}
      onPointerLeave={() => setPlaying(false)}
    >
      <button type="button" onClick={onOpen} aria-label={t("open", { name })} className="block w-full cursor-pointer rounded-[10px] border-0 bg-transparent p-0">
        <AdMedia ad={ad} playing={playing} />
      </button>
      {/* info grows; the actions below sit on the card's foot */}
      <div className="grid min-w-0 flex-1 content-start gap-[5px] px-[3px] pb-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-bold">
          <PageAvatar name={name} url={ad.page.avatar?.url} size="sm" />
          <span className="min-w-0 truncate">{name}</span>
          <span className="ml-auto font-mono text-[11px] font-normal whitespace-nowrap text-fg-2 tabular-nums">
            {ad.isActive && ad.daysRunning != null ? t("days", { n: ad.daysRunning }) : t("ended")}
          </span>
        </div>
        <p className="m-0 line-clamp-2 min-h-[2.9em] text-xs leading-[1.45] text-fg-2">{(ad.primaryText ?? ad.headline ?? "").split("\n")[0]}</p>
        <div className="flex flex-wrap gap-1">
          {ad.platforms.length ? <RPill>{plats(ad.platforms)}</RPill> : null}
          {ad.countryCode ? <RPill className="max-tablet:hidden">{ad.countryCode}</RPill> : null}
          {(ad.collationCount ?? 0) > 1 ? <RPill className="tabular-nums">{t("versions", { n: ad.collationCount! })}</RPill> : null}
          <span className="sr-only">{country(ad.countryCode)}</span>
        </div>
      </div>
      <div className="mt-auto grid grid-cols-[minmax(0,1fr)_34px] gap-1.5 px-[3px] pb-[3px]">
        <Button
          variant="default"
          size="sm"
          className="h-[34px] px-2 tablet:h-[34px]"
          disabled={!canUse}
          title={readOnly ? t("readOnly") : !ad.hasVideo ? t("noVideo") : undefined}
          onClick={onUse}
        >
          <span className="max-tablet:hidden">{t("use")}</span>
          <span className="tablet:hidden">{t("useShort")}</span>
        </Button>
        <button
          type="button"
          aria-pressed={ad.saved}
          aria-label={ad.saved ? t("saved") : t("save")}
          disabled={readOnly || savePending}
          onClick={onSave}
          className="grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-md border border-line-strong bg-card p-0 text-fg-2 disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-card [&[aria-pressed=true]_path]:fill-current"
        >
          <NavIcon name="bookmark" size={15} strokeWidth={1.8} />
        </button>
      </div>
    </article>
  )
}
