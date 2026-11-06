"use client"

import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import { toast } from "sonner"
import type { ResearchAdDetail } from "@/lib/api/types"
import { isApiError } from "@/lib/api/errors"
import { BLANK_IMG } from "@/lib/skeleton-samples"
import { cn } from "@/lib/utils"
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Reveal } from "@/components/ui/reveal"
import { NavIcon } from "@/components/shell/nav-icon"
import { useLanguageName } from "@/hooks/use-language-name"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useLoadMedia, useResearchAd, useSaveAd } from "@/hooks/use-research"
import { PageAvatar, RPill, Spinner, mmss, useCountryName, usePlatformsLine, useResearchErrorToast, useAgo } from "./parts"
import { WhyWinner } from "./why-winner"
import { VersionStrip } from "./version-strip"

/*
 * mockup .sheet (spec §4.3): Sheet from the right, 860 px, ink player (original format, controls, nothing on top) | 360 px panel.
 * Phone: full screen, player on top (520 px), data below, actions pinned to the foot (safe-area). `/radar?ad=<id>` (C.1).
 * Lime = Use as champion (the one lime while the detail is open).
 */
const SAMPLE: ResearchAdDetail = {
  id: "sample", adArchiveId: "000000000000", adLibraryUrl: "", page: { id: null, name: "Sample brand", avatar: null }, competitors: [{ id: "c", name: "Sample brand" }],
  format: "VIDEO", hasVideo: true, media: { playable: false, status: "remote", poster: { url: BLANK_IMG, mimeType: "image/gif" }, video: null, durationSec: 30, expiresAt: null },
  primaryText: "Sample ad text\nwith a second line", headline: "Sample headline", ctaText: "Shop now", linkUrl: null, linkHost: "example.com",
  platforms: ["FACEBOOK", "INSTAGRAM"], language: "en", countryCode: "US", startDate: "2026-01-01", stoppedAt: null, isActive: true, daysRunning: 100,
  tier: "testing", killedFast: false, collationCount: null, euReach: null, lowImpressions: false, saved: false, usedInBatches: 0, usable: true,
  cards: [], firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", savedNote: null, championId: null,
}

export function AdDetailSheet({
  adId, onClose, onUse, readOnly, winnerDays, winnerVersions,
}: { adId: string | null; onClose: () => void; onUse: (ad: ResearchAdDetail) => void; readOnly: boolean; winnerDays: number; winnerVersions: number }) {
  const t = useTranslations("radar.detail")
  const tl = useTranslations("skeleton")
  const errorMessage = useErrorMessage()
  const q = useResearchAd(adId)
  return (
    <DialogPrimitive.Root open={!!adId} onOpenChange={(o) => !o && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 right-0 z-50 w-[860px] max-w-full bg-card shadow-[-18px_0_50px_rgba(21,23,26,.22)] outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-6",
            "max-desktop:inset-0 max-desktop:w-full max-desktop:overflow-y-auto max-desktop:data-[state=open]:slide-in-from-right-0"
          )}
        >
          {q.isError ? (
            <div className="grid h-full content-center justify-items-center gap-3 p-8 text-center">
              <DialogPrimitive.Title className="m-0 text-base font-bold">{isApiError(q.error) && q.error.status === 404 ? t("notFound") : errorMessage(q.error)}</DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <Button size="sm">{t("close")}</Button>
              </DialogPrimitive.Close>
            </div>
          ) : (
            <Reveal data={q.data} sample={SAMPLE} id="radar.detail" label={tl("ads")}>
              {(ad) => <DetailBody ad={ad} onUse={onUse} readOnly={readOnly} winnerDays={winnerDays} winnerVersions={winnerVersions} />}
            </Reveal>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}

function DetailBody({ ad, onUse, readOnly, winnerDays, winnerVersions }: { ad: ResearchAdDetail; onUse: (ad: ResearchAdDetail) => void; readOnly: boolean; winnerDays: number; winnerVersions: number }) {
  const t = useTranslations("radar.detail")
  const tc = useTranslations("radar.card")
  const tr = useTranslations("radar.toast")
  const tf = useTranslations("radar.format")
  const format = useFormatter()
  const plats = usePlatformsLine()
  const country = useCountryName()
  const lang = useLanguageName()
  const rel = useAgo()
  const errToast = useResearchErrorToast()
  const save = useSaveAd()
  const load = useLoadMedia()
  const [ver, setVer] = useState(0)
  const name = ad.competitors[0]?.name ?? ad.page.name
  const date = (d: string | null) => (d ? format.dateTime(new Date(`${d}T12:00:00`), { month: "short", day: "numeric", year: "numeric" }) : "—")
  const card = ad.cards[ver]
  const poster = card?.poster?.url ?? ad.media.poster?.url ?? null
  const showVideo = ad.media.playable && !!ad.media.video && (!card || card.mediaKind !== "IMAGE")
  const refreshing = ad.media.status === "refreshing"
  const needsLoad = ad.hasVideo && (ad.media.status === "expired" || (ad.media.status === "none" && ad.hasVideo))
  const copy = async () => {
    await navigator.clipboard?.writeText([ad.primaryText, ad.headline].filter(Boolean).join("\n\n")).catch(() => {})
    toast(t("copied"))
  }
  const toggleSave = () =>
    save.mutate({ ad, saved: !ad.saved }, { onSuccess: () => toast(!ad.saved ? tr("saved") : tr("unsaved")), onError: errToast })
  // the grid lives inside the Reveal: skullet wraps its content, so the columns can't be set from outside
  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)] max-desktop:h-auto max-desktop:grid-cols-1 max-desktop:grid-rows-none">
      {/* player */}
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2.5 bg-ink p-3.5 max-desktop:h-[520px] max-desktop:pt-[max(14px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-2 text-xs text-ink-fg-2">
          <span className="flex min-w-0 items-center gap-2">
            <PageAvatar name={name} url={ad.page.avatar?.url} size="sm" />
            <span className="truncate">{name}</span>
          </span>
          <DialogPrimitive.Close asChild>
            <button type="button" className="min-h-9 cursor-pointer rounded-md border border-ink-line bg-transparent px-3 text-ink-fg">
              {t("close")}
            </button>
          </DialogPrimitive.Close>
        </div>
        <div className="relative grid min-h-0 place-items-center">
          {showVideo ? (
            <video key={ad.media.video!.url} src={ad.media.video!.url} poster={poster ?? undefined} controls playsInline preload="metadata" aria-label={t("player")} className="absolute inset-0 m-auto max-h-full max-w-full rounded-[10px] bg-black" />
          ) : poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- poster from our storage / Meta CDN
            <img src={poster} alt="" className={cn("absolute inset-0 m-auto max-h-full max-w-full rounded-[10px] object-contain", needsLoad && "opacity-50")} />
          ) : (
            <span className="font-mono text-xs text-ink-fg-3">{tc("unavailable")}</span>
          )}
          {needsLoad || refreshing ? (
            <div className="absolute inset-x-3 bottom-3 grid justify-items-center gap-2 rounded-md bg-ink/85 p-3 text-center text-[13px] text-ink-fg-2" role="status">
              <span>{refreshing ? t("loadingVideo") : t("expired")}</span>
              {refreshing ? (
                <Spinner className="border-ink-fg" />
              ) : !readOnly ? (
                <button
                  type="button"
                  disabled={load.isPending}
                  onClick={() => load.mutate(ad.id, { onError: errToast })}
                  className="min-h-9 cursor-pointer rounded-md border border-ink-line bg-ink-fg px-3 font-semibold text-ink disabled:opacity-50"
                >
                  {t("loadVideo")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="font-mono text-[11px] text-ink-fg-2 tabular-nums">
          {ad.hasVideo ? mmss(ad.media.durationSec) : `${t("image")}${ad.media.poster?.width && ad.media.poster.height ? ` · ${ad.media.poster.width} × ${ad.media.poster.height}` : ""}`}
        </div>
      </div>

      {/* panel */}
      <div className="flex min-h-0 flex-col">
        <div className="grid flex-1 content-start gap-3.5 overflow-y-auto p-[18px] max-desktop:overflow-visible">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              {ad.isActive ? <RPill tone="ok">{t("active")}</RPill> : <RPill>{tc("inactive")}</RPill>}
              {ad.tier === "winner" ? <RPill tone="lime">{tc("winner")}</RPill> : null}
              <RPill>
                {`${tf(ad.format)}${ad.hasVideo && ad.media.durationSec ? ` ${mmss(ad.media.durationSec)}` : ""}`}
              </RPill>
              {ad.usedInBatches > 0 ? <RPill tone="info">{t("usedIn", { n: ad.usedInBatches })}</RPill> : null}
            </div>
            <DialogPrimitive.Title className="m-0 text-base font-bold text-balance">{card?.headline ?? ad.headline ?? name}</DialogPrimitive.Title>
          </div>
          <WhyWinner ad={ad} winnerDays={winnerDays} winnerVersions={winnerVersions} />
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-[13px] [&_dd]:m-0 [&_dd]:text-right [&_dd]:font-semibold [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-fg-3">
            <dt>{t("started")}</dt>
            <dd className="tabular-nums">{date(ad.startDate)}</dd>
            <dt>{ad.isActive ? t("running") : t("ran")}</dt>
            <dd className="tabular-nums">{ad.isActive ? t("runningDays", { n: ad.daysRunning ?? 0 }) : `${date(ad.startDate)} – ${date(ad.stoppedAt)}`}</dd>
            <dt>{t("platforms")}</dt>
            <dd>{plats(ad.platforms, true) || "—"}</dd>
            <dt>{t("country")}</dt>
            <dd>{country(ad.countryCode) || "—"}</dd>
            <dt>{t("language")}</dt>
            <dd>{ad.language ? lang(ad.language) : "—"}</dd>
            {ad.ctaText ? (
              <>
                <dt>{t("button")}</dt>
                <dd>{ad.ctaText}</dd>
              </>
            ) : null}
            {ad.linkHost ? (
              <>
                <dt>{t("goesTo")}</dt>
                <dd>{ad.linkHost}</dd>
              </>
            ) : null}
          </dl>
          <VersionStrip ad={ad} current={ver} onPick={setVer} />
          {ad.primaryText ? (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{t("adText")}</span>
                <Button variant="ghost" size="sm" onClick={copy}>
                  {t("copy")}
                </Button>
              </div>
              <p className="m-0 rounded-md border border-line bg-card-2 px-3 py-2.5 text-[13px] whitespace-pre-line text-fg-2">{ad.primaryText}</p>
            </div>
          ) : null}
          <a href={ad.adLibraryUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-info underline underline-offset-2">
            {t("openLib")}
          </a>
          <span className="text-xs text-fg-3 tabular-nums">{t("libId", { id: ad.adArchiveId, ago: rel(ad.lastSeenAt) })}</span>
        </div>
        <div className="sticky bottom-0 grid gap-2 border-t border-line bg-card px-[18px] pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          {readOnly ? null : (
            <Button variant="brand" disabled={!ad.usable || !ad.hasVideo} title={!ad.hasVideo ? tc("noVideo") : undefined} onClick={() => onUse(ad)}>
              {tc("use")}
            </Button>
          )}
          <Button variant="outline" aria-pressed={ad.saved} disabled={readOnly || save.isPending} onClick={toggleSave}>
            <NavIcon name="bookmark" size={15} className={ad.saved ? "[&_path]:fill-current" : undefined} />
            {ad.saved ? tc("saved") : tc("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
