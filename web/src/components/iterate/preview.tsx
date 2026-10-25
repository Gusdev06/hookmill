"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { FormatCode, IterateBatch, IteratePiece, PieceFormat } from "@/lib/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { NavIcon } from "@/components/shell/nav-icon"
import { VideoPlayer } from "@/components/video-player"
import { cn } from "@/lib/utils"
import { Bar, Dot, FORMAT_ASPECT, FORMAT_LABEL, FORMAT_PX, FrameIcon, canAsk, isImagePiece, isSupported, pieceFormats, usePieceName } from "./parts"
import { useCanMakeFormats, usePieceActions, usePriceLabel } from "./piece-actions"
import { TextCheckPanel, useStaticStage } from "./text-check"

/**
 * Preview (spec §4.3): dark stage with the big player and Variation | Original; beside it the type, the one thing that
 * changed, the file names, the folder and "Leave out of zip". No "Edit in video" in v1 (contract §12, conflict 3).
 * Rev. 23/10 (§14.2): tabs 9:16 · 4:5 · 1:1 with the state of each format; a format not made yet has its button (with the
 * price when it is a STATIC image), a failed one its reason and "Try again". Full screen on the phone (≤760 px).
 * 25/10 (estatico-montado §A10, spec §7.5): a STATIC opens wider — the image is the protagonist, the Text check panel beside it
 * (below it on the phone, actions in a bar fixed to the bottom). A frame template without a format hides that tab (§B4).
 */
export function PiecePreview({ batch, piece, onClose }: { batch: IterateBatch; piece: IteratePiece | null; onClose: () => void }) {
  const wide = !!piece && isImagePiece(piece)
  return (
    <DialogPrimitive.Root open={!!piece} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(21,23,26,0.62)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] content-start overflow-y-auto bg-card outline-none tablet:inset-auto tablet:left-1/2 tablet:max-h-[calc(100dvh-110px)] tablet:-translate-x-1/2 tablet:content-stretch tablet:overflow-hidden tablet:rounded-xl data-[state=open]:animate-in data-[state=open]:fade-in-0",
            wide
              ? "tablet:top-[50px] tablet:max-h-[calc(100dvh-70px)] tablet:w-[min(1060px,calc(100%-32px))] tablet:grid-cols-[minmax(0,1fr)_minmax(0,380px)]"
              : "tablet:top-[70px] tablet:w-[min(820px,calc(100%-32px))] tablet:grid-cols-[minmax(0,1fr)_minmax(0,300px)]"
          )}
        >
          {piece ? <Body key={piece.id} batch={batch} piece={piece} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

const INK_OUTLINE = "border-ink-line bg-transparent text-ink-body hover:border-ink-fg hover:bg-transparent hover:text-white"

function Body({ batch, piece }: { batch: IterateBatch; piece: IteratePiece }) {
  const t = useTranslations("iterate.preview")
  const ta = useTranslations("iterate.analyze")
  const pieceName = usePieceName()
  const [view, setView] = useState<"var" | "orig">("var")
  const [tab, setTab] = useState<FormatCode>("9x16")
  const { inZip } = usePieceActions(batch.id)
  const formats = pieceFormats(piece).filter(isSupported)
  const current = formats.find((f) => f.format === tab) ?? formats[0]
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
        {orig ? null : (
          <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v as FormatCode)} aria-label={t("formatsAria")} className="border-ink-line bg-ink-2">
            {formats.map((f) => (
              <ToggleGroupItem key={f.format} value={f.format} className="inline-flex min-h-[34px] items-center gap-1.5 font-mono data-[state=on]:bg-ink-3 data-[state=on]:text-white">
                <StateMark f={f} />
                {FORMAT_LABEL[f.format]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <div className={isImagePiece(piece) ? "w-full tablet:w-[min(380px,100%,calc((100dvh-230px)*9/16))]" : "w-[min(280px,100%)]"}>
          {orig ? (
            <VideoPlayer video={batch.source.video} poster={batch.source.thumbnail?.url ?? null} size="sm" />
          ) : (
            <FormatStage batch={batch} piece={piece} f={current} />
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3.5 p-5 pb-[calc(20px+env(safe-area-inset-bottom,0px))] tablet:overflow-y-auto">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <span className="eyebrow">{piece.axis === "ITERATION" ? ta("stretch") : ta("newAudience")}</span>
            <DialogPrimitive.Title className="m-0 flex items-center gap-2 text-lg font-bold">
              {piece.frame ? <FrameIcon id={piece.frame.template} size={18} /> : null}
              {pieceName(piece)}
            </DialogPrimitive.Title>
            <span className="mt-1 inline-flex rounded-[6px] border border-line-soft bg-card-2 px-[7px] py-0.5 font-mono text-xs font-semibold">{piece.code}</span>
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
          {isImagePiece(piece) ? <p className="mt-1.5 mb-0 text-xs text-fg-3">{t("stillOnly")}</p> : null}
        </div>
        {isImagePiece(piece) ? <TextCheckPanel batch={batch} piece={piece} format={orig ? undefined : current} /> : null}
        {piece.suggestedPrimaryText ? <SuggestedText text={piece.suggestedPrimaryText} /> : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-3">{t("files")}</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {names.map((n) => (
              <li key={n} className="rounded-sm border border-line-soft bg-card-2 px-[9px] py-[7px] font-mono text-xs [overflow-wrap:anywhere]">
                {n}
              </li>
            ))}
          </ul>
          {names.length < 3 ? <span className="text-xs text-fg-3">{t("filesMore")}</span> : null}
        </div>
        <div className="flex justify-between gap-2.5 border-t border-line-soft py-2 text-[13px]">
          <span className="text-fg-3">{t("folder")}</span>
          <span className="font-mono text-xs">{folder}</span>
        </div>
        {piece.status === "ready" && !(isImagePiece(piece) && piece.textCheck) ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={inZip.isPending} onClick={() => inZip.mutate({ piece, value: !piece.inZip })}>
              {piece.inZip ? t("leaveOut") : t("putBack")}
            </Button>
          </div>
        ) : null}
        {/* phone: room under the content for the Text check action bar fixed to the bottom */}
        {isImagePiece(piece) && piece.status === "ready" && piece.textCheck && piece.textCheck.status !== "ok" && piece.textCheck.status !== "skipped" ? (
          <div className="h-24 flex-none tablet:hidden" aria-hidden="true" />
        ) : null}
      </div>
    </>
  )
}

/** D14: FRAME "Read the caption" carries the ad text that pays off the curiosity (default primary text on publish, README of the zip). */
function SuggestedText({ text }: { text: string }) {
  const t = useTranslations("iterate.preview")
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-card-2 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg-2">{t("suggestedText")}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => toast(t("copied")))
          }}
        >
          {t("copy")}
        </Button>
      </div>
      <p className="m-0 text-[13px] whitespace-pre-line text-fg">{text}</p>
      <span className="text-xs text-fg-3">{t("suggestedTextNote")}</span>
    </div>
  )
}

/** Small state mark inside a format tab: check = ready, pulsing dot = in line / rendering, ! = failed, nothing = not made. */
function StateMark({ f }: { f: PieceFormat }) {
  if (f.state === "ready") return <NavIcon name="check" size={12} strokeWidth={3} className="text-brand" />
  if (f.state === "queued" || f.state === "rendering") return <span className="inline-flex text-brand"><Dot pulse={f.state === "rendering"} /></span>
  if (f.state === "failed") return <NavIcon name="alert" size={12} strokeWidth={2.4} className="text-[#FFB79A]" />
  return <span className="size-2 flex-none rounded-full border border-current opacity-50" aria-hidden="true" />
}

/** What the selected tab shows: the file (play / download), the wait (honest stage + %), the button to make it, or why it failed. */
function FormatStage({ batch, piece, f }: { batch: IterateBatch; piece: IteratePiece; f: PieceFormat }) {
  const t = useTranslations("iterate.preview")
  const tg = useTranslations("iterate.generate")
  const canMake = useCanMakeFormats()
  const price = usePriceLabel()
  const stageLine = useStaticStage()
  const { makeFormat } = usePieceActions(batch.id)
  const image = isImagePiece(piece)
  const label = FORMAT_LABEL[f.format]
  const file = piece.files.find((x) => x.format === f.format) ?? null
  const [w, h] = FORMAT_PX[f.format]
  const box = cn("grid w-full place-items-center overflow-hidden rounded-[10px]", FORMAT_ASPECT[f.format])

  if (f.state === "ready" && file) {
    return (
      <div className="flex flex-col gap-2.5">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, expires
          <img
            src={file.url}
            alt={t("imageAlt", { code: piece.code, format: label })}
            className={cn(box, "bg-ink-2 object-cover", f.format === "9x16" && piece.textCheck && !piece.inZip && "opacity-45")}
          />
        ) : (
          <VideoPlayer
            video={{ id: file.name, url: file.url, mimeType: file.mimeType, durationSec: file.durationSec ?? undefined, width: w, height: h }}
            poster={f.format === "9x16" ? (piece.poster?.url ?? null) : null}
            size="sm"
          />
        )}
        <a href={file.url} download={file.name} rel="noopener" className={buttonVariants({ size: "sm", variant: "outline", className: INK_OUTLINE })}>
          <NavIcon name="dl" size={14} />
          {t("downloadFormat", { format: label })}
        </a>
      </div>
    )
  }
  if (f.state === "queued" || f.state === "rendering") {
    const pct = f.progress ?? 0
    const stage = f.format === "9x16" ? stageLine(piece) : null
    // §A10: once the 1st image exists (spelling check, or the 2nd image on its way), it stays on screen
    if (image && stage && piece.render?.stage !== "image" && piece.poster)
      return (
        <div className="flex flex-col gap-2.5" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, expires */}
          <img src={piece.poster.url} alt={t("imageAlt", { code: piece.code, format: label })} className={cn(box, "bg-ink-2 object-cover", piece.render?.stage === "retake" && "opacity-60")} />
          <span className="inline-flex items-center justify-center gap-2 text-center text-[13px] text-ink-body">
            <span className="inline-flex text-brand"><Dot pulse /></span>
            {stage}
          </span>
          <span className="text-center text-xs text-ink-fg-2">{t("canClose")}</span>
        </div>
      )
    return (
      <div className="flex flex-col gap-2.5" role="status">
        <div className={cn(box, f.state === "rendering" ? "imggen border border-ink-line" : "border border-dashed border-ink-line bg-ink-2")} aria-hidden="true" />
        <span className="text-center text-[13px] text-ink-body">
          {f.state === "queued" ? t("queuedLine", { format: label }) : image ? (stage ?? t("creatingImage", { format: label })) : t("renderingLine", { format: label, p: pct })}
        </span>
        {f.state === "rendering" && !image ? <Bar value={pct} ink label={label} /> : null}
        <span className="text-center text-xs text-ink-fg-2">{t("canClose")}</span>
      </div>
    )
  }
  const failed = f.state === "failed"
  const ask = canMake && !!piece.formats && piece.status === "ready" && canAsk(f)
  const cost = price(f.requestUsd)
  const reason = failed ? (f.failReason ?? (f.errorCode ? tg(`err.${f.errorCode}` as never) : tg("err.RENDER_ERROR"))) : null
  return (
    <div className={cn(box, "border border-dashed p-4", failed ? "border-[#FFB79A]/50 bg-ink-2" : "border-ink-line bg-ink-2")}>
      <div className="flex max-w-[220px] flex-col items-center gap-2.5 text-center">
        {failed ? (
          <span className="text-[13px] font-semibold text-[#FFB79A]">{reason}</span>
        ) : (
          <span className="text-[13px] text-ink-body">{image ? t("noneImage", { format: label }) : t("noneVideo", { format: label })}</span>
        )}
        {ask ? (
          <Button size="sm" variant={failed ? "outline" : "brand"} className={failed ? INK_OUTLINE : undefined} disabled={makeFormat.isPending} onClick={() => makeFormat.mutate({ piece, format: f.format as "4x5" | "1x1" })}>
            {makeFormat.isPending ? <span className="spin-ring size-3.5 border-current" aria-hidden="true" /> : failed ? <NavIcon name="refresh" size={14} /> : null}
            {failed ? t("tryAgainFormat", { format: label }) : t("makeFormat", { format: label })}
            {cost ? <span className="font-mono font-medium opacity-80">· {cost}</span> : null}
          </Button>
        ) : !canMake && f.format !== "9x16" ? (
          <span className="text-xs text-ink-fg-2">{t("clientCantMake")}</span>
        ) : null}
        {ask && !cost && !failed ? <span className="text-xs text-ink-fg-2">{t("freeFormat")}</span> : null}
      </div>
    </div>
  )
}
