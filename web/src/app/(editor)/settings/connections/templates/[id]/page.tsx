"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { TemplateEditorPage } from "@/components/meta/templates/template-editor"

/** /settings/connections/templates/:id — the template editor from Settings › Templates (`new` = fresh, `?import=1`). */
export default function SettingsTemplatePage() {
  const { id } = useParams<{ id: string }>()
  return (
    <Suspense>
      <TemplateEditorPage templateId={id} origin="settings" />
    </Suspense>
  )
}
