"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { EditResponse } from "@/lib/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { qk } from "@/hooks/use-creative"
import { cn } from "@/lib/utils"
import { EdIcon } from "./ed-icon"

export const editorHref = (id: string) => `/creatives/${encodeURIComponent(id)}/editor`

/** What the Edit step needs from the saved EditDoc (only fetched when there is one): any transform / caption transform. */
export function useEditorDocFlags(id: string, edit: EditResponse | undefined) {
  const has = !!edit?.hasEditorChanges
  const q = useQuery({ queryKey: qk.editor(id), queryFn: () => api.editor.get(id), enabled: has, retry: false, staleTime: 30_000 })
  const layers = has ? (q.data?.doc?.layers ?? []) : []
  return { anyTransform: layers.some((l) => !!l.transform), captionTransform: layers.some((l) => l.id === "caption" && !!l.transform) }
}

/** "Editar no vídeo" card at the top of the Edit panel (spec §2.1); locked for the remix-keep variation (F3). */
export function EditorEntryCard({ id, edit, locked = false }: { id: string; edit: EditResponse | undefined; locked?: boolean }) {
  const t = useTranslations("editor.entry")
  const tl = useTranslations("editor.lock")
  // the API decides (GET /edit.editorAvailable: scratch creative, editable state, every scene ready)
  const available = !locked && !!edit?.editorAvailable
  // remix-keep before F3: same reason the API sends in the 422 EDIT_NOT_SUPPORTED of GET/PUT /editor
  const lockText = tl("remix_editor_not_enabled")
  return (
    <div className={cn("grid gap-2.5 rounded-lg border border-line-2 bg-surface-2 p-3.5", !available && "opacity-80")}>
      <div className="flex flex-wrap items-center gap-2">
        <EdIcon name={locked ? "lock" : "move"} />
        <b className="font-semibold">{t("title")}</b>
        <span className="rounded-full border border-line px-[7px] py-px text-xs text-fg-2">{locked ? t("soon") : t("new")}</span>
        {edit?.hasEditorChanges ? <span className="rounded-full border border-line px-[7px] py-px text-xs text-fg-2">{t("hasChanges")}</span> : null}
      </div>
      {locked ? (
        <div className="flex items-start gap-2 rounded-sm border border-dashed border-line-2 px-2.5 py-2 text-xs text-fg-2">
          <EdIcon name="lock" className="mt-px size-3.5" />
          <span>{lockText}</span>
        </div>
      ) : (
        <p className="text-[13px] text-fg-2">{t("body")}</p>
      )}
      {available ? (
        <Link href={editorHref(id)} className={buttonVariants({ variant: "default" })}>
          <EdIcon name="move" />
          {t("title")}
        </Link>
      ) : (
        <Button disabled title={locked ? lockText : t("unavailable")}>
          <EdIcon name="move" />
          {t("title")}
        </Button>
      )}
      <p className="text-xs text-fg-3">{locked ? null : available ? t("alsoReview") : t("unavailable")}</p>
    </div>
  )
}

/** Amber banner on the Edit step when the editor has saved changes that are not in the video yet (§5.3). */
export function EditorDirtyBanner({ id }: { id: string }) {
  const t = useTranslations("editor.entry")
  return (
    <div className="flex flex-wrap items-start gap-2.5 rounded-lg border border-status-waiting-edge bg-status-waiting-bg px-3 py-2.5 text-[13px]">
      <EdIcon name="alert" className="mt-0.5 text-status-waiting" />
      <div className="min-w-[180px] flex-1">
        <b className="font-medium">{t("bannerTitle")}</b>
        <br />
        <span className="text-fg-2">{t("bannerBody")}</span>
      </div>
      <Link href={editorHref(id)} className={buttonVariants({ variant: "default", size: "sm" })}>
        {t("backToEditor")}
      </Link>
    </div>
  )
}

/** Switching template with positioned layers asks first (contract §3.2): "Trocar e reposicionar". */
export function TemplateSwitchDialog({ name, onKeep, onSwap }: { name: string | null; onKeep: () => void; onSwap: () => void }) {
  const t = useTranslations("editor.entry")
  return (
    <AlertDialog open={!!name} onOpenChange={(o) => !o && onKeep()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("tplTitle", { name: name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{t("tplBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onKeep}>{t("keep")}</AlertDialogCancel>
          <AlertDialogAction onClick={onSwap}>{t("swap")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** "editado" badge (D1): on the piece once it went out with editor changes; stronger on a variation. */
export function EditedBadge({ variation = false, className }: { variation?: boolean; className?: string }) {
  const t = useTranslations("editor.entry")
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-[7px] py-px text-xs whitespace-nowrap",
        variation ? "border-transparent bg-status-waiting-bg text-status-waiting" : "border-line text-fg-2",
        className
      )}
      title={t("editedTip")}
    >
      <EdIcon name="pencil" className="size-3" />
      {t("edited")}
    </span>
  )
}
