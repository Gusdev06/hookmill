"use client"

import { Suspense } from "react"
import { TemplatesScreen } from "@/components/meta/templates/templates-screen"

/** Settings › Meta › Publish templates (meta-templates-v1). */
export default function TemplatesPage() {
  return (
    <Suspense>
      <TemplatesScreen />
    </Suspense>
  )
}
