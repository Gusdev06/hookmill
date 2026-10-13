"use client"

import { useFormatter, useTranslations } from "next-intl"
import type { Scene, SceneSwap } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { GenCanvas } from "@/components/fx"
import { Icon } from "@/components/icon"
import { StatusChip } from "@/components/status-chip"
import { Thumb } from "@/components/thumb"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { mmss, useMoney } from "./common"

/** §13.15.6: the 3 new scene errors get our own words; the rest keep the API's failReason. */
const SWAP_CODES = new Set(["VOICE_FIT_OUT_OF_RANGE", "SPEECH_MISMATCH", "IDENTITY_DRIFT"])

/** The real step of the chain (§13.15.3): "Window 2 of 3", "Lipsync on the original audio", "Checking it's the same face". */
function useStageLine() {
  const t = useTranslations("wizard.generation.swapStage")
  return (sw: SceneSwap) => {
    if (sw.stage === "windows") {
      const n = sw.windows.length
      const k = sw.windows.findIndex((w) => w.status !== "READY")
      return t("windows", { k: (k < 0 ? n - 1 : k) + 1, n })
    }
    return t(sw.stage)
  }
}

/** One dot per engine window: done, generating, waiting, failed. */
function WindowDots({ sw }: { sw: SceneSwap }) {
  const t = useTranslations("wizard.generation")
  return (
    <span className="flex items-center gap-1" role="img" aria-label={t("windowsDone", { done: sw.windows.filter((w) => w.status === "READY").length, n: sw.windows.length })}>
      {sw.windows.map((w) => (
        <i
          key={w.index}
          className={cn(
            "block h-1.5 w-4 rounded-full",
            w.status === "READY" ? "bg-fg" : w.status === "GENERATING" ? "animate-pulse bg-status-progress" : w.status === "FAILED" ? "bg-status-failed" : "bg-line-2"
          )}
        />
      ))}
    </span>
  )
}

/**
 * §13.15 (F6): a stretch of the winner where the face is swapped on Kling/Seedance (pipeline SWAP_VIDEO).
 * Honest wait: the real step and window k/n; when ready, the voice fit and the face check; "Redo stretch (US$ x)" only after a confirmation.
 */
export function SwapSceneRow({ sc, engineLabel, onRedo, busy }: { sc: Scene & { swap: SceneSwap }; engineLabel: string; onRedo: () => void; busy: boolean }) {
  const t = useTranslations("wizard.generation")
  const format = useFormatter()
  const money = useMoney()
  const errorMessage = useErrorMessage()
  const stage = useStageLine()
  const sw = sc.swap
  const n = sc.index + 1
  const ratio = (r: number) => format.number(r, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const failText = sc.errorCode && SWAP_CODES.has(sc.errorCode) ? errorMessage(sc.errorCode) : (sc.failReason ?? errorMessage(sc.errorCode))
  const failed = sc.status === "FAILED"
  const done = sc.status === "READY" || failed
  const meta = [engineLabel, sw.windows[0]?.resolution, t("windowsCount", { n: sw.windows.length }), t(sw.voiceSource === "ENGINE_VOICE" ? "voiceEngine" : "voiceOriginal")].filter(Boolean).join(" · ")

  return (
    <div
      className={cn(
        "relative grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3.5 rounded-lg border bg-surface p-3 tablet:grid-cols-[72px_minmax(0,1fr)_auto]",
        failed ? "border-status-failed-edge" : "border-line",
        sc.status === "GENERATING" && "beam"
      )}
    >
      {sc.status === "READY" ? (
        <Thumb file={sc.thumbnail} play className="w-14 tablet:w-[72px]" />
      ) : failed ? (
        <div className="grid aspect-[9/16] w-14 place-items-center rounded-sm border border-status-failed-edge bg-surface-2 text-status-failed tablet:w-[72px]">
          <Icon name="alert" />
        </div>
      ) : (
        <div className="relative grid aspect-[9/16] w-14 place-items-center overflow-hidden rounded-sm border border-line bg-surface-2 tablet:w-[72px]">
          {sc.status === "GENERATING" ? <GenCanvas seed={n + 11} width={72} height={128} /> : null}
          <span className="on-ink absolute rounded-[4px] bg-black/60 px-[5px] py-px font-mono text-[11px] text-fg">{sc.status === "GENERATING" ? `${sc.progress}%` : n}</span>
        </div>
      )}
      <div className="grid min-w-0 gap-1.5">
        <span className="step-lbl">
          {t("stretch", { n })} · {mmss(sc.startSec)}–{mmss(sc.endSec)}
          {sc.attempt > 1 ? ` · ${t("attempt", { n: sc.attempt })}` : ""}
        </span>
        <span>“{sc.speech}”</span>
        <span className="font-mono text-xs leading-normal text-fg-3">{meta}</span>
        {sc.status === "GENERATING" || sc.status === "QUEUED" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-2">
            <WindowDots sw={sw} />
            <span>{sc.status === "QUEUED" ? t("swapQueued") : stage(sw)}</span>
          </div>
        ) : null}
        {sc.status === "READY" ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-2">
            {sw.fit ? (
              <span className="flex items-center gap-1.5">
                <Icon name="check" className="size-3.5" />
                {t(sw.fit.mode === "EXACT" ? "fitExact" : "fitStretch", { ratio: ratio(sw.fit.ratio) })}
              </span>
            ) : null}
            {sw.identityScore !== null ? (
              <span className="flex items-center gap-1.5">
                <Icon name="check" className="size-3.5" />
                {t("identityOk", { score: ratio(sw.identityScore) })}
              </span>
            ) : null}
          </div>
        ) : null}
        {failed ? (
          <div className="grid gap-1">
            <span className="text-[13px] text-status-failed">{failText}</span>
            {sw.stage !== "windows" ? <span className="text-xs text-fg-3">{t("failedAt", { stage: stage(sw) })}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 tablet:col-span-1 tablet:grid tablet:justify-items-end">
        <StatusChip status={sc.status === "READY" ? "approved" : failed ? "failed" : sc.status === "GENERATING" ? "progress" : "draft"}>
          {t(sc.status === "READY" ? "ready" : failed ? "failed" : sc.status === "GENERATING" ? "generating" : "queued")}
        </StatusChip>
        {done ? (
          <Button size="sm" variant={failed ? "outline" : "ghost"} disabled={busy} onClick={onRedo}>
            <Icon name="refresh" />
            {t("redoStretch")}
            <span className="font-mono text-fg-2">· {money(sw.regenerateEstimateUsd)}</span>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
