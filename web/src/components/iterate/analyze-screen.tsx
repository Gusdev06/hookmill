"use client"

import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { AnalysisStage, AutoInsight, IterateBatch, IteratePiece } from "@/lib/api/types"
import { iterateHref } from "@/lib/routes"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { SoonBadge } from "@/components/soon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ik } from "@/hooks/use-iterate"
import { cn } from "@/lib/utils"
import {
  AxisTag, Bar, Card, Code, Cols, GenThumb, Head, InkBig, InkList, InkNote, InkPanel, IterActionBar, IterFlow, IterWrap, mmss, Tag, TypeThumb, useIterFormat, useTypeName,
} from "./parts"

const STAGES: AnalysisStage[] = ["reading", "brain", "planning"]
const STAGE_KEYS: Record<AnalysisStage, string[]> = {
  reading: ["decode", "transcribe", "cuts", "edit_map", "blocks"],
  brain: ["audience", "offer", "proof", "page"],
  planning: ["planning"],
}

/** Analyze (spec §4.1): analyzing · ready (+ no Brain / short video / smaller batch) · analysis failed. One screen that grows. */
export function AnalyzeScreen({ batch }: { batch: IterateBatch }) {
  if (batch.status === "ANALYSIS_FAILED") return <Failed batch={batch} />
  if (batch.status === "PLAN_READY") return <PlanReady batch={batch} />
  return <Analyzing batch={batch} />
}

// ───────────── the winner card ─────────────
function SourceCard({ batch, mode }: { batch: IterateBatch; mode: "analyzing" | "ready" | "stopped" }) {
  const t = useTranslations("iterate.analyze")
  const s = batch.source
  const ins = batch.insight
  const facts = [
    s.durationSec !== null ? mmss(s.durationSec) : null,
    s.ratioLabel,
    s.width && s.height ? `${s.width}×${s.height}` : null,
    s.fromLibrary ? t("fromLibrary") : null,
    s.cuts !== null ? t("cuts", { n: s.cuts }) : null,
  ].filter(Boolean) as string[]
  const short = !!ins?.flags.shortVideo
  return (
    <Card>
      <div className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-4 tablet:grid-cols-[120px_minmax(0,1fr)]">
        <TypeThumb type="orig" poster={s.thumbnail} label={s.name} />
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2.5">
            <div className="min-w-0">
              <span className="eyebrow">{t("winner")}</span>
              <h2 className="text-lg [overflow-wrap:anywhere]">{s.name}</h2>
            </div>
            {mode !== "analyzing" ? (
              <Link href={iterateHref(null)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                {t("changeVideo")}
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 font-mono text-xs text-fg-3">
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-fg-3">{mode === "ready" ? (short ? t("blocksOne") : t("blocksFound")) : t("blocksSoFar")}</span>
            <BlockStrip insight={ins} mode={mode} />
          </div>
        </div>
      </div>
    </Card>
  )
}

/** BlockStrip (spec §7): compact read-only timeline; kept blocks in lime-soft. While reading, a dashed "reading…" block. */
function BlockStrip({ insight, mode }: { insight: AutoInsight | null; mode: "analyzing" | "ready" | "stopped" }) {
  const t = useTranslations("iterate.analyze")
  const blocks = insight?.blocks ?? []
  const cell = "min-w-0 overflow-hidden rounded-[6px] border px-1 py-1 text-[10px] font-semibold text-ellipsis whitespace-nowrap tablet:px-1.5 tablet:py-[5px] tablet:text-[11px]"
  const tail = mode !== "ready" ? (
    <span className={cn(cell, "border-dashed border-line-soft bg-card-2 text-fg-3")} style={{ flex: blocks.length ? 6 : 1 }}>
      {mode === "stopped" ? t("stopped") : t("reading")}
    </span>
  ) : null
  return (
    <div className="flex w-full gap-[3px]" aria-label={t("blocksFound")}>
      {blocks.map((b) => (
        <span
          key={b.index}
          className={cn(cell, b.kept ? "border-[#DCEB9F] bg-brand-soft" : "border-line-soft bg-card-2")}
          style={{ flex: Math.max(0.6, b.endSec - b.startSec) }}
          title={`${b.label} · ${mmss(b.startSec)}`}
        >
          {b.label}
          <small className="hidden font-mono text-[10px] font-medium text-fg-3 tablet:block">{mmss(b.startSec)}</small>
        </span>
      ))}
      {tail}
    </div>
  )
}

// ───────────── why it works ─────────────
function WhyCard({ batch }: { batch: IterateBatch }) {
  const tf = useTranslations("iterate.analyze")
  const t = useTranslations("iterate.analyze")
  const ins = batch.insight!
  return (
    <Card aria-labelledby="whyh">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="whyh">{t("whyTitle")}</h2>
        {ins.flags.brainEmpty ? <Tag tone="warn">{t("videoOnly")}</Tag> : null}
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {ins.why.map((w) => (
          <li key={w.key} className="grid grid-cols-[minmax(0,1fr)] gap-0.5 border-t border-line-soft py-3 first:border-t-0 first:pt-0.5 tablet:grid-cols-[76px_minmax(0,1fr)] tablet:gap-3">
            <span className="pt-0.5 font-mono text-[11px] tracking-[0.08em] text-fg-3 uppercase">{t(`why.${w.key}`)}</span>
            <span>
              {w.text}
              <span className="mt-[3px] block text-xs text-fg-3">
                {w.refSource === "brain" && w.brainField ? t("brainRef", { field: t(`brainField.${w.brainField}`), ref: `“${w.ref}”` }) : w.ref || t("fromVideo")}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {ins.kept.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-fg-3">{t("keptLabel")}</span>
          {ins.kept.map((k) => (
            <span key={k} className="rounded-full border border-[#DCEB9F] bg-brand-soft px-[9px] py-[3px] text-xs font-semibold">
              {k}
            </span>
          ))}
        </div>
      ) : null}
      {/* Meta not connected = one line in the footer, not an alert (spec §2.7) */}
      <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2 border-t border-line-soft pt-2.5 text-xs text-fg-3">
        <span>{ins.flags.brainEmpty ? tf("readFromVideo") : tf("readFrom", { client: batch.offer.name })}</span>
        <span className="inline-flex items-center gap-2">
          {tf("metricsSoon")}
          <SoonBadge className="px-2 py-0.5 text-[10px]" />
        </span>
      </div>
    </Card>
  )
}

// ───────────── the plan ─────────────
function PlanRow({ p }: { p: IteratePiece }) {
  const typeName = useTypeName()
  return (
    <div className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 border-t border-line-soft py-2">
      <TypeThumb type={p.type} className="rounded-[6px]" />
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <Code>{p.code}</Code>
          <span className="text-xs text-fg-3">{typeName(p.type)}</span>
        </div>
        <span className="text-[13px] text-fg-2 text-pretty">{p.change}</span>
      </div>
    </div>
  )
}
function PlanGroup({ axis, pieces }: { axis: "ITERATION" | "DIVERSITY"; pieces: IteratePiece[] }) {
  const t = useTranslations("iterate.analyze")
  if (!pieces.length) return null
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-2.5">
        <h3 className="flex items-center gap-2 text-[15px]">
          <AxisTag axis={axis} />
          <span className="font-mono tabular-nums">{pieces.length}</span>
        </h3>
        <span className="text-xs text-fg-3">{axis === "ITERATION" ? t("stretchSub") : t("newAudienceSub")}</span>
      </div>
      {pieces.map((p) => (
        <PlanRow key={p.id} p={p} />
      ))}
    </div>
  )
}
function BatchPlan({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.analyze")
  const stretch = batch.pieces.filter((p) => p.axis === "ITERATION")
  const fresh = batch.pieces.filter((p) => p.axis === "DIVERSITY")
  return (
    <Card aria-labelledby="planh" className="gap-[18px]">
      <div className="flex flex-col gap-1">
        <h2 id="planh">{t("planTitle", { n: batch.pieces.length })}</h2>
        <span className="text-[13px] text-fg-3">{t("planSub")}</span>
      </div>
      <PlanGroup axis="ITERATION" pieces={stretch} />
      <PlanGroup axis="DIVERSITY" pieces={fresh} />
      <div className="border-t border-line-soft pt-2.5 text-xs text-fg-3">{t("formatsLine")}</div>
    </Card>
  )
}

function ThisBatch({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.analyze")
  const fmt = useIterFormat()
  const s = batch.summary
  const eta = fmt.eta(s.renderEtaSec)
  return (
    <InkPanel label={t("thisBatch")}>
      <InkBig value={s.pieces} unit={t("pieces", { n: s.pieces })} />
      <InkList
        rows={[
          [t("stretch"), s.stretch],
          [t("newAudience"), s.newAudience],
          [t("files"), t("filesValue", { n: s.files })],
          ...(eta ? ([[t("readyIn"), eta]] as [string, string][]) : []),
        ]}
      />
      <InkList
        className="border-t border-ink-line pt-3"
        rows={[
          [t("analysis"), <span key="a" className="font-mono">{t("analysisDone", { usd: fmt.usd(batch.cost.analysisUsd) })}</span>],
          [t("rendering"), <span key="r" className="font-mono">{fmt.usd(batch.cost.renderUsd)}</span>],
          [t("videoCredits"), t("noneUsed")],
        ]}
      />
      <InkNote>{t("nothingNew")}</InkNote>
    </InkPanel>
  )
}

// ───────────── analyzing ─────────────
function StageList({ batch, stopped }: { batch: IterateBatch; stopped?: boolean }) {
  const t = useTranslations("iterate.analyze")
  const a = batch.analysis
  const status = (k: string) => a.checklist.find((c) => c.key === k)?.status ?? "pending"
  return (
    <ul className="m-0 flex list-none flex-col gap-[9px] p-0 text-[13px]">
      {STAGES.map((st) => {
        const keys = STAGE_KEYS[st]
        const states = keys.map(status)
        const failed = states.includes("failed")
        const done = states.every((x) => x === "done")
        const running = !failed && !done && states.some((x) => x === "running" || x === "done")
        const label = t(`stage.${st}`)
        const sub = done
          ? keys.map((k) => t(`check.${k}` as never)).join(" · ")
          : failed && batch.error?.detail ? batch.error.detail : keys.map((k) => t(`check.${k}` as never)).join(", ")
        return (
          <li key={st} className={cn("flex items-start gap-2.5", !done && !running && !failed && "text-ink-fg-3", failed && "text-[#FFB79A]")}>
            {done ? (
              <NavIcon name="check" size={16} strokeWidth={2.5} className="flex-none text-brand" />
            ) : failed ? (
              <NavIcon name="x" size={16} strokeWidth={2.5} className="flex-none" />
            ) : running && !stopped ? (
              <span className="m-1 size-2 flex-none animate-pulse rounded-full bg-brand" aria-hidden="true" />
            ) : (
              <NavIcon name="clock" size={16} className="flex-none text-ink-fg-3" />
            )}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn(running && !stopped && "text-white")}>{label}</span>
              <small className="font-mono text-[11px] [overflow-wrap:anywhere] text-ink-fg-3">{sub}</small>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Analyzing({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.analyze")
  const tn = useTranslations("iterate.new")
  const fmt = useIterFormat()
  const format = useFormatter()
  const now = useNow({ updateInterval: 5_000 })
  const a = batch.analysis
  const eta = fmt.eta(a.etaSec)
  return (
    <IterWrap>
      <IterFlow current="analyze" running batchId={batch.id} />
      <Head eyebrow={t("startedAgo", { ago: format.relativeTime(new Date(batch.createdAt), now) })} title={t("readingTitle")} />
      <Cols
        main={
          <>
            <SourceCard batch={batch} mode="analyzing" />
            <Card aria-busy="true">
              <h2>{t("whyTitle")}</h2>
              {[90, 76, 84].map((w) => (
                <div key={w} className="grid grid-cols-[50px_1fr] gap-3 py-2 tablet:grid-cols-[76px_1fr]">
                  <span className="sk h-3 w-[50px] rounded-[6px]" />
                  <div className="flex flex-col gap-1.5">
                    <span className="sk h-3 rounded-[6px]" style={{ width: `${w}%` }} />
                    <span className="sk h-3 rounded-[6px]" style={{ width: `${w - 30}%` }} />
                  </div>
                </div>
              ))}
            </Card>
            <Card aria-busy="true">
              <h2>{t("planTitleLoading")}</h2>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 border-t border-line-soft py-2">
                  <GenThumb />
                  <div className="flex flex-col gap-1.5">
                    <span className="sk h-3 w-[30%] rounded-[6px]" />
                    <span className="sk h-3 w-[80%] rounded-[6px]" />
                  </div>
                </div>
              ))}
            </Card>
          </>
        }
        side={
          <InkPanel label={t("analyzing")} beam role="status">
            <InkBig value={`${a.step}/3`} unit={t("stepsLabel")} />
            <Bar value={a.progress} ink label={t("analyzing")} />
            <StageList batch={batch} />
            {eta ? <InkList rows={[[t("timeLeft"), eta]]} /> : null}
            <InkNote>{t("canClose")}</InkNote>
            <Link href="/" className={buttonVariants({ variant: "outline", className: "border-ink-line bg-transparent text-ink-body hover:border-ink-fg" })}>
              <NavIcon name="left" size={16} />
              {t("backHome")}
            </Link>
          </InkPanel>
        }
      />
      <IterActionBar hint={t("hintAnalyzing")}>
        <Button variant="brand" disabled>
          {tn("generate")}
        </Button>
      </IterActionBar>
    </IterWrap>
  )
}

// ───────────── ready ─────────────
function Notes({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.analyze")
  const tn = useTranslations("iterate.new")
  const typeName = useTypeName()
  const f = batch.insight!.flags
  const n = batch.pieces.length
  const swaps = batch.insight!.swaps
  const swapLine = swaps.length ? t("swaps", { list: swaps.map((s) => `${typeName(s.from)} → ${typeName(s.to)}`).join(" · ") }) : null
  const out: React.ReactNode[] = []
  if (f.brainEmpty) {
    out.push(
      <Alert key="brain" variant="warning">
        <NavIcon name="alert" size={20} />
        <AlertBody className="gap-1.5">
          <AlertTitle>{t("brainEmptyTitle", { client: batch.offer.name })}</AlertTitle>
          <AlertDescription>
            {t("brainEmptyBody")} {swapLine}
          </AlertDescription>
          <AlertActions>
            <Link href="/brain" className={buttonVariants({ size: "sm" })}>
              {tn("openBrain")}
            </Link>
          </AlertActions>
        </AlertBody>
      </Alert>
    )
  } else if (!f.pageCaptured && swaps.some((s) => s.reason === "no_page")) {
    out.push(
      <Alert key="page" variant="warning">
        <NavIcon name="alert" size={20} />
        <AlertBody>
          <AlertTitle>{t("pageMissingTitle")}</AlertTitle>
          <AlertDescription>{t("pageMissingBody")}</AlertDescription>
        </AlertBody>
      </Alert>
    )
  }
  if (f.shortVideo) {
    out.push(
      <Alert key="short" variant="warning">
        <NavIcon name="alert" size={20} />
        <AlertBody>
          <AlertTitle>{t("shortTitle", { dur: `${Math.round(batch.source.durationSec ?? 0)} s` })}</AlertTitle>
          <AlertDescription>{t("shortBody", { n })}</AlertDescription>
        </AlertBody>
      </Alert>
    )
  } else if (f.smallBatch) {
    out.push(
      <Alert key="small" variant="warning">
        <NavIcon name="alert" size={20} />
        <AlertBody>
          <AlertTitle>{t("smallTitle", { n })}</AlertTitle>
          <AlertDescription>{t("smallBody")}</AlertDescription>
        </AlertBody>
      </Alert>
    )
  }
  return out.length ? <>{out}</> : null
}

function PlanReady({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.analyze")
  const fmt = useIterFormat()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const n = batch.pieces.length
  const eta = fmt.eta(batch.summary.renderEtaSec)
  const start = useMutation({
    mutationFn: () => api.iterate.start(batch.id, { expectedPieces: n }),
    onSuccess: (b) => {
      qc.setQueryData(ik.batch(b.id), b)
      qc.invalidateQueries({ queryKey: ["creatives"] })
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "PLAN_CHANGED") {
        toast(t("planChanged"))
        qc.invalidateQueries({ queryKey: ik.batch(batch.id) })
      } else toast(errorMessage(e))
    },
  })
  return (
    <IterWrap>
      <IterFlow current="analyze" batchId={batch.id} />
      <Head eyebrow={t("readyEyebrow", { offer: batch.offer.name })} title={t("readyTitle", { n })} />
      <Notes batch={batch} />
      <Cols
        main={
          <>
            <SourceCard batch={batch} mode="ready" />
            <WhyCard batch={batch} />
            <BatchPlan batch={batch} />
          </>
        }
        side={<ThisBatch batch={batch} />}
      />
      <IterActionBar hint={eta ? t("barHintEta", { n, files: batch.summary.files, eta }) : t("barHint", { n, files: batch.summary.files })}>
        <Button variant="brand" size="lg" disabled={start.isPending || !n} onClick={() => start.mutate()}>
          {start.isPending ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
          {t("generateN", { n })}
          <NavIcon name="right" size={16} />
        </Button>
      </IterActionBar>
    </IterWrap>
  )
}

// ───────────── failed ─────────────
function useFailText() {
  const t = useTranslations("iterate.analyze")
  return (e: NonNullable<IterateBatch["error"]>) => {
    const p = e.params
    switch (e.code) {
      case "MEDIA_INVALID":
        return { title: t("err.MEDIA_INVALID", { decoded: mmss(Number(p.decodedSec ?? 0)), duration: mmss(Number(p.durationSec ?? 0)) }), body: t("err.MEDIA_INVALID_body") }
      case "MEDIA_TOO_SHORT":
        return { title: t("err.MEDIA_TOO_SHORT", { dur: `${Math.round(Number(p.durationSec ?? 0))} s`, min: `${Number(p.minSec ?? 4)} s` }), body: t("err.MEDIA_TOO_SHORT_body") }
      case "PROVIDER_ERROR":
      case "PROVIDER_TIMEOUT":
      case "RATE_LIMITED":
      case "INTERRUPTED":
      case "PLAN_INVALID":
        return { title: t(`err.${e.code}`), body: t("err.retry_body") }
      default:
        return { title: e.reason || t("err.fallback"), body: e.action === "try_again" ? t("err.retry_body") : "" }
    }
  }
}

function Failed({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.analyze")
  const tn = useTranslations("iterate.new")
  const fmt = useIterFormat()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const failText = useFailText()
  const e = batch.error!
  const text = failText(e)
  const retry = useMutation({
    mutationFn: () => api.iterate.retry(batch.id),
    onSuccess: (b) => qc.setQueryData(ik.batch(b.id), b),
    onError: (err) => toast(errorMessage(err)),
  })
  const s = batch.source
  return (
    <IterWrap>
      <IterFlow current="analyze" batchId={batch.id} />
      <Head title={e.stage === "reading" ? t("failedReading") : t("failedOther")} />
      <Alert variant="destructive">
        <NavIcon name="alert" size={20} />
        <AlertBody className="gap-1.5">
          <AlertTitle>{text.title}</AlertTitle>
          <AlertDescription>
            {text.body} {e.chargedUsd > 0 ? t("charged", { usd: fmt.usd(e.chargedUsd) }) : t("nothingCharged")}
          </AlertDescription>
          <AlertActions>
            <Link href={iterateHref(null)} className={buttonVariants({ variant: e.action === "upload_another" ? "default" : "outline", size: "sm" })}>
              <NavIcon name="up" size={14} />
              {t("uploadAnother")}
            </Link>
            {e.action === "try_again" ? (
              <Button size="sm" variant="default" disabled={retry.isPending} onClick={() => retry.mutate()}>
                <NavIcon name="refresh" size={14} />
                {t("tryAgain")}
              </Button>
            ) : null}
          </AlertActions>
        </AlertBody>
      </Alert>
      <Cols
        main={<SourceCard batch={batch} mode="stopped" />}
        side={
          <InkPanel label={t("stoppedEyebrow")}>
            <ul className="m-0 flex list-none flex-col gap-[9px] p-0 text-[13px]">
              <li className="flex items-start gap-2.5">
                <NavIcon name="check" size={16} strokeWidth={2.5} className="flex-none text-brand" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  {s.fromLibrary ? t("fromLibrary") : t("uploaded")}
                  <small className="font-mono text-[11px] text-ink-fg-3">{[s.durationSec !== null ? mmss(s.durationSec) : null, s.ratioLabel].filter(Boolean).join(" · ")}</small>
                </span>
              </li>
            </ul>
            <StageList batch={batch} stopped />
          </InkPanel>
        }
      />
      <IterActionBar hint={e.action === "upload_another" ? t("hintFailed") : t("hintFailedRetry")}>
        <Button variant="brand" disabled>
          {tn("generate")}
        </Button>
      </IterActionBar>
    </IterWrap>
  )
}

