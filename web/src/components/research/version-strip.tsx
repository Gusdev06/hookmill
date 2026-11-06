"use client"

import { useTranslations } from "next-intl"
import type { ResearchAdDetail } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/*
 * mockup .vers: the versions of one ad. The Ad Library gives the count (`collationCount`) but not each version, so the
 * strip shows the cards of a dynamic/carousel ad (clickable, swap the player's poster); a plain ad only gets the line.
 */
export function VersionStrip({ ad, current, onPick }: { ad: ResearchAdDetail; current: number; onPick: (i: number) => void }) {
  const t = useTranslations("radar.detail")
  const n = ad.collationCount ?? 0
  if (n <= 1 && ad.cards.length <= 1) return null
  return (
    <div className="grid gap-1.5">
      <span className="eyebrow">{n > 1 ? t("versionsLine", { n }) : t("cards")}</span>
      {ad.cards.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {ad.cards.map((c, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={current === i}
              aria-label={`v${i + 1}${c.headline ? ` · ${c.headline}` : ""}`}
              onClick={() => onPick(i)}
              className="grid w-16 flex-none cursor-pointer gap-1 border-0 bg-transparent p-0 text-center font-mono text-[10px] text-fg-3"
            >
              <span className={cn("block aspect-[4/5] overflow-hidden rounded-[6px] bg-ink-3", current === i && "outline-2 outline-offset-1 outline-fg")}>
                {c.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element -- poster from our storage / Meta CDN
                  <img src={c.poster.url} alt="" className="size-full object-cover" />
                ) : null}
              </span>
              v{i + 1}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
