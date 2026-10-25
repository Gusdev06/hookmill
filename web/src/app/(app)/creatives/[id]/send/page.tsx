"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { PublishScreen } from "@/components/meta/publish/publish-screen"

/** /creatives/:id/send — Send → "Publish to Meta" of an approved creative (meta-v1 §3.3, sequence §3.3.1). */
export default function SendPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <Suspense>
      <PublishScreen id={id} />
    </Suspense>
  )
}
