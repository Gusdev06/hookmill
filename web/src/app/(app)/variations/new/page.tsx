"use client"

import { Suspense } from "react"
import { WinnerStep } from "@/components/variar/winner-step"
import { VariarFrameSkeleton } from "@/components/variar/frame"

/** /variations/new: Vary a winner, step 1 with no champion yet (spec §5.1). */
export default function NewVariationPage() {
  return (
    <Suspense fallback={<VariarFrameSkeleton viewing="winner" />}>
      <WinnerStep champion={null} />
    </Suspense>
  )
}
