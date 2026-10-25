"use client"

import dynamic from "next/dynamic"
import { BrainScreen } from "@/components/brain/brain-screen"

/*
 * Brain 3D v1 (docs/contratos/brain-3d-v1.md §3): the only place that loads the 3D engine. `3d-force-graph` + `three`
 * come in a lazy chunk (ssr: false), so no other route's First Load JS changes. `#t-brain` (tour stop 1) is the stage.
 */
const BrainGlobe = dynamic(() => import("@/components/brain/brain-globe"), { ssr: false })

export default function BrainPage() {
  return <BrainScreen Globe={BrainGlobe} />
}
