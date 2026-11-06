"use client"

import { Suspense } from "react"
import { RadarScreen } from "@/components/research/radar-screen"

/** /radar: Ad Radar (ads-research-v1, mockup-ads-research.html approved 04/11). `?ad=<id>` opens the detail Sheet. */
export default function RadarPage() {
  return (
    <Suspense>
      <RadarScreen />
    </Suspense>
  )
}
