"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { IterateBatch, IteratePiece } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { NavIcon } from "@/components/shell/nav-icon"
import { VideoPlayer } from "@/components/video-player"
import { TypeThumb, useTypeName } from "./parts"
import { usePieceActions } from "./piece-actions"

/**
 * Preview (spec §4.3): dark stage with the big player and Variation | Original; beside it the type, the one thing that
 * changed, the 3 file names, the folder and "Leave out of zip". No "Edit in video" in v1 (contract §12, conflict 3).
 * Full screen on the phone (≤760 px).
 */
export function PiecePreview({ batch, piece, onClose }: { batch: IterateBatch; piece: IteratePiece | null; onClose: () => void }) {
  return (
    <DialogPrimitive.Root open={!!piece} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(21,23,26,0.62)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] overflow-y-auto bg-card outline-none tablet:inset-auto tablet:top-[70px] tablet:left-1/2 tablet:max-h-[calc(100dvh-110px)] tablet:w-[min(820px,calc(100%-32px))] tablet:-translate-x-1/2 tablet:grid-cols-[minmax(0,1fr)_minmax(0,300px)] tablet:overflow-hidden tablet:rounded-xl data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {piece ? <Body key={piece.id} batch={batch} piece={piece} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Body({ batch, piece }: { batch: IterateBatch; piece: IteratePiece }) {
  const t = useTranslations("iterate.preview")
  const ta = useTranslations("iterate.analyze")
  const typeName = useTypeName()
  const [view, setView] = useState<"var" | "orig">("var")
  const { inZip } = usePieceActions(batch.id)
  const f916 = piece.files.find((f) => f.format === "9x16") ?? piece.files[0] ?? null
  const still = piece.type === "STATIC"
  const orig = view === "orig"
  const folder = piece.axis === "ITERATION" ? batch.zip.folders.stretch : batch.zip.folders.newAudience
  const names = piece.files.map((f) => f.name)
  return (
    <>
      <div className="on-ink flex flex-col items-center gap-3.5 bg-ink p-4 pt-[calc(16px+env(safe-area-inset-top,0px))] tablet:overflow-y-auto tablet:p-[22px]">
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "var" | "orig")} aria-label={t("compare")} className="border-ink-line bg-ink-2">
          <ToggleGroupItem value="var" className="min-h-[34px] data-[state=on]:bg-ink-3 data-[state=on]:text-white">
            {t("variation")}
          </ToggleGroupItem>
          <ToggleGroupItem value="orig" className="min-h-[34px] data-[state=on]:bg-ink-3 data-[state=on]:text-white">
            {t("original")}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="w-[min(280px,100%)]">
          {orig ? (
            <VideoPlayer video={batch.source.video} poster={batch.source.thumbnail?.url ?? null} size="sm" />
          ) : still ? (
            <TypeThumb type="STATIC" poster={f916 ? { id: f916.name, url: f916.url, mimeType: f916.mimeType } : piece.poster} label={`${piece.code}, ${t("stillOnly")}`} />
          ) : (
            <VideoPlayer
              video={f916 ? { id: f916.name, url: f916.url, mimeType: f916.mimeType, durationSec: f916.durationSec ?? undefined, width: 1080, height: 1920 } : null}
              poster={piece.poster?.url ?? null}
              size="sm"
            />
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3.5 p-5 pb-[calc(20px+env(safe-area-inset-bottom,0px))] tablet:overflow-y-auto">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <span className="eyebrow">{piece.axis === "ITERATION" ? ta("stretch") : ta("newAudience")}</span>
            <DialogPrimitive.Title className="m-0 text-lg font-bold">{typeName(piece.type)}</DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("close")}>
              <NavIcon name="x" size={16} />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div>
          <span className="text-xs text-fg-3">{t("changed")}</span>
          <p className="mt-1 mb-0">{piece.change}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-3">{t("files")}</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {names.map((n) => (
              <li key={n} className="rounded-sm border border-line-soft bg-card-2 px-[9px] py-[7px] font-mono text-xs [overflow-wrap:anywhere]">
                {n}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-between gap-2.5 border-t border-line-soft py-2 text-[13px]">
          <span className="text-fg-3">{t("folder")}</span>
          <span className="font-mono text-xs">{folder}</span>
        </div>
        {piece.status === "ready" ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={inZip.isPending} onClick={() => inZip.mutate({ piece, value: !piece.inZip })}>
              {piece.inZip ? t("leaveOut") : t("putBack")}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  )
}
