"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { CreativeDetail, Scene, SceneSwap, Take } from "@/lib/api/types"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { GenCanvas } from "@/components/fx"
import { Icon } from "@/components/icon"
import { Panel, PanelHead } from "@/components/page"
import { StatusChip } from "@/components/status-chip"
import { Thumb } from "@/components/thumb"
import { qk } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { ActionBar, stepHref, useFaceNumber, WizardFrame, WzHead } from "./shell"
import { Banner, Memo, mmss, useMoney } from "./common"
import { SwapSceneRow } from "./swap-scene"

/** What a paid redo is about to do, with the price on screen first: the whole lipsync take (§13.5) or one Kling/Seedance stretch (§13.15). */
type Ask = { kind: "take"; scene: number | null; cost: number } | { kind: "swap"; index: number; cost: number; windows: number; engineVoice: boolean }

/**
 * `slice` (§13.5): the scene is a cut of the continuous lipsync take, so it can't be redone alone; its button opens the
 * "redo the whole clip" confirmation. `source`: the written-hook variation's only scene, the winner's own video (no generation).
 */
function SceneRow({
  sc, engineLabel, onRegenerate, onRedoTake, busy, slice, source, price,
}: { sc: Scene; engineLabel: string; onRegenerate: (prompt?: string) => void; onRedoTake: () => void; busy: boolean; slice: boolean; source: boolean; price: string | null }) {
  const t = useTranslations("wizard.generation")
  const tc = useTranslations("common")
  const [editing, setEditing] = useState<string | null>(null)
  const n = sc.index + 1
  let thumb: React.ReactNode
  let side: React.ReactNode
  if (sc.status === "READY") {
    thumb = <Thumb file={sc.thumbnail} play className="w-14 tablet:w-[72px]" />
    side = (
      <>
        <StatusChip status="approved">{t("ready")}</StatusChip>
        {source ? null : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => (slice ? onRedoTake() : onRegenerate())}>
            <Icon name="refresh" />
            {slice ? t("redoClip") : t("regenerate")}
            {slice && price ? <span className="font-mono text-fg-2">· {price}</span> : null}
          </Button>
        )}
      </>
    )
  } else if (sc.status === "GENERATING") {
    thumb = (
      <div className="relative grid aspect-[9/16] w-14 place-items-center overflow-hidden rounded-sm border border-line bg-surface-2 tablet:w-[72px]">
        <GenCanvas seed={n + 7} width={72} height={128} />
        <span className="on-ink absolute rounded-[4px] bg-black/60 px-[5px] py-px font-mono text-[11px] text-fg">{sc.progress}%</span>
      </div>
    )
    side = (
      <>
        <StatusChip status="progress">{t("generating")}</StatusChip>
        <span className="row-sub font-mono">{slice ? t("slice") : engineLabel}</span>
      </>
    )
  } else if (sc.status === "QUEUED") {
    thumb = (
      <div className="grid aspect-[9/16] w-14 place-items-center rounded-sm border border-line bg-surface-2 tablet:w-[72px]">
        <span className="font-mono text-[11px] text-fg-3">{n}</span>
      </div>
    )
    side = (
      <>
        <StatusChip status="draft">{t("queued")}</StatusChip>
        {slice ? <span className="row-sub">{t("sliceWaits")}</span> : n > 1 ? <span className="row-sub">{t("startsAfter", { n: n - 1 })}</span> : null}
      </>
    )
  } else {
    thumb = (
      <div className="grid aspect-[9/16] w-14 place-items-center rounded-sm border border-status-failed-edge bg-surface-2 text-status-failed tablet:w-[72px]">
        <Icon name="alert" />
      </div>
    )
    // design validation F2 §2: the side actions disappear while the prompt is being edited
    side = (
      <>
        <StatusChip status="failed">{t("failed")}</StatusChip>
        {source ? null : slice ? (
          <Button size="sm" disabled={busy} onClick={onRedoTake}>
            <Icon name="refresh" />
            {t("redoClip")}
            {price ? <span className="font-mono text-fg-2">· {price}</span> : null}
          </Button>
        ) : editing === null ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => onRegenerate()}>
              <Icon name="refresh" />
              {t("regenerateScene")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(sc.visualPrompt)}>
              <Icon name="pencil" />
              {t("editPrompt")}
            </Button>
          </>
        ) : null}
      </>
    )
  }
  return (
    <div
      className={cn(
        "relative grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3.5 rounded-lg border bg-surface p-3 tablet:grid-cols-[72px_minmax(0,1fr)_auto]",
        sc.status === "FAILED" ? "border-status-failed-edge" : "border-line",
        sc.status === "GENERATING" && "beam"
      )}
    >
      {thumb}
      <div className="grid min-w-0 gap-1.5">
        <span className="step-lbl">
          {t("scene", { n })} · {sc.label} · {mmss(sc.startSec)}–{mmss(sc.endSec)}
        </span>
        <span>“{sc.speech}”</span>
        {sc.status === "FAILED" && sc.failReason ? <span className="text-[13px] text-status-failed">{sc.failReason}</span> : null}
        {editing !== null ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`prompt-${sc.index}`}>{t("promptLabel", { n })}</Label>
            <Textarea
              id={`prompt-${sc.index}`}
              rows={2}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="default" disabled={busy || !editing.trim()} onClick={() => onRegenerate(editing)}>
                <Icon name="refresh" />
                {t("regenerateWithPrompt")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                {tc("cancel")}
              </Button>
            </div>
          </div>
        ) : slice && sc.take ? (
          <span className="font-mono text-xs leading-normal text-fg-3">
            {t("slice")} · {mmss(sc.take.startSec)}–{mmss(sc.take.endSec)}
          </span>
        ) : sc.pipeline === "SOURCE_CUT" ? (
          <span className="font-mono text-xs leading-normal text-fg-3">{t("source")}</span>
        ) : (
          <span className="font-mono text-xs leading-normal text-fg-3">{sc.visualPrompt}</span>
        )}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 tablet:col-span-1 tablet:grid tablet:justify-items-end">{side}</div>
    </div>
  )
}

/** §13.5: the one lipsync clip every scene is cut from. Same honest wait as a scene: real status, %, and the cost of redoing it. */
function TakeRow({ take, onRedo, busy }: { take: Take; onRedo: () => void; busy: boolean }) {
  const t = useTranslations("wizard.generation")
  const money = useMoney()
  const done = take.status === "READY" || take.status === "FAILED"
  return (
    <div
      className={cn(
        "relative grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3.5 rounded-lg border bg-surface p-3 tablet:grid-cols-[72px_minmax(0,1fr)_auto]",
        take.status === "FAILED" ? "border-status-failed-edge" : "border-line-2",
        take.status === "GENERATING" && "beam"
      )}
    >
      {take.status === "READY" ? (
        <Thumb file={take.thumbnail} play className="w-14 tablet:w-[72px]" />
      ) : take.status === "FAILED" ? (
        <div className="grid aspect-[9/16] w-14 place-items-center rounded-sm border border-status-failed-edge bg-surface-2 text-status-failed tablet:w-[72px]">
          <Icon name="alert" />
        </div>
      ) : (
        <div className="relative grid aspect-[9/16] w-14 place-items-center overflow-hidden rounded-sm border border-line bg-surface-2 tablet:w-[72px]">
          {take.status === "GENERATING" ? <GenCanvas seed={take.attempt + 3} width={72} height={128} /> : null}
          <span className="on-ink absolute rounded-[4px] bg-black/60 px-[5px] py-px font-mono text-[11px] text-fg">{take.progress}%</span>
        </div>
      )}
      <div className="grid min-w-0 gap-1.5">
        <span className="step-lbl">{t("take")}</span>
        <span>{t("takeSub", { kind: t(`takeKind.${take.kind}`), s: Math.round(take.durationSec ?? 0), n: take.attempt })}</span>
        {take.status === "FAILED" ? <span className="text-[13px] text-status-failed">{take.failReason ?? t("takeFailed")}</span> : null}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 tablet:col-span-1 tablet:grid tablet:justify-items-end">
        <StatusChip status={take.status === "READY" ? "approved" : take.status === "FAILED" ? "failed" : take.status === "GENERATING" ? "progress" : "draft"}>
          {t(take.status === "READY" ? "ready" : take.status === "FAILED" ? "failed" : take.status === "GENERATING" ? "generating" : "queued")}
        </StatusChip>
        {done ? (
          <Button size="sm" variant={take.status === "FAILED" ? "outline" : "ghost"} disabled={busy} onClick={onRedo}>
            <Icon name="refresh" />
            {t("redoClip")}
            <span className="font-mono text-fg-2">· {money(take.regenerateEstimateUsd)}</span>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Step 5 · Generation (spec §5.5): real title + ETA + bar, "you can leave", per-scene status and regenerate. */
export function GenerationStep({ creative, live }: { creative: CreativeDetail; live: "connecting" | "open" | "retrying" }) {
  const t = useTranslations("wizard")
  const tSteps = useTranslations("steps")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const qc = useQueryClient()
  const id = creative.id
  const faceN = useFaceNumber(creative)
  const q = useQuery({ queryKey: qk.scenes(id), queryFn: () => api.scenes.list(id) })
  const regen = useMutation({
    mutationFn: ({ sc, prompt }: { sc: Scene; prompt?: string }) => api.scenes.regenerate(id, sc.index, prompt !== undefined ? { visualPrompt: prompt } : {}),
    onSuccess: (sc) => {
      qc.setQueryData(qk.scenes(id), (p: typeof q.data) => (p ? { ...p, scenes: p.scenes.map((x) => (x.id === sc.id ? sc : x)) } : p))
      qc.invalidateQueries({ queryKey: qk.creative(id) })
      toast(
        <>
          <Icon name="refresh" />
          {t("generation.regenerating", { n: sc.index + 1 })}
        </>
      )
    },
    onError: (e, v) => {
      // a slice the screen didn't know about: the API asks to redo the whole take, with its price
      if (isApiError(e) && e.code === "INVALID_STATE" && (e.details as { reason?: string })?.reason === "regenerate_take") {
        return setAsk({ kind: "take", scene: v.sc.index + 1, cost: Number((e.details as { estimateUsd?: number }).estimateUsd ?? creative.take?.regenerateEstimateUsd ?? 0) })
      }
      // §13.15: a stretch the screen didn't know about; ask with the API's price
      if (isApiError(e) && e.code === "INVALID_STATE" && (e.details as { reason?: string })?.reason === "regenerate_swap_scene") {
        const cost = Number((e.details as { estimateUsd?: number }).estimateUsd ?? v.sc.swap?.regenerateEstimateUsd ?? 0)
        return setAsk({ kind: "swap", index: v.sc.index, cost, windows: v.sc.swap?.windows.length ?? 1, engineVoice: v.sc.swap?.voiceSource === "ENGINE_VOICE" })
      }
      toast(errorMessage(e))
    },
  })

  // §13.5: redoing a lipsync scene = redoing the whole take, only after the price is on screen
  const take = creative.take
  const money = useMoney()
  const [ask, setAsk] = useState<Ask | null>(null)
  const redo = useMutation({
    mutationFn: async (a: Ask) => {
      if (a.kind === "swap") await api.scenes.regenerate(id, a.index, { confirm: true, expectedCostUsd: a.cost })
      else if (a.scene !== null) await api.scenes.regenerate(id, a.scene - 1, { confirm: true, expectedCostUsd: a.cost })
      else await api.scenes.regenerateTake(id, { expectedCostUsd: a.cost })
    },
    onSuccess: (_r, a) => {
      qc.invalidateQueries({ queryKey: qk.scenes(id) })
      qc.invalidateQueries({ queryKey: qk.creative(id) })
      toast(
        <>
          <Icon name="refresh" />
          {a.kind === "swap" ? t("generation.redoingStretch", { n: a.index + 1 }) : t("generation.redoing")}
        </>
      )
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "ESTIMATE_CHANGED") {
        qc.invalidateQueries({ queryKey: qk.creative(id) })
        qc.invalidateQueries({ queryKey: qk.scenes(id) })
      }
      toast(errorMessage(e))
    },
  })
  const askRedo = (scene: number | null) => take && setAsk({ kind: "take", scene, cost: take.regenerateEstimateUsd })
  const askStretch = (sc: Scene & { swap: SceneSwap }) =>
    setAsk({ kind: "swap", index: sc.index, cost: sc.swap.regenerateEstimateUsd, windows: sc.swap.windows.length, engineVoice: sc.swap.voiceSource === "ENGINE_VOICE" })

  const scenes = q.data?.scenes ?? []
  // §13.11: the scene's pipeline says what "redo" means (TAKE_SLICE = the whole take, SOURCE_CUT/REUSE = nothing to redo)
  const source = scenes.length > 0 && scenes.every((x) => x.pipeline === "SOURCE_CUT")
  const swap = scenes.length > 0 && scenes.every((x) => x.pipeline === "SWAP_VIDEO")
  const s = q.data?.summary
  const total = s?.total ?? 0
  const pending = scenes.some((x) => x.status === "QUEUED" || x.status === "GENERATING")
  const allReady = !!total && s!.ready === total
  const failed = scenes.filter((x) => x.status === "FAILED")
  const engineLabel = creative.summary.engineLabel ?? "—"

  const sx = swap ? "Swap" : ""
  const title = !s ? "…" : allReady ? t(`generation.readyTitle${sx}`, { total }) : pending ? t(`generation.generatingTitle${sx}`, { ready: s.ready, total }) : t(`generation.failedTitle${sx}`, { ready: s.ready, total, failed: s.failed })
  const eta = !s
    ? ""
    : allReady
      ? creative.state === "RENDERING" ? t("generation.putting") : ""
      : pending
        ? s.etaSec !== null && s.etaSec >= 60 ? t("generation.eta", { min: Math.round(s.etaSec / 60) }) : t("generation.etaSoon")
        : take && failed.length ? t("generation.takeFailed")
          : swap && failed[0] ? t("generation.fixStretch", { n: failed[0].index + 1 })
          : failed[0] ? t("generation.fixToContinue", { n: failed[0].index + 1 }) : ""

  return (
    <WizardFrame
      creative={creative}
      viewing="generation"
      live={live}
      actionbar={
        <ActionBar
          hint={allReady ? null : t("generation.hint")}
          back={{ href: stepHref(id, "engine") }}
          primary={
            <Button data-primary variant="default" disabled={!allReady} onClick={() => router.push(stepHref(id, "edit"))}>
              {t("continueTo", { step: tSteps("edit") })}
            </Button>
          }
        />
      }
    >
      <WzHead
        title={t("generation.title")}
        sub={
          source
            ? t("generation.subSource")
            : swap
            ? t("generation.subSwap", { engine: engineLabel, face: faceN ?? "—", count: total })
            : t(take ? "generation.subTake" : "generation.sub", { engine: engineLabel, letter: creative.summary.scriptLetter ?? "", face: faceN ?? "—", count: total })
        }
        aside={
          <Link href="/" className={buttonVariants()}>
            <Icon name="left" />
            {t("backHome")}
          </Link>
        }
      />
      {q.isError ? <Banner kind="error" title={errorMessage(q.error)} actions={<Button size="sm" onClick={() => q.refetch()}>{tc("retry")}</Button>} /> : null}
      {q.isPending ? (
        <div className="grid gap-2.5">
          <span className="sk h-24 rounded-lg" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="sk h-[120px] rounded-lg" />
          ))}
        </div>
      ) : !total ? (
        <Memo icon="info">{t("generation.empty")}</Memo>
      ) : (
        <>
          <Panel>
            <div className="grid gap-2">
              <PanelHead>
                <b className="font-semibold">{title}</b>
                <span className="row-sub font-mono">{eta}</span>
              </PanelHead>
              <Progress value={allReady ? 100 : (s?.progress ?? 0)} aria-label={title} />
            </div>
            {!allReady ? (
              <Memo icon="info">{t.rich("generation.leave", { b: (c) => <b>{c}</b> })}</Memo>
            ) : null}
          </Panel>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
            {take ? <TakeRow take={take} busy={redo.isPending} onRedo={() => askRedo(null)} /> : null}
            {scenes.map((sc) =>
              sc.pipeline === "SWAP_VIDEO" && sc.swap ? (
                <SwapSceneRow
                  key={sc.id}
                  sc={sc as Scene & { swap: SceneSwap }}
                  engineLabel={engineLabel}
                  busy={regen.isPending || redo.isPending}
                  onRedo={() => askStretch(sc as Scene & { swap: SceneSwap })}
                />
              ) : (
              <SceneRow
                key={sc.id}
                sc={sc}
                engineLabel={engineLabel}
                busy={regen.isPending || redo.isPending}
                slice={sc.pipeline === "TAKE_SLICE"}
                source={sc.pipeline === "SOURCE_CUT" || sc.pipeline === "REUSE"}
                price={take ? money(take.regenerateEstimateUsd) : null}
                onRegenerate={(prompt) => regen.mutate({ sc, prompt })}
                onRedoTake={() => askRedo(sc.index + 1)}
              />
              )
            )}
          </div>
        </>
      )}
      <AlertDialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask?.kind === "swap" ? t("generation.confirmSwapTitle", { n: ask.index + 1 }) : t("generation.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {ask?.kind === "swap"
                ? t(ask.engineVoice ? "generation.confirmSwapVoice" : "generation.confirmSwap", { n: ask.index + 1, w: ask.windows })
                : ask?.scene
                  ? t("generation.confirmScene", { scene: ask.scene, n: total })
                  : t("generation.confirmTake", { n: total })}{" "}
              {ask?.kind === "swap" ? t("generation.confirmSwapCost", { cost: money(ask.cost) }) : t("generation.confirmCost", { cost: money(ask?.cost ?? 0) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAsk(null)}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (ask) redo.mutate(ask)
                setAsk(null)
              }}
            >
              {t("generation.confirmOk", { cost: money(ask?.cost ?? 0) })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WizardFrame>
  )
}
