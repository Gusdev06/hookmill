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
import { cn } from "@/lib/utils"
import { AxisTag, Bar, Code, Cols, Dot, FORMAT_LABEL, GenThumb, Head, InkBig, InkList, InkNote, InkPanel, IterActionBar, IterFlow, IterWrap, Tag, TypeThumb, useIterFormat } from "./parts"
import { usePieceActions } from "./piece-actions"
import { PiecePreview } from "./preview"

/** Generate (spec §4.2): status per piece, grouped Stretch / New audience. A failed piece never stops the others. */
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
  const rendering = batch.pieces.filter((p) => p.status === "rendering")
  const canContinue = settled || failed.length > 0
  const filesDone = batch.pieces.reduce((a, p) => a + p.formatsReady, 0)
  const eta = fmt.eta(s.renderEtaSec)
  const preview = batch.pieces.find((p) => p.id === previewId) ?? null
  const started = batch.launchedAt ? format.relativeTime(new Date(batch.launchedAt), now) : ""

  return (
    <IterWrap>
      <IterFlow current="generate" running={!settled} batchId={batch.id} done={settled ? "download" : undefined} />
      <Cols
        main={
          <>
            <Head
              eyebrow={settled ? t("eyebrowDone", { name: batch.source.name }) : t("eyebrowStarted", { name: batch.source.name, ago: started })}
              title={allReady ? t("titleDone", { total }) : settled ? t("titleSettled", { ready: s.ready, total }) : t("titleRunning", { total, ready: s.ready })}
            />
            {failed.length ? (
              <Alert variant="destructive">
                <NavIcon name="alert" size={20} />
                <AlertBody>
                  <AlertTitle>
                    {failed.length === 1 ? t("failedTitle", { code: failed[0].code, n: total - 1 }) : t("failedManyTitle", { count: failed.length })}
                  </AlertTitle>
                  <AlertDescription>{t("failedBody")}</AlertDescription>
                </AlertBody>
              </Alert>
            ) : null}
            {allReady ? (
              <Alert variant="success">
                <NavIcon name="check" size={20} strokeWidth={2.5} />
                <AlertBody>
                  <AlertTitle>{t("doneTitle", { ready: s.ready, total, usd: fmt.usd(batch.cost.totalUsd) })}</AlertTitle>
                  <AlertDescription>{t("doneBody")}</AlertDescription>
                </AlertBody>
              </Alert>
            ) : null}
            <Group axis="ITERATION" pieces={batch.pieces.filter((p) => p.axis === "ITERATION")} batchId={batch.id} onPreview={setPreviewId} />
            <Group axis="DIVERSITY" pieces={batch.pieces.filter((p) => p.axis === "DIVERSITY")} batchId={batch.id} onPreview={setPreviewId} />
          </>
        }
        side={
          <InkPanel label={settled ? t("panelReady") : t("panelRendering")} beam={!settled} role="status">
            <InkBig value={`${s.ready}/${total}`} unit={ta("pieces", { n: total })} />
            <Bar value={total ? (s.ready / total) * 100 : 0} ink label={t("panelRendering")} />
            <InkList
              rows={[
                [t("now"), settled ? t("finished") : rendering.length ? <span key="n" className="font-mono text-xs">{rendering.map((p) => p.code).join(", ")}</span> : t("waiting")],
                ...(settled ? [] : eta ? ([[ta("timeLeft"), eta]] as [string, string][]) : []),
                [ta("files"), t("filesOf", { done: filesDone, total: s.files })],
                [ta("videoCredits"), ta("noneUsed")],
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
      <IterActionBar hint={allReady ? t("hintDone") : failed.length ? t("hintFailed") : t("hintRunning")}>
        <Button variant="brand" disabled={!canContinue} onClick={() => router.push(iterateHref(batch.id, settled ? null : "download"))}>
          {t("continue")}
          <NavIcon name="right" size={16} />
        </Button>
      </IterActionBar>
      <PiecePreview batch={batch} piece={preview} onClose={() => setPreviewId(null)} />
    </IterWrap>
  )
}

function Group({ axis, pieces, batchId, onPreview }: { axis: "ITERATION" | "DIVERSITY"; pieces: IteratePiece[]; batchId: string; onPreview: (id: string) => void }) {
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
          <PieceRow key={p.id} p={p} batchId={batchId} onPreview={onPreview} />
        ))}
      </div>
    </section>
  )
}

/** SceneRow of the fase 2 with the code (spec §7): thumb, code + status, reason before the action, what changes, frame line. */
function PieceRow({ p, batchId, onPreview }: { p: IteratePiece; batchId: string; onPreview: (id: string) => void }) {
  const t = useTranslations("iterate.generate")
  const { retry, leaveOut } = usePieceActions(batchId)
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
      {p.failReason ?? (p.errorCode ? t(`err.${p.errorCode}` as never) : null)}{" "}
      {p.retryHint === "use_product_photo" ? t("err.photoHint") : p.retryHint ? t("err.retryHint") : null}
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
        <TypeThumb type={p.type} poster={p.poster} className="rounded-sm" />
      ) : running ? (
        <GenThumb />
      ) : (
        <GenThumb queued />
      )}
      <div className="flex min-w-0 flex-col gap-[5px]">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Code>{p.code}</Code>
          {chip}
        </div>
        {reason}
        <span className="text-[13px] text-fg-2">{p.change}</span>
        {running && p.render ? (
          <span className="font-mono text-xs text-fg-3 tabular-nums">
            {p.render.frame !== null && p.render.frames !== null
              ? t("renderLine", { format: FORMAT_LABEL[p.render.format], frame: p.render.frame, frames: p.render.frames })
              : t("renderLineStill", { format: FORMAT_LABEL[p.render.format] })}
          </span>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 tablet:col-span-1 tablet:flex-col tablet:items-end">
        {p.status === "ready" || (p.previewReady && p.status !== "failed") ? (
          <Button size="sm" onClick={() => onPreview(p.id)}>
            {t("preview")}
          </Button>
        ) : failed ? (
          <>
            <Button size="sm" variant="default" disabled={retry.isPending} onClick={() => retry.mutate({ piece: p, photo: p.retryHint === "use_product_photo" })}>
              <NavIcon name="refresh" size={14} />
              {p.retryHint === "use_product_photo" ? t("retryPhoto") : t("retry")}
            </Button>
            <Button size="sm" variant="ghost" disabled={leaveOut.isPending} onClick={() => leaveOut.mutate(p)}>
              {t("leaveOut")}
            </Button>
          </>
        ) : p.status === "left_out" ? (
          <Button size="sm" variant="ghost" disabled={retry.isPending} onClick={() => retry.mutate({ piece: p })}>
            <NavIcon name="refresh" size={14} />
            {t("retry")}
          </Button>
        ) : running ? (
          <Bar value={pct} className="h-1.5 w-[120px]" label={p.code} />
        ) : null}
      </div>
    </div>
  )
}
