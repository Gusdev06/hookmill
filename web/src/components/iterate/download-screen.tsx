"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { IterateBatch, IteratePiece } from "@/lib/api/types"
import { iterateHref } from "@/lib/routes"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { NavIcon } from "@/components/shell/nav-icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ik } from "@/hooks/use-iterate"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { AxisTag, Code, Dot, FORMAT_LABEL, FormatChip, Head, IterActionBar, IterFlow, IterWrap, CaptionsBadge, HeadlineChange, PieceKind, TypeThumb, canAsk, isImagePiece, pieceFormats, pieceType, useIterFormat } from "./parts"
import { PieceTextAlert, TextCheckChip, hasTextError, useStaticStage } from "./text-check"
import { useCanMakeFormats, useMakeFormatForAll, usePieceActions, usePriceLabel } from "./piece-actions"
import { PiecePreview } from "./preview"

const inGrid = (p: IteratePiece) => p.status === "ready" || ((p.status === "queued" || p.status === "rendering") && p.previewReady)

/** Hands the signed URL to the browser as a download (the API answers with Content-Disposition: attachment). */
function saveFile(url: string, fileName: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Download (spec §4.3): two folder cards with where to upload, filter, grid with "In zip" (the only adjustment), zip.
 * Rev. 23/10 (§14.2): each card has chips 9:16 · 4:5 · 1:1 with the state per format; "4:5 for all" / "1:1 for all"
 * ask the missing ones (one call per piece, total price in the confirm). The zip takes the formats that are ready.
 */
export function DownloadScreen({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.download")
  const fmt = useIterFormat()
  const format = useFormatter()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [filter, setFilter] = useState<"all" | "it" | "div">("all")
  const [previewId, setPreviewId] = useState<string | null>(null)
  // api.md 25/10: a Retry from here keeps the batch in Download; the piece (which already had its 9:16) stays in the grid
  // and shows its own progress (render.stage / attempt) until the new file replaces the old one
  const ready = batch.pieces.filter(inGrid)
  const shown = ready.filter((p) => filter === "all" || (filter === "it") === (p.axis === "ITERATION"))
  const inZip = ready.filter((p) => p.inZip && p.status === "ready")
  const nIt = inZip.filter((p) => p.axis === "ITERATION").length
  const nDiv = inZip.length - nIt
  const files = inZip.reduce((a, p) => a + p.files.length, 0)
  const size = inZip.reduce((a, p) => a + p.files.reduce((x, f) => x + f.sizeBytes, 0), 0)
  const missing = batch.summary.failed + batch.summary.leftOut
  const pending = batch.pieces.filter((p) => (p.status === "queued" || p.status === "rendering") && !inGrid(p)).length
  const formatsPending = inZip.reduce((a, p) => a + pieceFormats(p).filter((f) => f.state === "queued" || f.state === "rendering").length, 0)
  const preview = batch.pieces.find((p) => p.id === previewId) ?? null
  // spec §7.1: pieces still in the zip with a text error — a line with a link to open each one
  const textErrors = inZip.filter(hasTextError)
  const date = batch.launchedAt ? format.dateTime(new Date(batch.launchedAt), { day: "numeric", month: "short" }) : ""

  // POST /iterate/:id/zip → 200 ready (download now) or 202 building (the batch query polls until ready, then downloads)
  const wantZip = useRef(false)
  const zip = useMutation({
    mutationFn: () => api.iterate.zip(batch.id),
    onSuccess: ({ zip: z }) => {
      qc.setQueryData<IterateBatch>(ik.batch(batch.id), (b) => (b ? { ...b, zip: z } : b))
      if (z.status === "ready" && z.url && z.fileName) {
        saveFile(z.url, z.fileName)
        qc.invalidateQueries({ queryKey: ik.batch(batch.id) })
      } else wantZip.current = true
    },
    onError: (e) => toast(errorMessage(e)),
  })
  useEffect(() => {
    if (!wantZip.current) return
    if (batch.zip.status === "ready" && batch.zip.url && batch.zip.fileName) {
      wantZip.current = false
      saveFile(batch.zip.url, batch.zip.fileName)
      qc.invalidateQueries({ queryKey: ["creatives"] })
    } else if (batch.zip.status === "failed") {
      wantZip.current = false
      toast(t("zipFailed"))
    }
  }, [batch.zip, qc, t])
  const building = zip.isPending || batch.zip.status === "building"

  return (
    <IterWrap>
      <IterFlow current="download" batchId={batch.id} done="download" />
      <Head
        eyebrow={t("eyebrow", { name: batch.source.name, date })}
        title={t("title", { n: inZip.length })}
        lede={t("lede")}
      />
      <CaptionsBadge batch={batch} />
      {batch.downloadedAt && batch.zip.fileName ? (
        <Alert variant="success">
          <NavIcon name="check" size={20} strokeWidth={2.5} />
          <AlertBody className="gap-1">
            <AlertTitle>{t("downloadedTitle", { files: batch.zip.files })}</AlertTitle>
            <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{batch.zip.fileName}</span>
            <AlertDescription>{t("downloadedBody", { n: batch.summary.ready, name: batch.source.name })}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
      {missing || pending ? (
        <Alert variant="info">
          <NavIcon name="info" size={20} />
          <AlertBody>
            <AlertTitle className="font-medium">
              {[missing ? t("notInGrid", { n: missing }) : null, pending ? t("stillRendering", { n: pending }) : null].filter(Boolean).join(" ")}
            </AlertTitle>
          </AlertBody>
          <AlertActions>
            <Link href={iterateHref(batch.id, "generate")} className={buttonVariants({ size: "sm" })}>
              {t("seeBatch")}
            </Link>
          </AlertActions>
        </Alert>
      ) : null}

      {textErrors.length ? (
        <Alert variant="warning">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle className="font-medium">{t("textErrors", { n: textErrors.length })}</AlertTitle>
          </AlertBody>
          <AlertActions>
            {textErrors.map((p) => (
              <Button key={p.id} size="sm" onClick={() => setPreviewId(p.id)}>
                {t("openPiece", { code: p.code })}
              </Button>
            ))}
          </AlertActions>
        </Alert>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
        <Folder dark={false} path={batch.zip.folders.stretch} n={nIt} head={t("stretchHead")} body={t("stretchBody")} />
        <Folder dark path={batch.zip.folders.newAudience} n={nDiv} head={t("newHead")} body={t("newBody", { n: nDiv })} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as typeof filter)} aria-label={t("filterAria")}>
          <ToggleGroupItem value="all" className="min-h-[38px]">{t("filterAll", { n: ready.length })}</ToggleGroupItem>
          <ToggleGroupItem value="it" className="min-h-[38px]">{t("filterStretch", { n: ready.filter((p) => p.axis === "ITERATION").length })}</ToggleGroupItem>
          <ToggleGroupItem value="div" className="min-h-[38px]">{t("filterNew", { n: ready.filter((p) => p.axis === "DIVERSITY").length })}</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-fg-3">{t("formatsNote")}</span>
      </div>
      <MakeForAll batchId={batch.id} pieces={ready.filter((p) => p.status === "ready")} />

      <div className="grid grid-cols-2 gap-2.5 tablet:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] tablet:gap-3.5">
        {shown.map((p) => (
          <PieceCard key={p.id} p={p} batchId={batch.id} onPreview={() => setPreviewId(p.id)} />
        ))}
      </div>

      <IterActionBar
        hint={
          <>
            {t("barHint", { n: inZip.length, files, size: fmt.size(batch.zip.status === "ready" && batch.zip.sizeBytes ? batch.zip.sizeBytes : size) })}
            {formatsPending ? <span className="text-fg-3"> · {t("formatsPending", { n: formatsPending })}</span> : null}
          </>
        }
      >
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {t("home")}
        </Link>
        <Button variant="brand" disabled={!inZip.length || building} onClick={() => zip.mutate()} title={!inZip.length ? t("nothingToZip") : undefined}>
          {building ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : <NavIcon name="dl" size={16} />}
          {building ? t("building") : t("downloadZip")}
        </Button>
      </IterActionBar>
      <PiecePreview batch={batch} piece={preview} onClose={() => setPreviewId(null)} />
    </IterWrap>
  )
}

function Folder({ dark, path, n, head, body }: { dark: boolean; path: string; n: number; head: string; body: string }) {
  const t = useTranslations("iterate.download")
  return (
    <div className="flex items-start gap-3.5 rounded-lg border border-line bg-card p-4">
      <span className={cn("grid size-10 flex-none place-items-center rounded-md border", dark ? "border-fg bg-fg text-brand" : "border-line-soft bg-card-2")}>
        <NavIcon name="folder" size={20} strokeWidth={1.9} />
      </span>
      <div className="flex min-w-0 flex-col gap-[5px]">
        <span className="font-mono text-xs font-semibold [overflow-wrap:anywhere]">{t("folderPieces", { path, n })}</span>
        <b>{head}</b>
        <span className="text-[13px] text-fg-2">{body}</span>
      </div>
    </div>
  )
}

/**
 * "4:5 for all" / "1:1 for all": the ready pieces still without that format (not made or failed). Free formats (video)
 * go straight; with STATIC images in the set, a confirm shows the total first (no spending without the estimate on screen).
 */
function MakeForAll({ batchId, pieces }: { batchId: string; pieces: IteratePiece[] }) {
  const t = useTranslations("iterate.formats")
  const canMake = useCanMakeFormats()
  const price = usePriceLabel()
  const fmt = useIterFormat()
  const all = useMakeFormatForAll(batchId)
  const [confirm, setConfirm] = useState<{ format: "4x5" | "1x1"; pieces: IteratePiece[]; usd: number; images: number } | null>(null)
  if (!canMake || !pieces.length) return null
  const missing = (format: "4x5" | "1x1") =>
    pieces.filter((p) => {
      const f = pieceFormats(p).find((x) => x.format === format)
      return !!p.formats && !!f && canAsk(f)
    })
  const ask = (format: "4x5" | "1x1") => {
    const list = missing(format)
    if (!list.length) return
    const costs = list.map((p) => pieceFormats(p).find((x) => x.format === format)?.requestUsd ?? 0)
    const usd = Math.round(costs.reduce((a, c) => a + c, 0) * 100) / 100
    if (usd > 0) setConfirm({ format, pieces: list, usd, images: costs.filter((c) => c > 0).length })
    else all.mutate({ pieces: list, format })
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2.5">
      <span className="min-w-0 flex-[1_1_200px] text-[13px] text-fg-2">{t("allLead")}</span>
      {(["4x5", "1x1"] as const).map((format) => {
        const list = missing(format)
        const usd = list.reduce((a, p) => a + (pieceFormats(p).find((x) => x.format === format)?.requestUsd ?? 0), 0)
        const cost = price(usd)
        return (
          <Button key={format} size="sm" variant="outline" disabled={!list.length || all.isPending} onClick={() => ask(format)} className="flex-[1_1_auto] tablet:flex-none">
            {all.isPending && all.variables?.format === format ? <span className="spin-ring size-3.5 border-current" aria-hidden="true" /> : null}
            {list.length ? t("allButton", { format: FORMAT_LABEL[format], n: list.length }) : t("allDone", { format: FORMAT_LABEL[format] })}
            {cost ? <span className="font-mono font-medium text-fg-3">· {cost}</span> : null}
          </Button>
        )
      })}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? t("confirmTitle", { format: FORMAT_LABEL[confirm.format], n: confirm.pieces.length }) : null}</AlertDialogTitle>
            <AlertDialogDescription>{confirm ? t("confirmBody", { images: confirm.images, usd: fmt.usd(confirm.usd) }) : null}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "brand" })}
              onClick={() => {
                if (confirm) all.mutate({ pieces: confirm.pieces, format: confirm.format })
                setConfirm(null)
              }}
            >
              {confirm ? t("confirmAction", { usd: fmt.usd(confirm.usd) }) : null}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PieceCard({ p, batchId, onPreview }: { p: IteratePiece; batchId: string; onPreview: () => void }) {
  const t = useTranslations("iterate.download")
  const { inZip, makeFormat } = usePieceActions(batchId)
  const canMake = useCanMakeFormats() && !!p.formats && p.status === "ready"
  const price = usePriceLabel()
  const stageLine = useStaticStage()
  const busy = p.status !== "ready"
  const stage = busy ? (stageLine(p) ?? t("renderingPiece")) : null
  const id = `inzip-${p.id}`
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-line bg-card p-2.5">
      <button type="button" onClick={onPreview} aria-label={t("previewAria", { code: p.code })} className={cn("relative block w-full cursor-pointer rounded-[10px] border-0 bg-transparent p-0", !p.inZip && "[&>.tf]:opacity-50")}>
        <TypeThumb type={pieceType(p)} poster={p.poster} play={!isImagePiece(p)} />
        <TextCheckChip p={p} className="absolute bottom-2 left-2 shadow-[0_1px_6px_rgba(0,0,0,0.25)]" />
      </button>
      <div className="flex flex-wrap items-center gap-[5px]">
        <Code className={cn("text-[11px] whitespace-normal [overflow-wrap:anywhere]", !p.inZip && "opacity-50")}>{p.code}</Code>
      </div>
      {p.frame ? <PieceKind p={p} className="text-xs font-semibold text-fg-2" /> : null}
      <span className="text-xs leading-[1.35] text-fg-2">{p.change}</span>
      <HeadlineChange p={p} compact />
      <PieceTextAlert batchId={batchId} p={p} compact />
      {stage ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-status-progress" role="status">
          <Dot pulse />
          {stage}
        </span>
      ) : null}
      <div className="flex flex-wrap gap-[3px]" role="group" aria-label={t("formatsAria", { code: p.code })}>
        {pieceFormats(p).map((f) => (
          <FormatChip
            key={f.format}
            f={f}
            canMake={canMake}
            busy={makeFormat.isPending && makeFormat.variables?.format === f.format}
            priceLabel={price(f.requestUsd)}
            onMake={() => makeFormat.mutate({ piece: p, format: f.format as "4x5" | "1x1" })}
          />
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between gap-1.5 border-t border-line-soft pt-2">
        <AxisTag axis={p.axis} short className="text-[10px]" />
        <label htmlFor={id} className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-xs font-semibold">
          <Checkbox id={id} checked={p.inZip} disabled={inZip.isPending || busy} onCheckedChange={(v) => inZip.mutate({ piece: p, value: v === true })} />
          {t("inZip")}
        </label>
      </div>
    </div>
  )
}
