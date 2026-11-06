"use client"

import { useMemo } from "react"
import { useParams } from "next/navigation"
import { TemplateAdStep } from "@/components/templates/ad-step"

/** /templates/:slug: which ad does the template run on (Meta winners · Upload · Library, with the fit of each). */
export default function TemplateAdPage() {
  const { slug } = useParams<{ slug: string }>()
  const slugs = useMemo(() => [slug], [slug])
  return <TemplateAdStep slugs={slugs} />
}
