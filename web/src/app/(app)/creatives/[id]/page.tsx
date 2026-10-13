"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useCreative } from "@/hooks/use-creative"
import { stepHref, WizardFrame } from "@/components/wizard/shell"

/** /creatives/:id opens the wizard on the creative's current step. */
export default function CreativeIndex() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const q = useCreative(id)
  useEffect(() => {
    const c = q.data
    if (c) router.replace(c.step === "library" ? `/library?new=${encodeURIComponent(c.id)}` : stepHref(c.id, c.step))
    if (q.isError) router.replace("/")
  }, [q.data, q.isError, router])
  return (
    <WizardFrame creative={null} viewing="offer">
      <span className="sk h-64 rounded-lg" />
    </WizardFrame>
  )
}
