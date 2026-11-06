"use client"

import { Suspense } from "react"
import { TemplatesGallery } from "@/components/templates/gallery"

/** /templates: the template gallery (templates-creditos-v1, mockup-templates approved 31/10). `?metaAdId=` pins one ad. */
export default function TemplatesPage() {
  return (
    <Suspense>
      <TemplatesGallery />
    </Suspense>
  )
}
