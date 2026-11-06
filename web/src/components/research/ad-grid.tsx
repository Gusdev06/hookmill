"use client"

import { useTranslations } from "next-intl"
import type { ResearchAdCard as Ad } from "@/lib/api/types"
import { BLANK_IMG } from "@/lib/skeleton-samples"
import { Reveal } from "@/components/ui/reveal"
import { Button } from "@/components/ui/button"
import { ResearchAdCard } from "./research-ad-card"
import { Spinner } from "./parts"

/* mockup .feed: auto-fill minmax(196px, 1fr); 2 columns on the phone. Loading = skullet measured from sample cards. */
export const GRID = "grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-3.5 max-tablet:grid-cols-2 max-tablet:gap-2.5"

const SAMPLE: Ad = {
  id: "sample-ad", adArchiveId: "0", adLibraryUrl: "", page: { id: null, name: "Sample brand", avatar: null }, competitors: [],
  format: "VIDEO", hasVideo: true,
  media: { playable: false, status: "remote", poster: { url: BLANK_IMG, mimeType: "image/gif" }, video: null, durationSec: 30, expiresAt: null },
  primaryText: "Sample ad text that runs across two lines in the card, like a real one.", headline: null, ctaText: null, linkUrl: null, linkHost: null,
  platforms: ["FACEBOOK", "INSTAGRAM"], language: "en", countryCode: "US", startDate: null, stoppedAt: null, isActive: true, daysRunning: 100,
  tier: "testing", killedFast: false, collationCount: 3, euReach: null, lowImpressions: false, saved: false, usedInBatches: 0, usable: true,
}
const noop = () => {}

export function AdGrid({
  ads, extraSkeletons = 0, readOnly, onOpen, onUse, onSave, hasMore, loadingMore, onMore,
}: {
  ads: Ad[] | null
  /** skeleton cards after the real ones (a competitor still being imported) */
  extraSkeletons?: number
  readOnly: boolean
  onOpen: (a: Ad) => void
  onUse: (a: Ad) => void
  onSave: (a: Ad) => void
  hasMore?: boolean
  loadingMore?: boolean
  onMore?: () => void
}) {
  const t = useTranslations("radar")
  const tl = useTranslations("skeleton")
  return (
    <div className="flex flex-col gap-4">
      <Reveal data={ads} sample={Array.from({ length: 10 }, (_, i) => ({ ...SAMPLE, id: `sample-${i}` }))} id="radar.grid" label={tl("ads")}>
        {(list) => (
          <div className={GRID}>
            {list.map((a) => (
              <ResearchAdCard key={a.id} ad={a} readOnly={readOnly} onOpen={() => onOpen(a)} onUse={() => onUse(a)} onSave={() => onSave(a)} />
            ))}
            {Array.from({ length: extraSkeletons }, (_, i) => (
              <div key={`more-${i}`} className="max-tablet:[&:nth-child(n+3)]:hidden" aria-hidden="true">
                <Reveal data={null} sample={SAMPLE} id="radar.card">
                  {(a) => <ResearchAdCard ad={a} readOnly onOpen={noop} onUse={noop} onSave={noop} />}
                </Reveal>
              </div>
            ))}
          </div>
        )}
      </Reveal>
      {hasMore ? (
        <Button variant="outline" className="self-center" onClick={onMore} disabled={loadingMore} aria-busy={loadingMore}>
          {loadingMore ? <Spinner /> : null}
          {t("loadMore")}
        </Button>
      ) : null}
    </div>
  )
}
