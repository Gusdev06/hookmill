"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { EditableText, HeadlineFitResult, InsufficientCreditsDetails, IterateBatch, IteratePiece, IterateTemplateRun, PieceHeadline } from "@/lib/api/types"
import { useHeadlineFit } from "@/lib/headline-fit"
import { iterateHref, templateAdHref, templateRunHref, templateSelectionHref, templatesHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { NavIcon } from "@/components/shell/nav-icon"
import { FlowBar } from "@/components/flow-bar"
import { AnalyzeScreen } from "@/components/iterate/analyze-screen"
import { BatchError, BatchSkeleton } from "@/components/iterate/batch-screen"
import { CleanVersionUpload, swapReasonOf } from "@/components/iterate/captions"
import { DownloadScreen } from "@/components/iterate/download-screen"
import { GenerateScreen } from "@/components/iterate/generate-screen"
import { Bar, Card, HeadlineChange, HeadlineMarks, IterActionBar, IterWrap, PieceKind, TemplateFlowContext, TypeThumb, pieceType, usePieceName } from "@/components/iterate/parts"
import { UnlockDialog } from "@/components/iterate/sample"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ik, useIterate, useIterateConfig } from "@/hooks/use-iterate"
import { tk, useCredits, useTemplateList } from "@/hooks/use-templates"
import { ME_KEY } from "@/hooks/use-me"
import { TourTip } from "@/components/tour/tip"
import { AiPreviewsRun } from "./ai-previews"
import { FitPill, GetCreditsLink, Pill, TemplateStill, TemplateVideo, useCreditLabel, useFitText } from "./parts"

/*
 * /templates/run/:batchId — the batch born from a template (templates-creditos-v1): Reading (screen 4) → Plan + cost (5, 5c pack)
 * → Generate / Download (Iterate's screens under the Templates FlowBar, with the credit line). Polling GET /iterate/:id (1.5 s).
 * templates-multi-v1 §5.3: a batch of several checked templates (`tpl.selection`, slug "selection") shows the SelectionPlan; its
 * slug is not a real template, so nothing here asks GET /ad-templates/selection (404).
 */
/** Ad step / gallery of the run: the selection goes back to /templates/selection?t=… with its checks. */
const adHrefOf = (tpl: IterateTemplateRun) => (tpl.selection ? templateSelectionHref(tpl.selection.slugs) : templateAdHref(tpl.slug))
const galleryHrefOf = (tpl: IterateTemplateRun) => (tpl.selection ? templatesHref(null, tpl.selection.slugs) : templatesHref())
export function TemplateRunScreen({ id }: { id: string }) {
  const q = useIterate(id)
  const router = useRouter()
  const view = useSearchParams().get("view")
  const qc = useQueryClient()
  const b = q.data
  const noTemplate = !!b && !b.template
  useEffect(() => {
    if (noTemplate) router.replace(iterateHref(id))
  }, [noTemplate, id, router])
  // the credits move when the batch settles (charged / refunded): refresh the balance
  const settled = b?.template?.status
  useEffect(() => {
    if (settled) void qc.invalidateQueries({ queryKey: tk.credits })
  }, [settled, qc])
  if (q.isPending || noTemplate) return <BatchSkeleton />
  if (q.isError && !b) return <BatchError error={q.error} onRetry={() => q.refetch()} />
  const batch = b!
  const tpl = batch.template!
  // templates-ia-previas-v1: a With AI batch with previews (4 images → approve → videos); the 04/11 batches keep AiProduction
  if (batch.ai) return <AiPreviewsRun batch={batch} tpl={tpl} />
  if (tpl.autoGenerate) return <AiProduction batch={batch} tpl={tpl} />
  if (batch.status === "ANALYSIS_FAILED")
    return (
      <TemplateFlowContext.Provider value={{ hrefs: { template: galleryHrefOf(tpl), ad: adHrefOf(tpl) } }}>
        <AnalyzeScreen batch={batch} />
      </TemplateFlowContext.Provider>
    )
  if (batch.status === "ANALYZING" || batch.status === "PLANNING") return <Reading batch={batch} tpl={tpl} />
  if (batch.status === "PLAN_READY")
    return tpl.selection ? <SelectionPlan batch={batch} tpl={tpl} sel={tpl.selection} /> : tpl.pack ? <PackPlan batch={batch} tpl={tpl} /> : <Plan batch={batch} tpl={tpl} />
  return (
    <TemplateFlowContext.Provider
      value={{
        hrefs: { template: templatesHref(), generate: templateRunHref(batch.id) + "?view=generate", download: templateRunHref(batch.id) + "?view=download" },
        note: <RunNote tpl={tpl} />,
      }}
    >
      <Launched batch={batch} view={view} />
    </TemplateFlowContext.Provider>
  )
}

function AiProduction({ batch, tpl }: { batch: IterateBatch; tpl: IterateTemplateRun }) {
  const t = useTranslations('adTemplates.aiProduction')
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const piece = batch.pieces[0]
  const file = piece?.files.find((f) => f.format === '9x16')
  const ready = !!file && piece.status === 'ready'
  const failed = piece?.status === 'failed' || tpl.productionStage === 'failed'
  const retry = useMutation({
    mutationFn: () => api.iterate.retryPiece(piece.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ik.batch(batch.id) }); void qc.invalidateQueries({ queryKey: tk.credits }) },
    onError: (e) => toast(errorMessage(e)),
  })
  const stages = ['reading', 'writing', 'presenters', 'video', 'render'] as const
  const index = Math.max(0, stages.indexOf(tpl.productionStage as typeof stages[number]))
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-7 px-5 py-10" aria-live="polite">
      <div>
        <Link href="/templates?tab=ai" className="text-sm text-fg-2">← {t('templates')}</Link>
        <h1 className="mt-5">{tpl.name}</h1>
        <p className="mt-2 text-fg-2">{t(ready ? 'ready' : failed ? 'failed' : 'description')}</p>
      </div>
      {ready ? (
        <div className="grid gap-6 rounded-xl border border-line bg-card p-5 tablet:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <video controls playsInline preload="metadata" src={file.url} poster={piece.poster?.url} className="aspect-[9/16] w-full rounded-lg bg-ink" />
          <div className="flex flex-col items-start gap-4 py-2">
            <span className="eyebrow">9:16 · MP4</span>
            <h2 className="text-xl">{batch.source.name}</h2>
            <p className="text-fg-2">{t('review')}</p>
            <a href={file.url} download={file.name} className={buttonVariants({ variant: 'brand' })}>{t('download')}</a>
            <Link href="/library" className={buttonVariants({ variant: 'outline' })}>{t('library')}</Link>
            <Link href={templateAdHref(tpl.slug)} className="mt-auto text-sm underline underline-offset-4">{t('another')}</Link>
          </div>
        </div>
      ) : failed ? (
        <div className="grid gap-4 rounded-xl border border-line bg-card p-6">
          <p>{t('failedHelp')}</p>
          <Button className="justify-self-start" onClick={() => retry.mutate()} disabled={retry.isPending || !piece} aria-busy={retry.isPending}>{t('retry')}</Button>
          <Link href={templateAdHref(tpl.slug)} className="text-sm underline underline-offset-4">{t('another')}</Link>
        </div>
      ) : <div className="rounded-xl border border-line bg-card p-6">
        <p className="mb-6 text-sm text-fg-2">{batch.source.name}</p>
        <ol className="m-0 grid list-none gap-5 p-0">
          {stages.map((stage, i) => (
            <li key={stage} className={cn('flex items-center gap-3', i > index && 'text-fg-3')} aria-current={i === index ? 'step' : undefined}>
              <span className={cn('flex size-7 items-center justify-center rounded-full border border-line text-xs', i < index && 'bg-brand text-ink')}>
                {i < index ? '✓' : i === index ? <span className="spin-ring size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span>{t(stage)}</span>
            </li>
          ))}
        </ol>
      </div>}
      {ready || failed ? <RunNote tpl={tpl} /> : <p className="text-sm text-fg-2">{t('background')}</p>}
    </main>
  )
}

function Launched({ batch, view }: { batch: IterateBatch; view: string | null }) {
  const failed = batch.pieces.some((p) => p.status === "failed")
  if (view === "download" && (batch.phase === "download" || failed)) return <DownloadScreen batch={batch} />
  if (view === "generate" || batch.phase === "generate") return <GenerateScreen batch={batch} />
  return <DownloadScreen batch={batch} />
}

/** The credit line under the FlowBar of Generate / Download (reserved → charged / refunded). */
function RunNote({ tpl }: { tpl: IterateTemplateRun }) {
  const t = useTranslations("adTemplates.run")
  const label = useCreditLabel()
  const text =
    tpl.pool === null
      ? t("noteTeam")
      : tpl.pool === "SAMPLE"
        ? tpl.status === "SETTLED" ? t("noteSampleSettled", { charged: tpl.charged, refunded: tpl.refunded }) : t("noteSample", { held: tpl.held })
        : tpl.status === "SETTLED"
          ? tpl.refunded ? t("noteRefunded", { charged: label(tpl.charged), refunded: label(tpl.refunded) }) : t("noteCharged", { charged: label(tpl.charged) })
          : t("noteHeld", { held: label(tpl.held) })
  return (
    <p className="m-0 flex items-center gap-2 text-[13px] text-fg-2" role="status">
      <Pill tone={tpl.tier === "AI" ? "ai" : "cr"}>{tpl.name}</Pill>
      {text}
    </p>
  )
}

/** The real template's card (example, out). Off for a selection: its slug "selection" isn't a template (404). */
function useTemplateCard(tpl: IterateTemplateRun) {
  return useQuery({ queryKey: ["ad-templates", "card", tpl.slug], queryFn: ({ signal }) => api.adTemplates.get(tpl.slug, {}, { signal }), staleTime: 60_000, enabled: !tpl.selection })
}

function Flow({ tpl, running }: { tpl: IterateTemplateRun; running?: boolean }) {
  const { session } = useSession()
  return <FlowBar flow="templates" current="plan" running={running} client={session.workspace.name} hrefs={{ template: galleryHrefOf(tpl), ad: adHrefOf(tpl) }} exitHref="/templates" />
}

// ───────────── 4 · reading ─────────────
const READ_STEPS: { key: string; keys: string[] }[] = [
  { key: "downloaded", keys: ["decode"] },
  { key: "transcribing", keys: ["transcribe"] },
  { key: "blocks", keys: ["cuts", "edit_map", "blocks"] },
  { key: "brain", keys: ["audience", "offer", "proof", "page"] },
  { key: "fits", keys: ["planning"] },
]
/** troca-texto-queimado-v1 §16.5: `preparing_plate` (erasing the old headline, before the texts) only when the API sends it. */
const readStepsOf = (checklist: { key: string }[]) =>
  checklist.some((c) => c.key === "preparing_plate")
    ? [...READ_STEPS.slice(0, -1), { key: "plate", keys: ["preparing_plate"] }, READ_STEPS[READ_STEPS.length - 1]]
    : READ_STEPS

function Reading({ batch, tpl }: { batch: IterateBatch; tpl: IterateTemplateRun }) {
  const t = useTranslations("adTemplates.reading")
  const ts = useTranslations("adTemplates.selection")
  const label = useCreditLabel()
  const card = useTemplateCard(tpl)
  const a = batch.analysis
  const st = (k: string) => a.checklist.find((c) => c.key === k)?.status ?? "pending"
  const eta = a.etaSec
  return (
    <IterWrap>
      <Flow tpl={tpl} running />
      <div className="flex flex-wrap items-start gap-[18px]">
        <section className="beam relative flex min-w-0 flex-[999_1_480px] flex-col gap-4 rounded-lg border border-line bg-card p-4 tablet:p-[18px]" aria-busy="true">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4">
            <span className="orb" aria-hidden="true"><i /><i /><i /></span>
            <div className="grid min-w-0 gap-1.5">
              <span className="eyebrow">{eta ? t("eyebrowEta", { s: eta }) : t("eyebrow")}</span>
              <h1 className="text-2xl [overflow-wrap:anywhere]">{batch.source.name}</h1>
              <p className="m-0 text-fg-2">{t("lede")}</p>
            </div>
          </div>
          <ul className="m-0 grid list-none gap-2.5 p-0" aria-live="polite">
            {readStepsOf(a.checklist).map((s) => {
              const states = s.keys.map(st)
              const done = states.every((x) => x === "done")
              const failed = states.includes("failed")
              const run = !done && !failed && states.some((x) => x === "running" || x === "done")
              return (
                <li key={s.key} className={cn("grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 text-[13.5px]", !done && !run && "text-fg-3")}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-4 rounded-full border-[1.5px] border-line-strong",
                      done && "border-ok-dot bg-ok-dot",
                      run && "animate-spin border-info border-t-transparent",
                      failed && "border-status-failed bg-status-failed"
                    )}
                  />
                  <span>{s.key === "fits" ? (tpl.selection ? ts("stepFits") : t("step.fits", { name: tpl.name })) : t(`step.${s.key}` as never)}</span>
                </li>
              )
            })}
          </ul>
          <Bar value={a.progress} label={t("eyebrow")} />
          <p className="m-0 text-[13px] text-fg-3">{t("canLeave")}</p>
        </section>
        <aside className="on-ink flex max-w-full min-w-0 flex-[1_1_300px] flex-col gap-3.5 rounded-xl bg-ink p-[18px] text-ink-fg desktop:sticky desktop:top-4">
          <span className="eyebrow text-ink-fg-3">{tpl.selection ? ts("name") : t("yourTemplate")}</span>
          {tpl.selection ? (
            <SelectionAside slugs={tpl.selection.slugs} />
          ) : (
            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
              {card.data ? <TemplateVideo template={card.data} label={false} /> : <span className="sk aspect-[9/16] opacity-30" />}
              <div className="grid gap-1">
                <b>{tpl.name}</b>
                <span className="text-xs text-ink-fg-3">{card.data ? `${card.data.out} · ${label(tpl.pack ? tpl.cap : card.data.credits)}` : "…"}</span>
              </div>
            </div>
          )}
          <hr className="m-0 w-full border-0 border-t border-ink-line" />
          <p className="m-0 text-xs text-ink-fg-3">{t("free")}</p>
        </aside>
      </div>
      <IterActionBar hint={t("hint")}>
        <Link href={templatesHref()} className={buttonVariants()}>
          {t("browse")}
        </Link>
      </IterActionBar>
    </IterWrap>
  )
}

/** The checked templates while the ad is read (names and prices from the gallery list; GET /ad-templates, cached). */
function SelectionAside({ slugs }: { slugs: string[] }) {
  const ts = useTranslations("adTemplates.selection")
  const label = useCreditLabel()
  const list = useTemplateList(null)
  const cards = slugs.map((s) => list.data?.items.find((c) => c.slug === s) ?? null)
  const sum = cards.reduce((a, c) => a + (c?.credits ?? 0), 0)
  return (
    <>
      <ul className="m-0 grid list-none gap-2 p-0">
        {cards.map((c, i) => (
          <li key={slugs[i]} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]">
            {c ? <TemplateStill template={c} /> : <span className="sk aspect-[9/16] opacity-30" />}
            <b className="truncate font-semibold">{c?.name ?? slugs[i]}</b>
            <span className="font-mono text-xs text-ink-fg-3 tabular-nums">{c ? label(c.credits) : ""}</span>
          </li>
        ))}
      </ul>
      <span className="text-xs text-ink-fg-3">
        {ts("templatesN", { n: slugs.length })}
        {list.data ? ` · ${label(sum)}` : ""}
      </span>
    </>
  )
}

// ───────────── 5 · plan ─────────────
/** Generate · N credits (409 CREDITS_CHANGED reloads the cost; 402 INSUFFICIENT_CREDITS / sample = the panel or "Talk to us"). */
function useStart(batch: IterateBatch, tpl: IterateTemplateRun) {
  const t = useTranslations("adTemplates.plan")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [changed, setChanged] = useState<{ from: number; to: number } | null>(null)
  const [short, setShort] = useState<InsufficientCreditsDetails | null>(null)
  const [unlock, setUnlock] = useState(false)
  const m = useMutation({
    mutationFn: () => {
      const est = batch.cost.generateEstimateUsd
      return api.iterate.start(batch.id, { expectedPieces: batch.pieces.length, expectedCredits: tpl.quote, ...(typeof est === "number" ? { expectedCostUsd: est } : {}) })
    },
    onSuccess: (b) => {
      setChanged(null)
      qc.setQueryData(ik.batch(b.id), b)
      void qc.invalidateQueries({ queryKey: tk.credits })
      void qc.invalidateQueries({ queryKey: ME_KEY })
      void qc.invalidateQueries({ queryKey: ["creatives"] })
    },
    onError: (e) => {
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: ik.batch(batch.id) })
        void qc.invalidateQueries({ queryKey: tk.credits })
      }
      if (isApiError(e) && e.code === "CREDITS_CHANGED") {
        const to = Number((e.details as { credits?: number } | undefined)?.credits ?? tpl.quote)
        setChanged({ from: tpl.quote, to })
        return refresh()
      }
      if (isApiError(e) && e.code === "INSUFFICIENT_CREDITS") {
        setShort((e.details ?? null) as InsufficientCreditsDetails | null)
        return refresh()
      }
      if (isApiError(e) && e.code === "PAYMENT_REQUIRED") return setUnlock(true)
      if (isApiError(e) && (e.code === "PLAN_CHANGED" || e.code === "ESTIMATE_CHANGED")) {
        toast(t("planChanged"))
        return refresh()
      }
      // an old tab: the plan was emptied meanwhile (nothing reserved). Reloading the batch brings the banner and turns Generate off.
      if (isApiError(e) && e.code === "INVALID_STATE" && (e.details as { reason?: string } | undefined)?.reason === "nothing_selected") {
        toast(t("planEmptied"))
        return refresh()
      }
      toast(errorMessage(e))
    },
  })
  return { m, changed, short, unlock, setUnlock }
}

function GenerateButtons({ tpl, start, disabled }: { tpl: IterateTemplateRun; start: ReturnType<typeof useStart>; disabled: boolean }) {
  const t = useTranslations("adTemplates.plan")
  const label = useCreditLabel()
  const { session } = useSession()
  const sample = tpl.pool === "SAMPLE"
  const busy = start.m.isPending
  const off = disabled || busy || session.workspace.role === "CLIENT"
  if (!tpl.enough && tpl.pool !== null)
    return (
      <>
        <Button id="t-generate" disabled>{t("generate")}</Button>
        <GetCreditsLink brand />
      </>
    )
  return (
    <Button id="t-generate" variant="brand" size="lg" disabled={off} aria-busy={busy} onClick={() => start.m.mutate()} className="max-tablet:col-span-2">
      {busy ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
      {sample ? t("generateSample") : tpl.pool === null ? t("generate") : t("generateN", { cost: label(tpl.quote) })}
    </Button>
  )
}

/** mockup .panel (ink): summary, cost, balance before → after, the refund line; "You need N more" when short. */
function CostPanel({ batch, tpl, out }: { batch: IterateBatch; tpl: IterateTemplateRun; out: string | null }) {
  const t = useTranslations("adTemplates.plan")
  const label = useCreditLabel()
  const credits = useCredits()
  const sample = tpl.pool === "SAMPLE"
  const team = tpl.pool === null
  const need = Math.max(0, tpl.quote - (tpl.balance ?? 0))
  const sampleLeft = credits.data?.sample
  return (
    <aside className="on-ink flex max-w-full min-w-0 flex-[1_1_300px] flex-col gap-3.5 rounded-xl bg-ink p-[18px] text-ink-fg desktop:sticky desktop:top-4" aria-label={t("summary")}>
      <span className="eyebrow text-ink-fg-3">{t("summary")}</span>
      {[
        [t("template"), tpl.name],
        [t("ad"), batch.source.name],
        [t("youGet"), out ?? t("videosN", { n: batch.pieces.length })],
      ].map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2.5 text-[13px] text-ink-fg-2">
          <span>{k}</span>
          <b className="min-w-0 text-right font-semibold text-ink-fg [overflow-wrap:anywhere]">{v}</b>
        </div>
      ))}
      <hr className="m-0 w-full border-0 border-t border-ink-line" />
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-ink-fg-3">{t("cost")}</span>
        <b className="wide text-[26px] font-extrabold text-ink-fg tabular-nums">{sample ? t("free") : team ? t("teamCost") : label(tpl.quote)}</b>
      </div>
      {sample ? (
        <>
          <div className="flex justify-between text-[13px] text-ink-fg-2">
            <span>{t("freeSample")}</span>
            <b className="text-ink-fg">{sampleLeft ? t("sampleAfter", { left: Math.max(0, (tpl.balance ?? sampleLeft.left) - tpl.quote), total: sampleLeft.total }) : "…"}</b>
          </div>
          <p className="m-0 text-xs text-ink-fg-3">{t("sampleNote")}</p>
        </>
      ) : team ? (
        <p className="m-0 text-xs text-ink-fg-3">{t("teamNote")}</p>
      ) : (
        <>
          <div className="flex justify-between text-[13px] text-ink-fg-2">
            <span>{t("balance")}</span>
            <b className={cn("tabular-nums", tpl.enough ? "text-ink-fg" : "text-status-waiting-edge")}>
              {tpl.balance ?? 0} → {tpl.enough ? tpl.after : t("notEnough")}
            </b>
          </div>
          <p className="m-0 text-xs text-ink-fg-3">{tpl.tier === "AI" ? t("refundAi") : t("refundEdit")}</p>
        </>
      )}
      {!tpl.enough && !team ? (
        <div className="grid gap-2 rounded-btn border border-ink-line bg-ink-2 p-3">
          <b>{t(sample ? "needMoreSample" : "needMore", { n: need })}</b>
          <span className="text-xs text-ink-fg-3">{t(sample ? "reduceSample" : "saved")}</span>
          <GetCreditsLink className="border-ink-line bg-ink-3 text-ink-fg hover:border-ink-fg" />
        </div>
      ) : null}
    </aside>
  )
}

/** The alerts after a refused Generate: the cost moved (409) or the balance is short (402). */
function StartAlerts({ start }: { start: ReturnType<typeof useStart> }) {
  const t = useTranslations("adTemplates.plan")
  const label = useCreditLabel()
  return (
    <>
      {start.changed ? (
        <Alert role="status">
          <NavIcon name="info" size={20} />
          <AlertBody>
            <AlertTitle>{t("changedTitle", { to: label(start.changed.to) })}</AlertTitle>
            <AlertDescription>{t("changedBody", { from: label(start.changed.from) })}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
      {start.short ? (
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{t("shortTitle", { need: label(start.short.need) })}</AlertTitle>
            <AlertDescription>{t("shortBody", { balance: label(start.short.balance) })}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <GetCreditsLink />
          </AlertActions>
        </Alert>
      ) : null}
      <UnlockDialog open={start.unlock} onOpenChange={start.setUnlock} />
    </>
  )
}

/**
 * The misfit banner (§6): soft = burned captions (upload clean · other template); hard = no way to generate.
 * troca-texto-queimado-v1 §15.4: `headline_pending` is a hard fit with its own words (unavailable for now, no date). An old
 * `insight.captionNote` is ignored: that plan's wording said the template may cover the captions, which no longer happens.
 */
function FitBanner({ batch, tpl }: { batch: IterateBatch; tpl: IterateTemplateRun }) {
  const t = useTranslations("adTemplates.plan")
  const fitText = useFitText()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const cfg = useIterateConfig()
  const [cleanSent, setCleanSent] = useState(false)
  const soft = tpl.fit.level === "soft" || !!batch.insight?.captionBlocked?.length
  const hard = tpl.fit.level === "hard"
  const pending = tpl.fit.reason === "headline_pending"
  // troca-texto-queimado-v1 §15.8 (F2): the captions couldn't be redone: the reason, in words (fit or the plan's blocked list)
  const tc = useTranslations("captions")
  const swapWhy = swapReasonOf(tpl.fit) ?? swapReasonOf(batch.insight?.captionBlocked?.[0])
  // captions blocked some templates of the plan, others stayed: nothing gets covered, part of it just stays out
  const partial = batch.pieces.length > 0
  const replan = useMutation({
    mutationFn: () => api.iterate.replan(batch.id),
    onSuccess: (b) => qc.setQueryData(ik.batch(b.id), b),
    onError: (e) => toast(errorMessage(e)),
  })
  if (!soft && !hard) return null
  if (hard)
    return (
      <div role="status" className="grid gap-2.5 rounded-lg border border-status-waiting-edge bg-status-waiting-bg p-3.5 text-status-waiting tablet:px-4">
        <b>{pending ? t("pendingTitle") : t("hardTitle", { reason: fitText(tpl.fit) ?? "" })}</b>
        <p className="m-0 text-fg-2">
          {pending
            ? t("pendingBody", { name: tpl.name })
            : t.has(`hardReason.${tpl.fit.reason}` as never)
              ? t(`hardReason.${tpl.fit.reason}` as "hardReason.headline_no_fit", { name: tpl.name })
              : t("hardBody", { name: tpl.name })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={adHrefOf(tpl)} className={buttonVariants({ size: "sm" })}>
            {t("otherAd")}
          </Link>
          <Link href={templatesHref({ championId: batch.source.championId })} className={buttonVariants({ size: "sm", variant: "ghost" })}>
            {t("otherTemplate")}
          </Link>
        </div>
      </div>
    )
  return (
    <div role="status" className="grid gap-2.5 rounded-lg border border-status-waiting-edge bg-status-waiting-bg p-3.5 text-status-waiting tablet:px-4">
      <b>{partial ? t("softPartialTitle") : t("softTitle")}</b>
      <p className="m-0 text-fg-2">{partial ? t("softPartialBody") : t("softBody", { name: tpl.name })}</p>
      {swapWhy ? <p className="m-0 text-fg-3">{tc("swapWhy", { reason: tc(`swapReason.${swapWhy}` as never) })}</p> : null}
      <div className="flex flex-wrap items-start gap-2">
        {cleanSent ? (
          <Button size="sm" variant="brand" disabled={replan.isPending} aria-busy={replan.isPending} onClick={() => replan.mutate()}>
            {t("replan")}
          </Button>
        ) : (
          <CleanVersionUpload championId={batch.source.championId} limits={cfg.data} onDone={() => setCleanSent(true)} label={t("uploadClean")} variant="outline" />
        )}
        <Link href={templatesHref({ championId: batch.source.championId })} className={buttonVariants({ size: "sm", variant: "ghost" })}>
          {t("otherTemplate")}
        </Link>
      </div>
    </div>
  )
}

function Plan({ batch, tpl }: { batch: IterateBatch; tpl: IterateTemplateRun }) {
  const t = useTranslations("adTemplates.plan")
  const label = useCreditLabel()
  const card = useTemplateCard(tpl)
  const start = useStart(batch, tpl)
  const hard = tpl.fit.level === "hard"
  const empty = !batch.pieces.length
  const sample = tpl.pool === "SAMPLE"
  const textsBy = useMemo(() => new Map(tpl.texts.map((x) => [x.pieceId, x.items])), [tpl.texts])
  return (
    <IterWrap>
      <Flow tpl={tpl} />
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="[overflow-wrap:anywhere]">{t("title", { name: tpl.name, ad: batch.source.name })}</h1>
      </div>
      <FitBanner batch={batch} tpl={tpl} />
      <StartAlerts start={start} />
      <div className="flex flex-wrap items-start gap-[18px]">
        <section id="t-plan" className="flex min-w-0 flex-[999_1_480px] flex-col gap-3 rounded-lg border border-line bg-card p-4">
          <div className="grid gap-[18px] tablet:grid-cols-[minmax(0,240px)_minmax(0,1fr)] tablet:items-start">
            {card.data ? <TemplateVideo template={card.data} className="mx-auto max-w-[220px] tablet:max-w-none" /> : <span className="sk mx-auto aspect-[9/16] w-full max-w-[220px] rounded-[10px]" />}
            <div className="flex min-w-0 flex-col gap-3">
              <span className="eyebrow">{t("whatComesOut")}</span>
              {empty ? (
                <p className="m-0 text-[13px] text-fg-2">{t("noPieces")}</p>
              ) : (
                batch.pieces.map((p, i) => <PieceTexts key={p.id} batch={batch} p={p} items={textsBy.get(p.id) ?? []} index={batch.pieces.length > 1 ? i + 1 : null} />)
              )}
              <p className="m-0 text-[12.5px] text-fg-3">{t("editsFree")}</p>
            </div>
          </div>
        </section>
        <CostPanel batch={batch} tpl={tpl} out={card.data ? (card.data.out.includes("9:16") ? card.data.out : `${card.data.out}, 9:16`) : null} />
      </div>
      <IterActionBar
        hint={
          sample ? (
            <>
              <b className="text-fg">{t("freeSample")}</b> · {t("hintSample")}
            </>
          ) : tpl.pool === null ? (
            t("hintTeam")
          ) : (
            <>
              <b className="text-fg">{label(tpl.quote)}</b> · {t("hintBalance", { n: tpl.balance ?? 0 })}
            </>
          )
        }
      >
        <Link href={adHrefOf(tpl)} className={buttonVariants({ variant: "ghost", className: "max-tablet:hidden" })}>
          {t("back")}
        </Link>
        <GenerateButtons tpl={tpl} start={start} disabled={hard || empty} />
      </IterActionBar>
      <PlanTip />
    </IterWrap>
  )
}

/** tour-v2 §4: the first plan ready (Plan / PackPlan / SelectionPlan) — anchored on the lines, beacon on Generate. */
function PlanTip() {
  const t = useTranslations("tip.plan")
  const credits = useCredits()
  return <TourTip tip="plan" when variant={credits.data?.access === "SAMPLE" ? "sample" : "paid"} target="#t-plan" beacon="#t-generate" title={t("title")} body={t("body")} />
}

/** One piece of the plan: its editable texts (A7: FRAME and HEADLINE) or, for the other types, what it changes (read only). */
function PieceTexts({ batch, p, items, index }: { batch: IterateBatch; p: IteratePiece; items: EditableText[]; index: number | null }) {
  const t = useTranslations("adTemplates.plan")
  return (
    <div className="flex flex-col gap-2.5">
      {index ? (
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <TypeThumb type={pieceType(p)} poster={p.poster} className="w-6 rounded-[4px]" />
          {t("videoN", { n: index })}
        </span>
      ) : null}
      {items.length ? (
        items.map((x) => (
          <TextField key={x.path} batchId={batch.id} pieceId={p.id} item={x} headline={pieceType(p) === "HEADLINE" && x.path === "text" ? p.headline ?? null : null} />
        ))
      ) : (
        <div className="flex flex-col gap-1.5 rounded-md border border-line-soft bg-card-2 px-3 py-2.5">
          <PieceKind p={p} className="text-xs text-fg-3" />
          <span className="text-[13px] text-fg-2 text-pretty">{p.change}</span>
          <HeadlineChange p={p} compact />
        </div>
      )}
    </div>
  )
}

const LABEL_KEYS = new Set(["headline", "title", "subtitle", "question", "answer", "caption", "handle", "cta", "primaryText", "pov", "body", "name", "kicker", "topic", "dek", "headline_lead", "headline_highlight"])

/** The step / rejection of the live headline measure, in the field's helper line (§14.4: "Fits", "Slightly smaller", "Box grows"…). */
function fitKey(r: HeadlineFitResult, h: PieceHeadline): string {
  if (r.reject) return `fit.${r.reject}`
  if (r.step === "grow") return h.copy === "box" ? "fit.growBox" : "fit.grow"
  return `fit.${r.step ?? "same"}`
}

/**
 * Save on blur (PATCH .../texts, free). 422 TEXT_INVALID shows the rule under the field and keeps what was typed.
 * troca-texto-queimado-v1 §16.3 (F1b): a copied HEADLINE (`headline.fit`, only in PLAN_READY) is measured while typing with the same
 * function as the API; a text that doesn't fit isn't sent (the API would answer 422 anyway) and the line says why.
 */
function TextField({ batchId, pieceId, item, headline = null }: { batchId: string; pieceId: string; item: EditableText; headline?: PieceHeadline | null }) {
  const t = useTranslations("adTemplates.plan")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [value, setValue] = useState(item.value)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(0)
  // the server value changed (another tab, a replan): follow it unless the field is being edited
  const [base, setBase] = useState(item.value)
  if (item.value !== base) {
    setBase(item.value)
    setValue(item.value)
  }
  const save = useMutation({
    mutationFn: (v: string) => api.iterate.updateTexts(batchId, pieceId, { texts: [{ path: item.path, value: v }] }),
    onSuccess: (b) => {
      setErr(null)
      setSavedAt(Date.now())
      qc.setQueryData(ik.batch(b.id), b)
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "TEXT_INVALID") {
        const v = (e.details as { violations?: { path: string; rule: string; detail?: string }[] } | undefined)?.violations?.find((x) => x.path === item.path)
        setErr(v ? (t.has(`rule.${v.rule}` as never) ? t(`rule.${v.rule}` as never) : v.detail ?? errorMessage(e)) : errorMessage(e))
      } else setErr(errorMessage(e))
    },
  })
  const id = `txt-${pieceId}-${item.path}`
  const leaf = item.label.split(".")
  const key = item.label.replaceAll(".", "_")
  const label = LABEL_KEYS.has(key)
    ? t(`label.${key}` as never)
    : LABEL_KEYS.has(leaf[0]) && leaf.length === 2 && /^\d+$/.test(leaf[1])
      ? `${t(`label.${leaf[0]}` as never)} ${Number(leaf[1]) + 1}`
      : item.label.replace(/[._]/g, " ")
  const long = item.maxChars > 70
  const over = value.length > item.maxChars
  const fit = useHeadlineFit(headline?.mode === "replace" ? headline.fit : null, value)
  const measured = fit.status === "ready" ? fit.result : null
  const misfit = !!measured && !measured.fits
  const commit = () => {
    const v = value.replace(/\s+/g, " ").trim()
    if (!v || v === item.value || over || misfit) return
    save.mutate(v)
  }
  const fitLine = headline && measured && !err ? t(fitKey(measured, headline) as never) : headline && fit.status === "loading" ? t("fit.measuring") : null
  const common = {
    id,
    value,
    maxLength: item.maxChars + 20,
    "aria-invalid": !!err || over || misfit,
    "aria-describedby": `${id}-h`,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      setValue(e.target.value)
      setErr(null)
    },
    onBlur: commit,
  }
  const status = err ?? (save.isPending ? t("saving") : fitLine ?? (savedAt ? t("savedText") : ""))
  const bad = !!err || over || misfit
  return (
    <div className="grid gap-[5px]">
      <label htmlFor={id} className="flex justify-between gap-2 text-xs text-fg-3">
        <span>{label}</span>
        {item.source ? <span className="font-mono text-[10px]">{t("from", { source: item.source })}</span> : null}
      </label>
      {headline ? <HeadlineMarks h={headline} step={null} /> : null}
      {long ? <Textarea rows={2} {...common} /> : <Input {...common} onKeyDown={(e) => (e.key === "Enter" ? (e.currentTarget.blur(), undefined) : undefined)} />}
      <span
        id={`${id}-h`}
        className={cn("flex justify-between gap-2 text-[11px]", bad ? "text-status-failed" : measured?.step === "shrink" || measured?.step === "grow" ? "text-fg-2" : "text-fg-3")}
        role={err ? "alert" : undefined}
        aria-live={headline ? "polite" : undefined}
      >
        <span>{status}</span>
        <span className="font-mono tabular-nums">
          {value.length}/{item.maxChars}
        </span>
      </span>
    </div>
  )
}

// ───────────── 5c · the pack ─────────────
type Line = { key: string; name: string; pieces: IteratePiece[]; included: boolean; credits: number }
const lineKey = (p: IteratePiece) => (pieceType(p) === "FRAME" && p.frame ? `FRAME:${p.frame.template}` : String(p.type))

/** The plan grouped by template (one line per key, plan order) and the line checkbox (PATCH every piece of the line). */
function usePlanLines(batch: IterateBatch, tpl: IterateTemplateRun) {
  const pieceName = usePieceName()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const lines: Line[] = useMemo(() => {
    const m = new Map<string, Line>()
    const add = (p: IteratePiece, included: boolean) => {
      const k = lineKey(p)
      const run = tpl.lines.find((l) => l.key === k)
      const l = m.get(k) ?? { key: k, name: run?.name ?? pieceName(p), pieces: [], included, credits: run?.credits ?? 1 }
      l.pieces.push(p)
      l.included = l.included || included
      m.set(k, l)
    }
    batch.pieces.forEach((p) => add(p, true))
    ;(batch.notSelected ?? []).forEach((p) => add(p, false))
    // plan order (the API's best-fit order), so an unchecked line stays where it was
    return [...m.values()].sort((x, y) => Math.min(...x.pieces.map((p) => p.index)) - Math.min(...y.pieces.map((p) => p.index)))
  }, [batch.pieces, batch.notSelected, tpl.lines, pieceName])
  const toggle = useMutation({
    mutationFn: async (l: Line) => {
      let last: IterateBatch | null = null
      for (const p of l.pieces) last = await api.iterate.select(batch.id, p.id, !l.included)
      return last
    },
    onSuccess: (b) => (b ? qc.setQueryData(ik.batch(b.id), b) : undefined),
    onError: (e) => toast(errorMessage(e)),
  })
  return { lines, toggle }
}

function PackPlan({ batch, tpl }: { batch: IterateBatch; tpl: IterateTemplateRun }) {
  const t = useTranslations("adTemplates.pack")
  const tp = useTranslations("adTemplates.plan")
  const label = useCreditLabel()
  const start = useStart(batch, tpl)
  const sample = tpl.pool === "SAMPLE"
  const { lines, toggle } = usePlanLines(batch, tpl)
  const on = lines.filter((l) => l.included)
  const videos = on.reduce((a, l) => a + l.pieces.length, 0)
  return (
    <IterWrap>
      <Flow tpl={tpl} />
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="[overflow-wrap:anywhere]">{t("title", { n: lines.length, ad: batch.source.name })}</h1>
        <p className="m-0 max-w-[680px] text-fg-2">{t("lede")}</p>
      </div>
      <StartAlerts start={start} />
      <div className="flex flex-wrap items-start gap-[18px]">
        <Card id="t-plan" className="flex-[999_1_480px] gap-1.5 p-4">
          {lines.map((l) => {
            const id = `line-${l.key}`
            return (
              <label key={l.key} htmlFor={id} className={cn("grid cursor-pointer grid-cols-[22px_44px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border border-line bg-card px-2.5 py-2 text-[13px]", !l.included && "opacity-70")}>
                <Checkbox id={id} checked={l.included} disabled={toggle.isPending} onCheckedChange={() => toggle.mutate(l)} />
                <TypeThumb type={pieceType(l.pieces[0])} poster={l.pieces[0].poster} className="rounded-[5px]" />
                <span className="grid min-w-0">
                  <b className="truncate">{l.name}</b>
                  <span className="text-xs text-fg-3">{tp("videosN", { n: l.pieces.length })}</span>
                </span>
                <Pill tone={sample ? "ok" : "cr"}>{sample ? tp("free") : label(l.credits)}</Pill>
              </label>
            )
          })}
          {!lines.length ? <p className="m-0 text-[13px] text-fg-2">{tp("noPieces")}</p> : null}
          <FitPill fit={tpl.fit.level === "ok" ? null : tpl.fit} className="mt-1 self-start" />
        </Card>
        <CostPanel batch={batch} tpl={tpl} out={tp("videosN", { n: videos })} />
      </div>
      <IterActionBar
        hint={
          sample ? (
            <>
              <b className="text-fg">{tp("freeSample")}</b> · {tp("videosN", { n: videos })}
            </>
          ) : (
            <>
              <b className="text-fg">
                {tp("videosN", { n: videos })} · {label(tpl.quote)}
              </b>
              {tpl.quote >= (tpl.cap ?? 10) ? <> · {t("capped", { cap: tpl.cap ?? 10 })}</> : null}
            </>
          )
        }
      >
        <Link href={adHrefOf(tpl)} className={buttonVariants({ variant: "ghost", className: "max-tablet:hidden" })}>
          {tp("back")}
        </Link>
        <GenerateButtons tpl={tpl} start={start} disabled={!on.length || toggle.isPending || tpl.fit.level === "hard"} />
      </IterActionBar>
      <PlanTip />
    </IterWrap>
  )
}

// ───────────── 5s · the selection (templates-multi-v1 §5.3) ─────────────
/**
 * The pack's lines (one per checked template, checkbox to uncheck, credits per line) with the editable texts of each piece inside
 * the line (like the Plan), plus the checked ones that were left out, in grey with their reason and 0 credits. No cap: the price is
 * the sum of the checked lines.
 */
function SelectionPlan({ batch, tpl, sel }: { batch: IterateBatch; tpl: IterateTemplateRun; sel: NonNullable<IterateTemplateRun["selection"]> }) {
  const ts = useTranslations("adTemplates.selection")
  const tp = useTranslations("adTemplates.plan")
  const label = useCreditLabel()
  const start = useStart(batch, tpl)
  const sample = tpl.pool === "SAMPLE"
  const { lines, toggle } = usePlanLines(batch, tpl)
  const textsBy = useMemo(() => new Map(tpl.texts.map((x) => [x.pieceId, x.items])), [tpl.texts])
  const on = lines.filter((l) => l.included)
  const videos = on.reduce((a, l) => a + l.pieces.length, 0)
  const price = sample ? tp("free") : tpl.pool === null ? tp("teamCost") : null
  return (
    <IterWrap>
      <Flow tpl={tpl} />
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{ts("planEyebrow")}</span>
        <h1 className="[overflow-wrap:anywhere]">{ts("planTitle", { n: sel.slugs.length, ad: batch.source.name })}</h1>
        <p className="m-0 max-w-[680px] text-fg-2">{ts("planLede")}</p>
      </div>
      <FitBanner batch={batch} tpl={tpl} />
      <StartAlerts start={start} />
      <div className="flex flex-wrap items-start gap-[18px]">
        <Card id="t-plan" className="flex-[999_1_480px] gap-2 p-3 tablet:p-4">
          {lines.map((l) => {
            const id = `line-${l.key}`
            return (
              <div key={l.key} className={cn("grid gap-3 rounded-md border border-line bg-card px-2.5 py-2", !l.included && "opacity-70")}>
                <label htmlFor={id} className="grid cursor-pointer grid-cols-[22px_44px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]">
                  <Checkbox id={id} checked={l.included} disabled={toggle.isPending} onCheckedChange={() => toggle.mutate(l)} />
                  <TypeThumb type={pieceType(l.pieces[0])} poster={l.pieces[0].poster} className="rounded-[5px]" />
                  <span className="grid min-w-0">
                    <b className="truncate">{l.name}</b>
                    <span className="text-xs text-fg-3">{tp("videosN", { n: l.pieces.length })}</span>
                  </span>
                  <Pill tone={sample ? "ok" : "cr"}>{price ?? label(l.credits)}</Pill>
                </label>
                {l.included ? (
                  <div className="grid gap-3 border-t border-line-soft pt-3 pb-1 tablet:pl-[76px]">
                    {l.pieces.map((p, i) => (
                      <PieceTexts key={p.id} batch={batch} p={p} items={textsBy.get(p.id) ?? []} index={l.pieces.length > 1 ? i + 1 : null} />
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
          {sel.skipped.map((x) => (
            <div key={x.slug} className="grid grid-cols-[22px_44px_minmax(0,1fr)] items-center gap-2.5 rounded-md border border-dashed border-line bg-card-2 px-2.5 py-2 text-[13px] text-fg-3">
              <span aria-hidden="true" />
              <span aria-hidden="true" className="aspect-[9/16] w-full rounded-[5px] border border-line bg-card opacity-60" />
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2.5 gap-y-1">
                <span className="grid min-w-0">
                  <b className="truncate font-semibold text-fg-2">{x.name}</b>
                  <span className="text-xs">{ts("leftOut")}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <FitPill fit={{ level: "hard", reason: x.reason }} />
                  <Pill>{sample ? tp("free") : label(0)}</Pill>
                </span>
              </span>
            </div>
          ))}
          {!lines.length ? <p className="m-0 text-[13px] text-fg-2">{tp("noPieces")}</p> : null}
          <p className="m-0 mt-1 text-[12.5px] text-fg-3">{tp("editsFree")}</p>
        </Card>
        <CostPanel batch={batch} tpl={tpl} out={tp("videosN", { n: videos })} />
      </div>
      <IterActionBar
        hint={
          sample ? (
            <>
              <b className="text-fg">{tp("freeSample")}</b> · {tp("videosN", { n: videos })}
            </>
          ) : tpl.pool === null ? (
            <>
              <b className="text-fg">{tp("videosN", { n: videos })}</b> · {tp("hintTeam")}
            </>
          ) : (
            <b className="text-fg">
              {tp("videosN", { n: videos })} · {label(tpl.quote)}
            </b>
          )
        }
      >
        <Link href={adHrefOf(tpl)} className={buttonVariants({ variant: "ghost", className: "max-tablet:hidden" })}>
          {tp("back")}
        </Link>
        <GenerateButtons tpl={tpl} start={start} disabled={!on.length || toggle.isPending || tpl.fit.level === "hard"} />
      </IterActionBar>
      <PlanTip />
    </IterWrap>
  )
}
