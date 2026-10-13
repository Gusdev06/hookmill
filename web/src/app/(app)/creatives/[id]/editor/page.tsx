"use client"

import dynamic from "next/dynamic"
import { useParams } from "next/navigation"

// The Player and the manipulation layer only run in the browser (editor-v1 §8: client-only).
const EditorScreen = dynamic(() => import("@/components/editor/editor").then((m) => m.EditorScreen), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-30 bg-bg" role="status" aria-label="…" />,
})

/** /creatives/:id/editor: Editar no vídeo (docs/contratos/editor-v1.md §10 F2c). */
export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  return <EditorScreen id={id} />
}
