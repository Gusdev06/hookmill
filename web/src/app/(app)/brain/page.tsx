"use client"

import { Suspense } from "react"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { BrainScreen } from "@/components/brain/brain-screen"
import { BrandScreen } from "@/components/brand/brand-screen"
import { useSession } from "@/components/providers/session-provider"
import { useTour } from "@/components/tour/tour-provider"
import { cn } from "@/lib/utils"

/*
 * Brain = two tabs (design/brand-2026-10-31.md §2.1, approved 31/10): Brand (default, editable) and Map (the Brain 3D v1
 * globe, read-only; `/brain?view=map` links straight to it). The tour's Brain stop always shows the Map.
 * `3d-force-graph` + `three` stay in a lazy chunk (ssr: false), fetched only when the Map (or the Home stage) renders.
 */
const BrainGlobe = dynamic(() => import("@/components/brain/brain-globe"), { ssr: false })

export default function BrainPage() {
  return (
    <Suspense>
      <BrainTabs />
    </Suspense>
  )
}

function BrainTabs() {
  const t = useTranslations("brand")
  const router = useRouter()
  const pathname = usePathname()
  const tour = useTour()
  const { session } = useSession()
  const map = useSearchParams().get("view") === "map" || (tour.active && tour.stop === "brain")
  const name = session.workspace.name
  const go = (m: boolean) => router.replace(m ? `${pathname}?view=map` : pathname, { scroll: false })
  const tab = (m: boolean, label: string) => (
    <button
      type="button"
      role="tab"
      id={m ? "tab-map" : "tab-brand"}
      aria-selected={map === m}
      aria-controls="brain-view"
      onClick={() => go(m)}
      className={cn(
        "-mb-px min-h-11 cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-3 text-[13.5px] font-bold text-fg-3 hover:text-fg",
        map === m && "border-fg text-fg"
      )}
    >
      {label}
    </button>
  )
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-[var(--gut)] pt-5 pb-16 tablet:pt-7">
      <header className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("eyebrow", { name })}</span>
        <h1 className="text-2xl tablet:text-[30px]">{map ? t("mapTitle") : t("title")}</h1>
        <p className="m-0 max-w-[680px] text-[13px] text-fg-3 text-pretty tablet:text-sm">{map ? t("mapLede") : t("lede", { name })}</p>
      </header>
      <div role="tablist" aria-label={t("tabs.label")} className="flex gap-1 border-b border-line">
        {tab(false, t("tabs.brand"))}
        {tab(true, t("tabs.map"))}
      </div>
      <div id="brain-view" role="tabpanel" aria-labelledby={map ? "tab-map" : "tab-brand"}>
        {map ? <BrainScreen Globe={BrainGlobe} embedded /> : <BrandScreen />}
      </div>
    </div>
  )
}
