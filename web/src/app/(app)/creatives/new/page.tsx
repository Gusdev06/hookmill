"use client"

import { Suspense, useEffect } from "react"
import { setCrumb } from "@/lib/crumb"
import { OfferStep } from "@/components/wizard/offer-step"

export default function NewCreativePage() {
  useEffect(() => () => setCrumb(null), [])
  return (
    <Suspense>
      <OfferStep creative={null} />
    </Suspense>
  )
}
