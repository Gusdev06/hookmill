"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import type { PieceEditorView, PieceFile } from "@/lib/api/types"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** /creatives/:id/editor (one route, editor-universal-v1 §2). `from` = where Back goes before the GET answers. */
export const universalEditorHref = (creativeId: string, from?: "batch" | "library", batchId?: string | null) =>
  `/creatives/${encodeURIComponent(creativeId)}/editor${from ? `?from=${from}${batchId ? `&b=${encodeURIComponent(batchId)}` : ""}` : ""}`

/**
 * Card foot "Download | Edit" (spec §8 + rule of 04/11: two equal columns, always at the bottom of the card, aligned
 * between cards). Download is off while there's an edit saved and not exported (§7.3); Edit only when the API says the
 * piece opens in the editor (`IteratePiece.editor.available`).
 */
export function DownloadEditFooter({ file, creativeId, editor, from = "batch", batchId, className, onDownload, downloading }: { file: Pick<PieceFile, "url" | "name"> | null; creativeId: string | null; editor: PieceEditorView | null | undefined; from?: "batch" | "library"; batchId?: string | null; className?: string; /** `file.url` can't download by itself (no attachment): the click asks for a signed one. */ onDownload?: () => void; downloading?: boolean }) {
  const t = useTranslations("editorU.card")
  const pending = !!editor?.pendingExport
  const canEdit = !!creativeId && !!editor?.available
  const exporting = !!editor?.export && editor.export.stage !== "failed" && editor.export.stage !== "done"
  // A title doesn't exist on touch: the reason is a visible line. It sits above the buttons, so they stay aligned at the card's foot.
  const reason = canEdit ? null : editor?.reason ? t(`reason.${editor.reason}` as never) : editor ? null : t("reason.auto_type_not_editable")
  return (
    <div className={cn("grid gap-1.5", className)}>
    {reason ? <p className="m-0 text-xs text-fg-3 [overflow-wrap:anywhere]">{reason}</p> : null}
    <div className="grid grid-cols-2 gap-2">
      {file && !pending && !exporting ? (
        <a
          href={file.url}
          download={file.name}
          aria-busy={downloading || undefined}
          onClick={onDownload ? (e) => { e.preventDefault(); if (!downloading) onDownload() } : undefined}
          className={buttonVariants({ size: "sm", className: "w-full min-w-0 px-1 text-xs" })}
        >
          {downloading ? <span className="spin-ring size-3" aria-hidden="true" /> : null}
          {t("download")}
        </a>
      ) : (
        <button type="button" disabled className={buttonVariants({ size: "sm", className: "w-full min-w-0 px-1 text-xs" })} title={pending ? t("pending") : exporting ? t("exporting") : undefined}>
          {t("download")}
        </button>
      )}
      {canEdit ? (
        <Link href={universalEditorHref(creativeId!, from, batchId)} className={buttonVariants({ size: "sm", className: "w-full min-w-0 px-1 text-xs" })}>
          {t("edit")}
        </Link>
      ) : (
        <button type="button" disabled className={buttonVariants({ size: "sm", className: "w-full min-w-0 px-1 text-xs" })} title={reason ?? undefined}>
          {t("edit")}
        </button>
      )}
    </div>
    </div>
  )
}

/** "Edit not exported" / "Exporting…" line on the card (the Edited badge itself is the existing EditedBadge). */
export function PieceEditState({ editor }: { editor: PieceEditorView | null | undefined }) {
  const t = useTranslations("editorU.card")
  if (!editor) return null
  const exporting = !!editor.export && editor.export.stage !== "failed" && editor.export.stage !== "done"
  if (exporting) return <span className="text-xs font-semibold text-status-progress" role="status">{t("exporting")}</span>
  if (editor.export?.stage === "failed") return <span className="text-xs font-semibold text-status-failed">{t("exportFailed")}</span>
  if (editor.pendingExport) return <span className="text-xs font-semibold text-status-waiting">{t("pending")}</span>
  return null
}
