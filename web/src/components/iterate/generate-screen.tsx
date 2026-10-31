"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useFormatter, useNow, useTranslations } from "next-intl"
import type { IterateBatch, IteratePiece } from "@/lib/api/types"
import { iterateHref } from "@/lib/routes"
import { Alert, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"
import { AxisTag, Bar, Code, Cols, Dot, FORMAT_LABEL, FormatChip, GenThumb, Head, InkBig, InkList, InkNote, InkPanel, IterActionBar, IterFlow, IterWrap, CaptionsBadge, HeadlineChange, PieceKind, Tag, TypeThumb, isImagePiece, pieceFormats, pieceType, useIterFormat } from "./parts"
import { PieceTextAlert, TextCheckChip, useStaticStage } from "./text-check"
import { CaptionBlocked, CaptionNote, CleanVersionStatus, NewBatchButton } from "./captions"
import { useCanMakeFormats, usePieceActions, usePriceLabel } from "./piece-actions"
import { PiecePreview } from "./preview"
import { SampleEyebrow, useSampleLocked } from "./sample"

/**
 * Generate (spec §4.2): status per piece, grouped Stretch / New audience. A failed piece never stops the others.
 * Rev. 23/10 (§14.2): the batch renders only the 9:16, so the progress counts the 9:16; 4:5 / 1:1 asked from the preview
 * show up as chips on the ready piece and in "Now" while they render. STATIC = a new image with a price (`imagesUsd`).
 */
export function GenerateScreen({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.generate")
  const ta = useTranslations("iterate.analyze")
  const fmt = useIterFormat()
  const format = useFormatter()
  const now = useNow({ updateInterval: 5_000 })
  const router = useRouter()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const s = batch.summary
  const total = s.pieces
  const settled = batch.phase === "download"
  const allReady = settled && s.ready === total
  const failed = batch.pieces.filter((p) => p.status === "failed")
  const rendering = batch.pieces.filter((p) => p.render)
  const canContinue = settled || failed.length > 0
  const filesDone = batch.pieces.reduce((a, p) => a + pieceFormats(p).filter((f) => f.state === "ready").length, 0)
  const imagesUsd = batch.cost.imagesUsd ?? 0
  const hasImages = imagesUsd > 0 || batch.pieces.some((p) => isImagePiece(p) && p.status !== "left_out")
  const paidRetry = failed.some((p) => (p.retryUsd ?? 0) > 0)
  const eta = fmt.eta(s.renderEtaSec)
  const preview = batch.pieces.find((p) => p.id === previewId) ?? null
  const started = batch.launchedAt ? format.relativeTime(new Date(batch.launchedAt), now) : ""
  // amostra-gratis-v1: the free sample renders like any batch, but nothing here may hand out a file, retry or start a new batch
  const locked = useSampleLocked(batch)
  const ts = useTranslations("sample")

  return (
    <IterWrap>
      <IterFlow current="generate" running={!settled} batchId={batch.id} done={settled ? "download" : undefined} />
      <Cols
        main={
          <>
            <Head
              eyebrow={locked ? <SampleEyebrow /> : settled ? t("eyebrowDone", { name: batch.source.name }) : t("eyebrowStarted", { name: batch.source.name, ago: started })}
              title={allReady ? t("titleDone", { total }) : settled ? t("titleSettled", { ready: s.ready, total }) : t("titleRunning", { total, ready: s.ready })}
            />
            <CaptionsBadge batch={batch} />
            {settled && !locked ? <NewBatchButton batch={batch} /> : null}
            <CleanVersionStatus batch={batch} />
            {failed.length ? (
              <Alert variant="destructive">
                <NavIcon name="alert" size={20} />
                <AlertBody>
                  <AlertTitle>
                    {failed.length === 1 ? t("failedTitle", { code: failed[0].code, n: total - 1 }) : t("failedManyTitle", { count: failed.length })}
                  </AlertTitle>
                  <AlertDescription>{locked ? ts("failedBody") : paidRetry ? t("failedBodyImage") : t("failedBody")}</AlertDescription>
                </AlertBody>
              </Alert>
            ) : null}
            {allReady ? (
              <Alert variant="success">
                <NavIcon name="check" size={20} strokeWidth={2.5} />
                <AlertBody>
                  <AlertTitle>{locked ? ts("doneTitle", { ready: s.ready, total }) : t("doneTitle", { ready: s.ready, total, usd: fmt.usd(batch.cost.totalUsd) })}</AlertTitle>
                  <AlertDescription>{locked ? ts("doneBody") : t("doneBody")}</AlertDescription>
                </AlertBody>
              </Alert>
            ) : null}
            <Group axis="ITERATION" pieces={batch.pieces.filter((p) => p.axis === "ITERATION")} batchId={batch.id} onPreview={setPreviewId} locked={locked} />
            <Group axis="DIVERSITY" pieces={batch.pieces.filter((p) => p.axis === "DIVERSITY")} batchId={batch.id} onPreview={setPreviewId} locked={locked} />
            {/* review 29/10 L4: after the launch the left-out formats are optional, so a quiet line below the groups, not amber up top */}
            <CaptionBlocked batch={batch} collapsed />
          </>
        }
        side={
          <InkPanel label={settled ? t("panelReady") : t("panelRendering")} beam={!settled} role="status">
            <InkBig value={`${s.ready}/${total}`} unit={ta("pieces", { n: total })} />
            <Bar value={total ? (s.ready / total) * 100 : 0} ink label={t("panelRendering")} />
            <InkList
              rows={[
                [
                  t("now"),
                  rendering.length ? (
                    <span key="n" className="font-mono text-xs">
                      {rendering.map((p) => (p.render && p.render.format !== "9x16" ? `${p.code} ${FORMAT_LABEL[p.render.format]}` : p.code)).join(", ")}
                    </span>
                  ) : settled ? t("finished") : t("waiting"),
                ],
                ...(settled ? [] : eta ? ([[ta("timeLeft"), eta]] as [string, string][]) : []),
                [ta("files"), t("filesOf", { done: filesDone, total: s.files })],
                ...(locked ? ([[ts("costLabel"), ts("noCost")]] as [string, string][]) : []),
                [ta("videoCredits"), ta("noneUsed")],
                ...(hasImages ? ([[ta("images"), <span key="i" className="font-mono">{fmt.usd(imagesUsd)}</span>]] as [string, React.ReactNode][]) : []),
              ]}
            />
            {!settled ? (
              <>
                <InkNote>{t("canClose")}</InkNote>
                <Link href="/" className={buttonVariants({ variant: "outline", className: "border-ink-line bg-transparent text-ink-body hover:border-ink-fg" })}>
                  <NavIcon name="left" size={16} />
                  {ta("backHome")}
                </Link>
              </>
            ) : null}
          </InkPanel>
        }
      />
      <IterActionBar hint={locked ? (settled ? ts("hintSettled") : ts("hintRunning")) : allReady ? t("hintDone") : failed.length ? t("hintFailed") : t("hintRunning")}>
        <Button variant="brand" disabled={!canContinue} onClick={() => router.push(iterateHref(batch.id, settled ? null : "download"))}>
          {t("continue")}
          <NavIcon name="right" size={16} />
        </Button>
      </IterActionBar>
      <PiecePreview batch={batch} piece={preview} onClose={() => setPreviewId(null)} />
    </IterWrap>
  )
}

function Group({ axis, pieces, batchId, onPreview, locked }: { axis: "ITERATION" | "DIVERSITY"; pieces: IteratePiece[]; batchId: string; onPreview: (id: string) => void; locked: boolean }) {
  const t = useTranslations("iterate.analyze")
  if (!pieces.length) return null
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1 px-0.5 py-1">
        <h3 className="flex items-center gap-1.5 text-[15px]">
          <AxisTag axis={axis} />
          <span className="font-mono font-medium text-fg-3">· {pieces.length}</span>
        </h3>
        <span className="text-xs text-fg-3">{axis === "ITERATION" ? t("stretchSub") : t("newAudienceSub")}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {pieces.map((p) => (
          <PieceRow key={p.id} p={p} batchId={batchId} onPreview={onPreview} locked={locked} />
        ))}
      </div>
    </section>
  )
}

/** SceneRow of the fase 2 with the code (spec §7): thumb, code + status, reason before the action, what changes, frame line. */
function PieceRow({ p, batchId, onPreview, locked }: { p: IteratePiece; batchId: string; onPreview: (id: string) => void; locked: boolean }) {
  const t = useTranslations("iterate.generate")
  const ts = useTranslations("sample")
  const { retry, leaveOut, makeFormat } = usePieceActions(batchId)
  const canAct = useCanMakeFormats()
  const canMake = canAct && !!p.formats
  const price = usePriceLabel()
  const stageLine = useStaticStage()
  const stage = stageLine(p)
  const retryCost = price(p.retryUsd)
  // 25/10: FRAME_TEXT_OVERFLOW → retrying won't change it; only Leave out
  const noRetry = p.retryHint === "leave_out"
  const formats = pieceFormats(p)
  const asked = p.status === "ready" && formats.some((f) => f.format !== "9x16" && f.state !== "none")
  const running = p.status === "rendering"
  const failed = p.status === "failed"
  const pct = p.render?.progress ?? 0
  const chip =
    p.status === "ready" ? (
      <Tag tone="ok"><Dot />{t("status.ready")}</Tag>
    ) : running ? (
      <Tag tone="info"><Dot pulse />{t("status.rendering", { p: pct })}</Tag>
    ) : failed ? (
      <Tag tone="bad">{t("status.failed")}</Tag>
    ) : p.status === "left_out" ? (
      <Tag tone="neutral">{t("status.left_out")}</Tag>
    ) : (
      <Tag tone="neutral">{t("status.queued")}</Tag>
    )
  const reason = failed ? (
    <span className="text-[13px] font-semibold text-status-failed">
      {p.errorCode && t.has(`err.${p.errorCode}` as never) ? t(`err.${p.errorCode}` as never) : p.failReason}{" "}
      {p.failReason && !noRetry ? null : p.retryHint === "use_product_photo" ? t("err.photoHint") : noRetry ? t("err.leaveOutHint") : p.retryHint ? t("err.retryHint") : null}
    </span>
  ) : null
  return (
    <div
      className={cn(
        "relative grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3.5 rounded-[14px] border bg-card p-3 tablet:grid-cols-[52px_minmax(0,1fr)_auto]",
        failed ? "border-status-failed-edge" : "border-line",
        running && "beam"
      )}
    >
      {p.status === "ready" || (p.previewReady && p.status !== "failed") ? (
        <TypeThumb type={pieceType(p)} poster={p.poster} className="rounded-sm" />
      ) : running ? (
        <GenThumb />
      ) : (
        <GenThumb queued />
      )}
      <div className="flex min-w-0 flex-col gap-[5px]">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Code>{p.code}</Code>
          {chip}
          <TextCheckChip p={p} />
        </div>
        <PieceKind p={p} className="text-xs text-fg-3" />
        <CaptionNote p={p} className="self-start" />
        {reason}
        <PieceTextAlert batchId={batchId} p={p} />
        <span className="text-[13px] text-fg-2">{p.change}</span>
        <HeadlineChange p={p} />
        {running && stage ? (
          <span className="text-xs text-fg-3" role="status">{stage}</span>
        ) : running && p.render ? (
          <span className="font-mono text-xs text-fg-3 tabular-nums">
            {p.render.frame !== null && p.render.frames !== null
              ? t("renderLine", { format: FORMAT_LABEL[p.render.format], frame: p.render.frame, frames: p.render.frames })
              : t("renderLineStill", { format: FORMAT_LABEL[p.render.format] })}
          </span>
        ) : null}
        {asked ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("formatsAria", { code: p.code })}>
            {formats.map((f) => (
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
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 tablet:col-span-1 tablet:flex-col tablet:items-end">
        {locked && (failed || p.status === "left_out") ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-3">
            <Icon name="lock" />
            {ts("retryLocked")}
          </span>
        ) : locked && p.status === "ready" ? (
          <span className="text-xs text-fg-3">{ts("watchOnDownload")}</span>
        ) : p.status === "ready" || (p.previewReady && p.status !== "failed") || (running && isImagePiece(p)) ? (
          <Button size="sm" onClick={() => onPreview(p.id)}>
            {t("preview")}
          </Button>
        ) : failed && canAct ? (
          <>
            {noRetry ? null : (
              <Button size="sm" variant="default" disabled={retry.isPending} onClick={() => retry.mutate({ piece: p, photo: p.retryHint === "use_product_photo" })}>
                <NavIcon name="refresh" size={14} />
                {p.retryHint === "use_product_photo" ? t("retryPhoto") : t("retry")}
                {retryCost ? <span className="font-mono font-medium opacity-80">· {retryCost}</span> : null}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={leaveOut.isPending} onClick={() => leaveOut.mutate(p)}>
              {t("leaveOut")}
            </Button>
          </>
        ) : p.status === "left_out" && canAct ? (
          <Button size="sm" variant="ghost" disabled={retry.isPending} onClick={() => retry.mutate({ piece: p })}>
            <NavIcon name="refresh" size={14} />
            {t("retry")}
            {retryCost ? <span className="font-mono font-medium opacity-80">· {retryCost}</span> : null}
          </Button>
        ) : running ? (
          <Bar value={pct} className="h-1.5 w-[120px]" label={p.code} />
        ) : null}
      </div>
    </div>
  )
}
