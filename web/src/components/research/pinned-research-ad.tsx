"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { RADAR_HREF, radarHref } from "@/lib/routes"
import { buttonVariants } from "@/components/ui/button"
import { useResearchAd } from "@/hooks/use-research"

/*
 * mockup .pinned (spec §4.4): Templates opened with `?researchAdId=` (Use as champion). Thumbnail + "Champion · Page · “headline”",
 * whether the ad was read already (the reading itself happens on the first use, about 1 min, free) and "Change ad" back to
 * the Ad Radar. Below, the fixed note: from a competitor ad we keep only the structure.
 */
export function PinnedResearchAd({ id, read }: { id: string; read: boolean | null }) {
  const t = useTranslations("radar.champion")
  const q = useResearchAd(id)
  const ad = q.data
  const name = ad?.competitors[0]?.name ?? ad?.page.name ?? ""
  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-brand-edge bg-brand-soft px-3 py-2.5 text-[13px]">
        <Link href={radarHref(id)} className="block aspect-[9/16] w-10 flex-none overflow-hidden rounded-[5px] bg-ink-3" aria-label={name || undefined}>
          {ad?.media.poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- poster from our storage / Meta CDN
            <img src={ad.media.poster.url} alt="" className="size-full object-cover" />
          ) : null}
        </Link>
        <div className="grid min-w-0 flex-[1_1_220px] gap-1">
          {ad ? <b className="[overflow-wrap:anywhere]">{t("pinned", { name, headline: ad.headline ?? (ad.primaryText ?? "").split("\n")[0].slice(0, 60) })}</b> : <span className="sk h-4 w-60 rounded" />}
          <span className="text-xs text-fg-2">{read ? t("read") : t("reading")}</span>
        </div>
        <Link href={RADAR_HREF} className={buttonVariants({ size: "sm", variant: "outline" })}>
          {t("change")}
        </Link>
      </div>
      <p className="m-0 border-l-2 border-line-strong pl-2.5 text-[12.5px] text-fg-2">{t("note")}</p>
    </div>
  )
}
