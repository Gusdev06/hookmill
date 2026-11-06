"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { TemplateEditorPage } from "@/components/meta/templates/template-editor"

/** /publish/template/:id?return=<send url> — the template editor opened from "Publish to Meta" (`new` = fresh). */
export default function PublishTemplatePage() {
  const { id } = useParams<{ id: string }>()
  return (
    <Suspense>
      <TemplateEditorPage templateId={id} origin="send" />
    </Suspense>
  )
}
