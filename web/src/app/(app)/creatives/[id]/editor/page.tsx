"use client"

import dynamic from "next/dynamic"
import { useParams, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import { qk } from "@/hooks/use-creative"
import { iterateHref } from "@/lib/routes"
import { useErrorMessage } from "@/hooks/use-error-message"

// The Player and the manipulation layer only run in the browser (editor-v1 §8: client-only).
const EditorScreen = dynamic(() => import("@/components/editor/editor").then((m) => m.EditorScreen), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-30 bg-bg" role="status" aria-label="…" />,
})
// editor-universal-v1 (F-U1): the AUTO piece (frame / headline) opens the universal editor.
const UniversalEditor = dynamic(() => import("@/components/editor/universal/universal-editor").then((m) => m.UniversalEditor), { ssr: false })
const UniversalSkeleton = dynamic(() => import("@/components/editor/universal/universal-editor").then((m) => m.UniversalSkeleton), { ssr: false })
const UniversalGate = dynamic(() => import("@/components/editor/universal/universal-editor").then((m) => m.UniversalGate), { ssr: false })

/**
 * /creatives/:id/editor: one route (editor-universal-v1 §2). The GET says which editor: `version: 3` + `base: 'auto-piece'`
 * → universal editor; the creative from scratch (EditorState v1) keeps the editor of editor-v1 unchanged until F-U2.
 * Same query key as the v1 session, so the scratch editor reuses this answer (no second GET).
 */
export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const sp = useSearchParams()
  const from = sp.get("from")
  const batchId = sp.get("b")
  const t = useTranslations("editorU.gate")
  const errorMessage = useErrorMessage()
  const q = useQuery({ queryKey: qk.editor(id), queryFn: () => api.editor.open(id), retry: false, refetchOnWindowFocus: false, staleTime: 60_000 })
  const reason = isApiError(q.error) ? String((q.error.details as { reason?: string } | undefined)?.reason ?? "") : ""
  // By direct URL (no `from`): the API's reason still says it's an AUTO piece, so it gets the same gate (the scratch editor has none for it).
  const autoRefused = !!reason && reason !== "remix_editor_not_enabled" && t.has(`reason.${reason}` as never)
  const back = from === "library" || (!from && !batchId) ? "/library" : batchId ? iterateHref(batchId, "download") : "/"

  if (q.data && "version" in q.data && q.data.version === 3 && q.data.base === "auto-piece") return <UniversalEditor id={id} />
  if (q.isPending) return from ? <UniversalSkeleton /> : <div className="fixed inset-0 z-30 bg-bg" role="status" aria-label="…" />
  // opened from a batch / the Library: the piece is AUTO; its errors get the universal gate (the scratch editor's gate talks about scenes)
  if (q.isError && (from || autoRefused)) {
    const e = q.error
    const title = reason === "headline_plate_retired" ? t("retiredTitle")
      : isApiError(e) && e.code === "EDIT_NOT_SUPPORTED" ? t("notEditableTitle")
      : isApiError(e) && e.code === "PAYMENT_REQUIRED" ? t("lockedTitle")
        : isApiError(e) && e.code === "INVALID_STATE" ? t("notReadyTitle") : t("errorTitle")
    const body = reason && t.has(`reason.${reason}` as never) ? t(`reason.${reason}` as never) : errorMessage(e)
    return <UniversalGate title={title} body={body} back={back} retry={isApiError(e) && (e.kind !== "http" || e.status >= 500) ? () => void q.refetch() : undefined} />
  }
  return <EditorScreen id={id} />
}
