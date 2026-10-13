"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { BatchScreen } from "@/components/iterate/batch-screen"

/** /iterate/:batchId — the automatic variation batch (variacao-auto-v1 §5, spec §4). */
export default function IterateBatchPage() {
  const { batchId } = useParams<{ batchId: string }>()
  return (
    <Suspense>
      <BatchScreen id={batchId} />
    </Suspense>
  )
}
