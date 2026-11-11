"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { AiFormat, AiBatchFailureCode, AiPreview, AiPreviewFailureCode, AiPreviewsView, InsufficientCreditsDetails, IterateBatch, IteratePiece, IterateTemplateRun, RegenLimitDetails } from "@/lib/api/types"
import { approvedOf, batchRegenLeft, regenLeft, totalOf } from "@/lib/ai-previews"
import { templateAdHref, templateRunHref, templatesHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { NavIcon } from "@/components/shell/nav-icon"
import { Bar, IterActionBar, IterWrap, mmss } from "@/components/iterate/parts"
import { UnlockDialog } from "@/components/iterate/sample"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ik } from "@/hooks/use-iterate"
import { tk, useCredits } from "@/hooks/use-templates"
import { AiSteps, ChampionStrip, PreviewImage, Tbd, ZoomIcon } from "./ai-parts"
import { GetCreditsLink } from "./parts"

/*
 * /templates/run/:batchId of a With AI previews batch (templates-ia-previas-v1, mockup-with-ai-previas screens 3–6):
 * Previews (cards arrive one by one, approve while the rest draw, "New angle" 3/preview · 6/batch, retry a failed one) →
 * Confirm (the only step with a cost) → Making the videos → Watch & download, with "Make them too" back to the previews.
 * Polling GET /iterate/:id every 2 s (use-iterate). `?view=previews` forces the previews (with `pick=` preselected),
 * `?view=watch&v=<previewId>` the player.
 */
type View = "previews" | "videos" | "watch"

export function AiPreviewsRun({ batch, tpl }: { batch: IterateBatch; tpl: IterateTemplateRun }) {
  const ai = batch.ai!
  const sp = useSearchParams()
  const asked = sp.get("view")
  const approved = approvedOf(batch)
  if (ai.phase === "failed" && !approved.length) return <PlanFailed batch={batch} tpl={tpl} ai={ai} />
  const terminal = approved.every(({ piece }) => piece && (piece.status === "ready" || piece.status === "failed"))
  const anyReady = approved.some(({ piece }) => piece?.status === "ready")
  // every approved video finished (≥1 ready) = the player by itself, also from ?view=videos (the URL after Confirm)
  const view: View = !approved.length || asked === "previews" ? "previews" : asked === "watch" || (terminal && anyReady) ? "watch" : "videos"
  if (view === "previews") return <PreviewsScreen batch={batch} tpl={tpl} ai={ai} />
  if (view === "watch" && anyReady) return <WatchScreen batch={batch} tpl={tpl} ai={ai} />
  return <ProgressScreen batch={batch} tpl={tpl} ai={ai} />
}

/** One idempotency key per action until it succeeds (a double click or a retry after a timeout sends the same key). */
function useRequestIds() {
  const ids = useRef(new Map<string, string>())
  return {
    of: (key: string) => {
      const v = ids.current.get(key) ?? crypto.randomUUID()
      ids.current.set(key, v)
      return v
    },
    done: (key: string) => ids.current.delete(key),
  }
}

function useRunHrefs(batchId: string) {
  return {
    previews: (pick?: string[]) => `${templateRunHref(batchId)}?view=previews${pick?.length ? `&pick=${pick.map(encodeURIComponent).join(",")}` : ""}`,
    videos: `${templateRunHref(batchId)}?view=videos`,
    watch: (id?: string) => `${templateRunHref(batchId)}?view=watch${id ? `&v=${encodeURIComponent(id)}` : ""}`,
  }
}

// ───────────── 3 · previews ─────────────
function PreviewsScreen({ batch, tpl, ai }: { batch: IterateBatch; tpl: IterateTemplateRun; ai: AiPreviewsView }) {
  const t = useTranslations("adTemplates.ai.previews")
  const sp = useSearchParams()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const readOnly = session.workspace.role === "CLIENT"
  const ids = useRequestIds()
  const hrefs = useRunHrefs(batch.id)
  const [picked, setPicked] = useState<Set<string>>(() => new Set((sp.get("pick") ?? "").split(",").filter(Boolean)))
  const [zoom, setZoom] = useState<AiPreview | null>(null)
  const [confirming, setConfirming] = useState(false)
  const ready = ai.previews.filter((p) => p.status === "ready")
  const chosen = ready.filter((p) => picked.has(p.id))
  const planning = ai.phase === "planning" && !ai.previews.length
  const generating = planning || ai.generating > 0
  const total = Math.max(ai.previews.length, planning ? 4 : 0)
  const doneCount = ai.previews.filter((p) => p.status === "ready" || p.status === "approved").length
  const madeN = ai.previews.filter((p) => p.status === "approved").length

  // "4 previews ready" once, when the last one lands while the screen is open
  const wasGenerating = useRef(generating)
  const toasted = useRef(false)
  useEffect(() => {
    if (wasGenerating.current && !generating && ready.length && !toasted.current) {
      toasted.current = true
      toast(t("readyToast", { n: ready.length }))
    }
    wasGenerating.current = generating
  }, [generating, ready.length, t])

  const refresh = () => void qc.invalidateQueries({ queryKey: ik.batch(batch.id) })
  const putPreview = (p: AiPreview) =>
    qc.setQueryData<IterateBatch>(ik.batch(batch.id), (b) => (b?.ai ? { ...b, ai: { ...b.ai, previews: b.ai.previews.map((x) => (x.id === p.id ? p : x)) } } : b))
  const onLimit = (e: unknown) => {
    const d = (isApiError(e) ? e.details : null) as RegenLimitDetails | null
    toast(d?.scope === "batch" ? t("limitBatch", { max: d.max }) : d?.scope === "retry" ? t("limitRetry", { max: d.max }) : t("limitPreview", { max: d?.max ?? 3 }))
  }
  const regen = useMutation({
    mutationFn: (p: AiPreview) => api.iterate.aiPreviews.regenerate(batch.id, p.id, { requestId: ids.of(`regen:${p.id}:${p.regenerations.used}`) }),
    onMutate: (p) => setPicked((s) => (s.has(p.id) ? new Set([...s].filter((x) => x !== p.id)) : s)),
    onSuccess: (p, prev) => {
      ids.done(`regen:${prev.id}:${prev.regenerations.used}`)
      putPreview(p)
      refresh()
    },
    onError: (e) => {
      refresh()
      if (isApiError(e) && e.code === "REGEN_LIMIT") return onLimit(e)
      toast(errorMessage(e))
    },
  })
  const retry = useMutation({
    mutationFn: (p: AiPreview) => api.iterate.aiPreviews.retry(batch.id, p.id, { requestId: ids.of(`retry:${p.id}:${p.retries.used}`) }),
    onSuccess: (p, prev) => {
      ids.done(`retry:${prev.id}:${prev.retries.used}`)
      putPreview(p)
      refresh()
    },
    onError: (e) => {
      refresh()
      if (isApiError(e) && e.code === "REGEN_LIMIT") return onLimit(e)
      toast(errorMessage(e))
    },
  })
  const busyId = (regen.isPending && regen.variables?.id) || (retry.isPending && retry.variables?.id) || null
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))
  const outOfRegens = batchRegenLeft(ai) === 0 && ready.length > 0

  const n = chosen.length
  const cost = totalOf(ai, n)
  const hint = n ? (
    <>
    {t.rich("hintN", {
      n,
      total: ai.previews.length || 4,
      videos: t("videos", { n }),
      cost: cost == null ? t("creditsDash") : t("credits", { n: cost }),
      b: (c) => <b className="text-fg">{c}</b>,
    })}
    {cost == null ? <> <Tbd /></> : null}
    </>
  ) : generating && !ready.length ? (
    t("hintWait")
  ) : (
    t.rich("hintNone", { b: (c) => <b className="text-fg">{c}</b> })
  )

  return (
    <IterWrap>
      <AiSteps current={2} hrefs={{ 0: templatesHref() + "?tab=ai", 1: templateAdHref(tpl.slug) }} />
      <ChampionStrip batch={batch} format={tpl.name} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-[620px] min-w-0 flex-col gap-1.5">
          <h1>{generating && !ready.length && !madeN ? t("titleWait") : t("title")}</h1>
          <p className="m-0 text-fg-2">{t("lede", { format: tpl.name })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {madeN ? (
            <Link href={hrefs.videos} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("videosLink")} · {t("made", { n: madeN })}
            </Link>
          ) : null}
          {ready.length > 1 && !readOnly ? (
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(ready.map((p) => p.id)))}>
              {t("approveAll", { n: ready.length })}
            </Button>
          ) : null}
        </div>
      </div>
      {generating ? (
        <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2.5 rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-fg-2">
          <span className="dot" data-status="progress" />
          <b className="text-fg">{planning ? t("planning") : t("waitLine", { ready: doneCount, total })}</b>
          <Bar value={total ? (doneCount / total) * 100 : 5} className="min-w-[120px] flex-[1_1_160px]" label={t("titleWait")} />
          <span>{t("waitLeft", { s: Math.max(10, (total - doneCount) * 15) })}</span>
        </div>
      ) : null}
      {outOfRegens ? (
        <div role="status" className="flex items-start gap-2.5 rounded-md border border-status-waiting-edge bg-status-waiting-bg px-3 py-2.5 text-[13px] text-fg-2">
          <span className="dot mt-1.5" data-status="waiting" />
          <span>{t("limitNote", { max: ai.limits.regenPerBatch })}</span>
        </div>
      ) : null}
      {readOnly ? <p className="m-0 text-[13px] text-fg-3">{t("readOnly")}</p> : null}

      <div className="grid grid-cols-1 gap-2.5 tablet:grid-cols-2 tablet:gap-3.5 xl:grid-cols-4">
        {planning
          ? (["A", "B", "C", "D"] as const).map((l) => <WaitCard key={l} letter={l} format={ai.format} stage="writing" step={1} />)
          : ai.previews.map((p) => (
              <PreviewCard
                key={p.id}
                p={p}
                ai={ai}
                on={picked.has(p.id) && p.status === "ready"}
                readOnly={readOnly}
                busy={busyId === p.id}
                onToggle={() => toggle(p.id)}
                onRegen={() => regen.mutate(p)}
                onRetry={() => retry.mutate(p)}
                onZoom={() => setZoom(p)}
              />
            ))}
      </div>

      <IterActionBar hint={<span aria-live="polite">{hint}</span>}>
        <Button variant="brand" disabled={!n || readOnly} onClick={() => setConfirming(true)} className="max-tablet:col-span-2">
          {n ? t("make", { n }) : t("makeNone")}
          <NavIcon name="right" size={16} />
        </Button>
      </IterActionBar>

      <ZoomDialog p={zoom} format={ai.format} onClose={() => setZoom(null)} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        batch={batch}
        tpl={tpl}
        ai={ai}
        chosen={chosen}
        onApproved={() => {
          setPicked(new Set())
          setConfirming(false)
        }}
        onNotReady={(gone) => setPicked((s) => new Set([...s].filter((x) => !gone.includes(x))))}
      />
    </IterWrap>
  )
}

const CARD = "relative grid min-w-0 gap-2.5 rounded-lg border border-line bg-card p-2 max-tablet:grid-cols-[116px_minmax(0,1fr)] tablet:grid-rows-[auto_1fr_auto]"

function Letter({ l }: { l: string }) {
  return (
    <span className="absolute bottom-1.5 left-1.5 z-[9] grid size-[22px] place-items-center rounded-[7px] bg-ink font-mono text-[11px] font-semibold text-ink-fg tablet:bottom-2 tablet:left-2 tablet:size-[26px] tablet:text-xs">
      {l}
    </span>
  )
}

function ApproveToggle({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick?: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-btn border border-line-strong bg-card text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-45",
        on && "border-fg bg-fg text-card"
      )}
    >
      <span aria-hidden="true" className={cn("grid size-[18px] place-items-center rounded-[5px] border-[1.5px] border-fg-3", on && "border-brand bg-brand text-fg")}>
        {on ? <NavIcon name="check" size={12} strokeWidth={3} /> : null}
      </span>
      {label}
    </button>
  )
}

/** A preview still being written / drawn (also the one getting a new angle or a retry): Border Beam + Image Generation + real stage. */
function WaitCard({ letter, format, stage, step, p, newAngle }: { letter: string; format: AiFormat; stage: "writing" | "drawing"; step: 1 | 2; p?: AiPreview; newAngle?: boolean }) {
  const t = useTranslations("adTemplates.ai.previews")
  const label = stage === "writing" ? t("writing") : t("drawing")
  return (
    <article className={cn(CARD, "beam")} aria-busy="true" aria-label={t("preview", { l: letter })}>
      <div className="relative min-w-0">
        <PreviewImage preview={p ?? null} format={format} gen />
        <Letter l={letter} />
      </div>
      <div className="grid min-w-0 content-start gap-2 tablet:px-1">
        <div className="flex items-center gap-2 text-[12.5px] text-fg-2">
          <span className="spin-ring size-3.5 flex-none" aria-hidden="true" />
          <span className="min-w-0">{newAngle ? t("newAngle", { stage: label }) : label}</span>
          <small className="ml-auto font-mono text-[11px] text-fg-3">{step}/2</small>
        </div>
        {p?.title ? <b className="text-[13.5px] leading-tight">{p.title}</b> : <span className="sk h-[11px] w-4/5" />}
        <span className="sk h-[11px]" />
        <span className="sk h-[11px] w-3/5" />
      </div>
      <div className="flex items-center gap-1.5 max-tablet:col-span-2">
        <ApproveToggle on={false} disabled label={t("approve")} />
      </div>
    </article>
  )
}

function PreviewCard({
  p, ai, on, readOnly, busy, onToggle, onRegen, onRetry, onZoom,
}: { p: AiPreview; ai: AiPreviewsView; on: boolean; readOnly: boolean; busy: boolean; onToggle: () => void; onRegen: () => void; onRetry: () => void; onZoom: () => void }) {
  const t = useTranslations("adTemplates.ai.previews")
  const failText = useFailText()
  if (p.status === "planned" || p.status === "imaging")
    return <WaitCard letter={p.letter} format={ai.format} stage={p.status === "planned" ? "writing" : "drawing"} step={p.status === "planned" ? 1 : 2} p={p} newAngle={p.regenerations.used > 0} />
  if (p.status === "failed") {
    const canRetry = p.action === "retry" && !readOnly
    return (
      <article className={cn(CARD, "border-status-failed-edge")} aria-label={t("preview", { l: p.letter })}>
        <div className="relative min-w-0">
          <PreviewImage preview={p} format={ai.format} failed />
          <Letter l={p.letter} />
        </div>
        <div className="grid min-w-0 content-start tablet:px-1">
          <div role="alert" className="grid justify-items-start gap-2 rounded-[10px] border border-status-failed-edge bg-status-failed-bg p-2.5 text-[12.5px] text-fg-2">
            <b className="text-status-failed">{t("failTitle")}</b>
            <span>
              {failText.preview(p)} {t("failNothing")}
            </span>
            {canRetry ? (
              <Button size="sm" onClick={onRetry} disabled={busy} aria-busy={busy}>
                {busy ? <span className="spin-ring size-3.5" aria-hidden="true" /> : <NavIcon name="refresh" size={14} />}
                {t("tryAgain")}
              </Button>
            ) : (
              <span className="text-fg-3">{t("failNoRetry")}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 max-tablet:col-span-2">
          <ApproveToggle on={false} disabled label={t("approve")} />
        </div>
      </article>
    )
  }
  const made = p.status === "approved"
  const left = regenLeft(p, ai)
  const regenHint = left
    ? t("regenHint", { left, max: p.regenerations.max, batchLeft: batchRegenLeft(ai), batchMax: ai.limits.regenPerBatch })
    : t("regenOut")
  const host = p.cast.find((c) => c.speaker === "host")
  const guest = p.cast.find((c) => c.speaker === "presenter")
  return (
    <article className={cn(CARD, on && "border-fg shadow-[inset_0_0_0_1px_var(--fg)]")} aria-label={t("preview", { l: p.letter })}>
      <div className="relative min-w-0">
        <PreviewImage preview={p} format={ai.format} badge />
        <Letter l={p.letter} />
        <button
          type="button"
          onClick={onZoom}
          aria-label={t("enlarge", { l: p.letter })}
          className="absolute right-1.5 bottom-1.5 z-[9] grid size-7 cursor-pointer place-items-center rounded-lg border-0 bg-ink/70 text-ink-fg tablet:right-2 tablet:bottom-2 tablet:size-8"
        >
          <ZoomIcon />
        </button>
      </div>
      <div className="grid min-w-0 content-start gap-1.5 tablet:gap-2 tablet:px-1">
        <div className="text-[13.5px] leading-tight font-bold tablet:text-sm">
          <small className="mb-0.5 block font-mono text-[10px] font-medium tracking-[0.06em] text-fg-3 uppercase">{t("angle")}</small>
          {p.title}
        </div>
        {p.hook ? <q className="m-0 border-l-2 border-brand-edge py-0.5 pl-2 text-[12.5px] text-fg not-italic tablet:text-[13px]">{p.hook}</q> : null}
        {p.changes.length ? (
          <div className="grid gap-1 text-xs text-fg-2 tablet:text-[12.5px]">
            <span className="eyebrow text-[10px]">{t("vs")}</span>
            <ul className="m-0 grid list-none gap-1 p-0">
              {p.changes.slice(0, 3).map((c, i) => (
                <li key={i} className="leading-snug">
                  <span className="text-fg-3">{c.before}</span>
                  <span className="px-1 font-mono text-[11px] text-fg-3">→</span>
                  <span className="font-semibold text-fg">{c.after}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <span className="font-mono text-[10.5px] text-fg-3">
          {ai.format === "F10" ? (
            <>
              {t("host")} <b className="font-sans text-xs font-semibold text-fg-2">{host?.name}</b> · {t("guest")} <b className="font-sans text-xs font-semibold text-fg-2">{guest?.name}</b>
            </>
          ) : (
            <>
              {t("presenter")} <b className="font-sans text-xs font-semibold text-fg-2">{p.cast[0]?.name}</b>
            </>
          )}
        </span>
        {p.preserved.length ? <span className="font-mono text-[10.5px] text-fg-3 max-tablet:hidden">{t("kept", { list: p.preserved.join(" · ") })}</span> : null}
      </div>
      <div className="grid gap-1 max-tablet:col-span-2">
        {made ? (
          <span className="flex min-h-10 items-center justify-center gap-1.5 rounded-btn bg-status-approved-bg text-xs font-semibold text-status-approved">
            <NavIcon name="check" size={14} strokeWidth={2.5} />
            {t("videoMade")}
          </span>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <ApproveToggle on={on} disabled={readOnly} onClick={onToggle} label={on ? t("approved") : t("approve")} />
              <Button
                variant="outline"
                className="min-h-10 flex-none"
                disabled={readOnly || !left || busy}
                aria-busy={busy}
                title={regenHint}
                aria-label={t("newAngleAria", { l: p.letter, hint: regenHint })}
                onClick={onRegen}
              >
                {busy ? <span className="spin-ring size-3.5" aria-hidden="true" /> : <NavIcon name="refresh" size={15} />}
                {t("newAngleBtn")}
              </Button>
            </div>
            <span className="px-1 text-right font-mono text-[10.5px] text-fg-3">{regenHint}</span>
          </>
        )}
      </div>
    </article>
  )
}

function ZoomDialog({ p, format, onClose }: { p: AiPreview | null; format: AiFormat; onClose: () => void }) {
  return (
    <Dialog open={!!p} onOpenChange={(v) => (v ? null : onClose())}>
      {p ? (
        <DialogContent className="on-ink grid max-h-[calc(100dvh-16px)] w-[min(420px,calc(100%-16px))] gap-3 overflow-y-auto border-ink bg-ink p-4 text-ink-fg sm:max-w-none">
          <PreviewImage preview={p} format={format} badge className="mx-auto max-h-[70dvh] w-auto" />
          <DialogTitle className="m-0 text-base text-ink-fg">
            {p.letter} · {p.title}
          </DialogTitle>
          {p.hook ? <DialogDescription className="m-0 text-ink-fg-2">“{p.hook}”</DialogDescription> : null}
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

/**
 * The failure of a preview / of the batch in the interface language (QA 07/11: `failReason` comes in English with "Try again"
 * inside). Reads a stable code (`failureCode`, falling back to `errorCode`); unknown codes = a generic line. Never shows `failReason`.
 */
/** Stable codes from the API (`failureCode` in @maquina/contratos) → message keys. Unknown = generic. */
const PREVIEW_FAIL: Record<AiPreviewFailureCode, FailKey> = {
  planning_failed: "planOne", planning_interrupted: "interrupted", image_failed: "imaging", image_blocked: "blocked", image_timeout: "timeout",
}
const BATCH_FAIL: Record<AiBatchFailureCode, FailKey> = { too_few_previews: "plan", planning_failed: "plan", planning_interrupted: "interrupted" }
type FailKey = "plan" | "interrupted" | "planOne" | "imaging" | "blocked" | "timeout" | "generic"
function useFailText() {
  const t = useTranslations("adTemplates.ai.previews.failCode")
  return {
    preview: (p: AiPreview) => t((p.failureCode && PREVIEW_FAIL[p.failureCode]) || "generic"),
    batch: (v: AiPreviewsView) => t((v.failureCode && BATCH_FAIL[v.failureCode]) || "plan"),
  }
}

// ───────────── 4 · confirm ─────────────
function ConfirmDialog({
  open, onOpenChange, batch, tpl, ai, chosen, onApproved, onNotReady,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; batch: IterateBatch; tpl: IterateTemplateRun; ai: AiPreviewsView; chosen: AiPreview[]
  onApproved: () => void; onNotReady: (ids: string[]) => void
}) {
  const t = useTranslations("adTemplates.ai.confirm")
  const tp = useTranslations("adTemplates.ai.previews")
  const qc = useQueryClient()
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const credits = useCredits()
  const ids = useRequestIds()
  const hrefs = useRunHrefs(batch.id)
  const [short, setShort] = useState<InsufficientCreditsDetails | null>(null)
  const [unlock, setUnlock] = useState(false)
  const n = chosen.length
  const each = ai.prices.videoEach
  const total = totalOf(ai, n)
  const team = credits.data?.unlimited ?? false
  const balance = credits.data ? (credits.data.balance ?? credits.data.credits) : null
  const low = !!short || (total != null && balance != null && !team && balance < total)
  const key = `approve:${chosen.map((p) => p.id).sort().join(",")}:${total ?? 0}`
  const approve = useMutation({
    mutationFn: () => api.iterate.aiPreviews.approve(batch.id, { requestId: ids.of(key), previewIds: chosen.map((p) => p.id), expectedCredits: total ?? 0 }),
    onSuccess: (b) => {
      ids.done(key)
      setShort(null)
      qc.setQueryData(ik.batch(b.id), b)
      void qc.invalidateQueries({ queryKey: tk.credits })
      void qc.invalidateQueries({ queryKey: ["creatives"] })
      onApproved()
      router.replace(hrefs.videos, { scroll: true })
    },
    onError: (e) => {
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: ik.batch(batch.id) })
        void qc.invalidateQueries({ queryKey: tk.credits })
      }
      if (isApiError(e) && e.code === "INSUFFICIENT_CREDITS") {
        setShort((e.details ?? null) as InsufficientCreditsDetails | null)
        return refresh()
      }
      if (isApiError(e) && e.code === "PAYMENT_REQUIRED") return setUnlock(true)
      if (isApiError(e) && e.code === "CREDITS_CHANGED") {
        toast(t("changed", { n: Number((e.details as { credits?: number } | undefined)?.credits ?? 0) }))
        return refresh()
      }
      if (isApiError(e) && e.code === "INVALID_STATE") {
        const d = e.details as { reason?: string; previewIds?: string[] } | undefined
        if (d?.reason === "preview_not_ready") {
          onNotReady(d.previewIds ?? [])
          onOpenChange(false)
          toast(tp("notReady"))
          return refresh()
        }
      }
      toast(errorMessage(e))
    },
  })
  const dash = "—"
  return (
    <>
      <Dialog open={open && n > 0} onOpenChange={(v) => (approve.isPending ? null : onOpenChange(v))}>
        <DialogContent className="no-scrollbar max-h-[calc(100dvh-16px)] w-[min(520px,calc(100%-16px))] gap-4 overflow-y-auto p-4 sm:max-w-none max-tablet:top-auto max-tablet:bottom-2 max-tablet:translate-y-0 tablet:p-5">
          <div className="grid gap-1 pr-11">
            <span className="eyebrow [overflow-wrap:anywhere]">{t("eyebrow", { format: tpl.name, ad: batch.source.name })}</span>
            <DialogTitle className="m-0 text-[22px]">{t("title", { n })}</DialogTitle>
            <DialogDescription className="sr-only">{t("note")}</DialogDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {chosen.map((p) => (
              <div key={p.id} className="grid w-[54px] justify-items-center gap-1 font-mono text-[11px]">
                <PreviewImage preview={p} format={ai.format} compact className="rounded-[6px]" />
                {p.letter}
              </div>
            ))}
          </div>
          <div className="on-ink grid gap-2.5 rounded-xl bg-ink p-4 text-[13px] text-ink-fg-2">
            <div className="flex justify-between gap-3">
              <span>{t("line", { n })}</span>
              <b className="text-ink-fg tabular-nums">{t("lineValue", { each: each == null ? dash : each, n })}</b>
            </div>
            <div className="flex justify-between gap-3">
              <span>{t("previews")}</span>
              <b className="text-ink-fg">{t("free")}</b>
            </div>
            <hr className="m-0 border-0 border-t border-ink-line" />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="flex flex-wrap items-center gap-1.5">
                {t("total")} {total == null ? <Tbd ink /> : null}
              </span>
              <b className="wide text-[22px] font-extrabold whitespace-nowrap text-ink-fg tabular-nums tablet:text-[26px]">{total == null ? tp("creditsDash") : tp("credits", { n: total })}</b>
            </div>
            {team ? (
              <small className="text-xs text-ink-fg-3">{t("teamNote")}</small>
            ) : (
              <>
                <div className="flex justify-between gap-3">
                  <span>{t("balance")}</span>
                  <b className="text-ink-fg tabular-nums">{t("balanceValue", { from: balance ?? "…", to: total == null || balance == null ? dash : balance - total })}</b>
                </div>
                <small className="text-xs text-ink-fg-3">{t("note")}</small>
              </>
            )}
          </div>
          {low ? (
            <div role="alert" className="grid gap-1 rounded-lg border border-status-waiting-edge bg-status-waiting-bg p-3 text-status-waiting">
              <b>{t("lowTitle", { n: short?.balance ?? balance ?? 0 })}</b>
              <p className="m-0 text-[13px] text-fg-2">{t("lowBody")}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3 max-tablet:grid max-tablet:grid-cols-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={approve.isPending}>
              {t("back")}
            </Button>
            {low ? (
              <GetCreditsLink brand />
            ) : (
              <Button variant="brand" onClick={() => approve.mutate()} disabled={approve.isPending} aria-busy={approve.isPending}>
                {approve.isPending ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
                {t("confirm", { n })}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <UnlockDialog open={unlock} onOpenChange={setUnlock} />
    </>
  )
}

// ───────────── 5 · making the videos ─────────────
/**
 * The steps of a video, as chips (Script · Voice · Lip-sync · Captions · Render; no Faces chip: the backend doesn't expose that step,
 * design §2.6). IteratePiece has no per-step stage, so the chips are read from what it does say: the script comes done from the
 * preview, voice + lip-sync while it runs without a render, the edit while it renders.
 */
function stepState(piece: IteratePiece | null, steps: number): { done: number; run: number | null; bad: number | null } {
  if (!piece || piece.status === "planned" || piece.status === "queued") return { done: 1, run: null, bad: null }
  if (piece.status === "ready") return { done: steps, run: null, bad: null }
  const at = piece.render ? (piece.render.progress < 50 ? steps - 2 : steps - 1) : 2
  if (piece.status === "failed") return { done: at, run: null, bad: at }
  return { done: at, run: at, bad: null }
}

function useSteps(format: AiFormat) {
  const t = useTranslations("adTemplates.ai.progress")
  return t(`steps.${format}`).split("|")
}

function ProgressScreen({ batch, tpl, ai }: { batch: IterateBatch; tpl: IterateTemplateRun; ai: AiPreviewsView }) {
  const t = useTranslations("adTemplates.ai.progress")
  const tw = useTranslations("adTemplates.ai.watch")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const credits = useCredits()
  const hrefs = useRunHrefs(batch.id)
  const steps = useSteps(ai.format)
  const list = approvedOf(batch)
  const left = ai.previews.filter((p) => p.status === "ready").length
  const retry = useMutation({
    mutationFn: (pieceId: string) => api.iterate.retryPiece(pieceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ik.batch(batch.id) })
      void qc.invalidateQueries({ queryKey: tk.credits })
    },
    onError: (e) => toast(errorMessage(e)),
  })
  return (
    <IterWrap>
      <AiSteps current={3} hrefs={{ 0: templatesHref() + "?tab=ai", 2: hrefs.previews() }} />
      <ChampionStrip batch={batch} format={tpl.name} />
      <div className="flex max-w-[680px] flex-col gap-1.5">
        <h1>{t("title", { n: list.length })}</h1>
        <p className="m-0 text-fg-2">{t("lede")}</p>
      </div>
      <ul aria-label={t("list")} className="m-0 list-none overflow-hidden rounded-lg border border-line bg-card p-0">
        {list.map(({ preview: p, piece }) => {
          const st = stepState(piece, steps.length)
          const failed = piece?.status === "failed"
          const ready = piece?.status === "ready"
          const pct = ready ? 100 : piece?.render ? Math.round(66 + piece.render.progress * 0.34) : piece?.status === "rendering" ? 45 : 8
          const label = failed ? t("failed") : ready ? t("ready") : !piece || piece.status === "queued" || piece.status === "planned" ? t("queued") : `${steps[st.run ?? 0]} · ${pct}%`
          return (
            <li
              key={p.id}
              aria-busy={!ready && !failed ? true : undefined}
              className={cn(
                "grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-t border-line-soft px-3.5 py-3 first:border-t-0 tablet:grid-cols-[52px_minmax(0,1.2fr)_minmax(0,1fr)_90px] tablet:gap-3.5",
                failed && "bg-status-failed-bg"
              )}
            >
              <PreviewImage preview={p} format={ai.format} compact className="row-span-2 rounded-[6px] tablet:row-span-1" />
              <div className="grid min-w-0 gap-0.5">
                <b className="truncate">
                  {p.letter} · {p.title}
                </b>
                <span className="truncate text-xs text-fg-3">{p.hook}</span>
              </div>
              <div className="col-start-2 grid min-w-0 gap-1.5 tablet:col-start-auto">
                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                  <span className="dot" data-status={failed ? "failed" : ready ? "approved" : "progress"} />
                  <span className="truncate">{failed && piece?.failReason ? `${t("failed")} · ${piece.failReason}` : label}</span>
                </div>
                <Bar value={failed ? 50 : pct} label={label} className={cn("h-1.5", failed && "[&>i]:bg-status-failed", ready && "[&>i]:bg-ok-dot")} />
                <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                  {steps.map((s, k) => (
                    <li
                      key={s}
                      className={cn(
                        "rounded-[4px] border border-line px-1.5 py-px font-mono text-[10.5px] text-fg-3",
                        k < st.done && k !== st.bad && "border-transparent bg-ok-bg text-ok",
                        k === st.run && "border-info-edge bg-info-bg text-info",
                        k === st.bad && "border-status-failed-edge bg-status-failed-bg text-status-failed"
                      )}
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="hidden text-right font-mono text-xs text-fg-3 tablet:block">
                {ready ? (
                  <Link href={hrefs.watch(p.id)} className={buttonVariants({ size: "sm", variant: "outline" })}>
                    {t("watch")}
                  </Link>
                ) : failed ? (
                  "—"
                ) : (
                  t("eta", { m: Math.max(1, Math.round((100 - pct) / 12)) })
                )}
              </div>
              {failed && piece ? (
                <div className="col-span-2 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2 tablet:col-span-3 tablet:col-start-2">
                  {t("failNote")}
                  {piece.retryHint === "retry" ? (
                    <Button size="sm" onClick={() => retry.mutate(piece.id)} disabled={retry.isPending} aria-busy={retry.isPending && retry.variables === piece.id}>
                      <NavIcon name="refresh" size={14} />
                      {t("tryAgain")}
                    </Button>
                  ) : null}
                </div>
              ) : ready ? (
                <Link href={hrefs.watch(p.id)} className={buttonVariants({ size: "sm", variant: "outline", className: "col-start-2 justify-self-start tablet:hidden" })}>
                  {t("watch")}
                </Link>
              ) : null}
            </li>
          )
        })}
      </ul>
      {left ? (
        <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-fg-2">
          <span className="dot" />
          <span className="min-w-0 flex-1">{t("left", { n: left })}</span>
          <Link href={hrefs.previews(ai.previews.filter((p) => p.status === "ready").map((p) => p.id))} className={buttonVariants({ size: "sm" })}>
            {tw("makeToo")}
          </Link>
        </div>
      ) : null}
      <IterActionBar hint={credits.data?.unlimited ? t("hintTeam") : t("hint")}>
        <Link href={templatesHref() + "?tab=ai"} className={buttonVariants()}>
          {t("back")}
        </Link>
      </IterActionBar>
    </IterWrap>
  )
}

// ───────────── 6 · watch & download ─────────────
function WatchScreen({ batch, tpl, ai }: { batch: IterateBatch; tpl: IterateTemplateRun; ai: AiPreviewsView }) {
  const t = useTranslations("adTemplates.ai.watch")
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const hrefs = useRunHrefs(batch.id)
  const list = approvedOf(batch)
  const wanted = sp.get("v")
  const cur = list.find((x) => x.preview.id === wanted) ?? list.find((x) => x.piece?.status === "ready") ?? list[0]
  const others = ai.previews.filter((p) => p.status === "ready")
  const file = cur.piece?.files.find((f) => f.format === "9x16") ?? null
  const ready = cur.piece?.status === "ready" && !!file
  const pct = cur.piece?.render?.progress ?? 0
  const pick = (id: string) => router.replace(`${pathname}?view=watch&v=${encodeURIComponent(id)}`, { scroll: false })
  const tabState = (piece: IteratePiece | null) =>
    piece?.status === "ready"
      ? t("ready", { d: mmss(piece.files[0]?.durationSec ?? 0) })
      : piece?.status === "failed"
        ? t("failed")
        : piece?.render
          ? t("rendering", { p: piece.render.progress })
          : t("waiting")
  return (
    <IterWrap>
      <AiSteps current={3} hrefs={{ 0: templatesHref() + "?tab=ai", 2: hrefs.previews() }} />
      <ChampionStrip batch={batch} format={tpl.name} />
      <div role="tablist" aria-label={t("tabs")} className="flex flex-wrap gap-2">
        {list.map(({ preview: p, piece }) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === cur.preview.id}
            onClick={() => pick(p.id)}
            className="grid max-w-[260px] min-w-0 cursor-pointer grid-cols-[34px_minmax(0,1fr)] items-center gap-2 rounded-md border border-line bg-card py-1.5 pr-2.5 pl-1.5 text-left aria-selected:border-fg aria-selected:shadow-[inset_0_0_0_1px_var(--fg)] max-tablet:max-w-full max-tablet:flex-[1_1_100%]"
          >
            <PreviewImage preview={p} format={ai.format} compact className="rounded-[5px]" />
            <span className="grid min-w-0 text-xs text-fg-3">
              <b className="truncate text-[13px] text-fg">
                {p.letter} · {p.title}
              </b>
              {tabState(piece)}
            </span>
          </button>
        ))}
      </div>
      <div className="grid items-start gap-[18px] desktop:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-h-0 place-items-center rounded-xl bg-ink p-3 tablet:min-h-[560px] tablet:p-[18px]">
          {ready ? (
            <video key={file.url} controls playsInline preload="metadata" src={file.url} poster={cur.piece?.poster?.url} className="aspect-[9/16] w-[min(360px,100%)] rounded-xl bg-ink" />
          ) : (
            <div className="beam relative grid w-[min(300px,100%)] gap-2.5 rounded-xl">
              <PreviewImage preview={cur.preview} format={ai.format} gen />
              <span className="text-center font-mono text-xs text-ink-fg-2">{cur.piece?.status === "failed" ? t("failed") : t("renderingLong", { p: pct })}</span>
            </div>
          )}
        </div>
        <div className="grid gap-3.5">
          <div className="grid gap-3 rounded-lg border border-line bg-card p-4">
            <span className="eyebrow">
              {cur.preview.letter} · {tpl.name}
            </span>
            <h2 className="m-0 text-lg">{cur.preview.title}</h2>
            {cur.preview.hook ? <q className="border-l-2 border-brand-edge pl-2 text-fg not-italic">{cur.preview.hook}</q> : null}
            <dl className="m-0 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-fg-3">{t("from")}</dt>
              <dd className="m-0 [overflow-wrap:anywhere]">{batch.source.name}</dd>
              {file ? (
                <>
                  <dt className="text-fg-3">{t("file")}</dt>
                  <dd className="m-0 font-mono text-xs [overflow-wrap:anywhere]">{file.name}</dd>
                  <dt className="text-fg-3">{t("format")}</dt>
                  <dd className="m-0">9:16{file.durationSec ? ` · ${mmss(file.durationSec)}` : ""}</dd>
                </>
              ) : null}
            </dl>
            <div className="grid gap-2">
              {ready ? (
                <a href={file.url} download={file.name} className={buttonVariants({ variant: "brand" })}>
                  <NavIcon name="dl" size={16} />
                  {t("download")}
                </a>
              ) : (
                <Button variant="brand" disabled>
                  <NavIcon name="dl" size={16} />
                  {t("download")}
                </Button>
              )}
              <Link href="/library" className={buttonVariants({ variant: "outline" })}>
                {t("library")}
              </Link>
            </div>
            <p className="m-0 text-xs text-fg-3">{t("review")}</p>
          </div>
          {others.length ? (
            <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-3.5 py-3 text-[13px] text-fg-2">
              <div className="flex gap-1.5">
                {others.map((p) => (
                  <PreviewImage key={p.id} preview={p} format={ai.format} compact className="w-[30px] rounded-[4px]" />
                ))}
              </div>
              <span className="min-w-[160px] flex-1">{t("leftover", { n: others.length })}</span>
              <Link href={hrefs.previews(others.map((p) => p.id))} className={buttonVariants({ size: "sm" })}>
                {t("makeToo")}
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </IterWrap>
  )
}

// ───────────── plan failed ─────────────
function PlanFailed({ batch, tpl, ai }: { batch: IterateBatch; tpl: IterateTemplateRun; ai: AiPreviewsView }) {
  const t = useTranslations("adTemplates.ai.previews")
  const failText = useFailText()
  return (
    <IterWrap>
      <AiSteps current={2} hrefs={{ 0: templatesHref() + "?tab=ai", 1: templateAdHref(tpl.slug) }} />
      <ChampionStrip batch={batch} format={tpl.name} />
      <Alert variant="destructive">
        <NavIcon name="alert" size={20} />
        <AlertBody>
          <AlertTitle>{t("planFailedTitle")}</AlertTitle>
          <AlertDescription>
            {failText.batch(ai)} {t("planFailedBody")}
          </AlertDescription>
        </AlertBody>
        <AlertActions>
          <Link href={templateAdHref(tpl.slug)} className={buttonVariants({ size: "sm" })}>
            {t("otherWinner")}
          </Link>
          <Link href={templatesHref() + "?tab=ai"} className={buttonVariants({ size: "sm", variant: "ghost" })}>
            {t("backTemplates")}
          </Link>
        </AlertActions>
      </Alert>
    </IterWrap>
  )
}
