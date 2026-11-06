"use client"

import { Suspense } from "react"
import { TemplateSelectionStep } from "@/components/templates/ad-step"

/**
 * /templates/selection?t=a,b,c (templates-multi-v1 §5.2): the Ad step of 2+ checked templates. The static folder wins over
 * `[slug]` (no public template is called "selection"). 1 valid slug left = /templates/:slug; none = /templates.
 */
export default function TemplateSelectionPage() {
  return (
    <Suspense>
      <TemplateSelectionStep />
    </Suspense>
  )
}
