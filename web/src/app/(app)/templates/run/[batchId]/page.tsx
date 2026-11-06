"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { TemplateRunScreen } from "@/components/templates/run-screen"

/** /templates/run/:batchId: Reading → Plan + cost → Generate → Download of a batch born from a template. */
export default function TemplateRunPage() {
  const { batchId } = useParams<{ batchId: string }>()
  return (
    <Suspense>
      <TemplateRunScreen id={batchId} />
    </Suspense>
  )
}
