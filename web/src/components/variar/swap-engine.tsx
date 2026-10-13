"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { BatchSettings, SwapEngine, SwapQuote, SwapVoiceSource, VariationBatch } from "@/lib/api/types"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { Panel, PanelHead, Tag } from "@/components/page"
import { Memo, RadioDot, useMoney } from "@/components/wizard/common"
import { useErrorMessage } from "@/hooks/use-error-message"
import { vk } from "@/hooks/use-variar"
import { cn } from "@/lib/utils"
import { BlockerList } from "./keep-edit"

const ENGINES: SwapEngine[] = ["LIPSYNC", "KLING", "SEEDANCE"]
const VOICES: SwapVoiceSource[] = ["CHAMPION_AUDIO", "ENGINE_VOICE"]

/** Why a combination can't be picked (§13.15.1), in words; null = it can. */
function useWhyNot(batch: VariationBatch) {
  const t = useTranslations("variar.swap.why")
  return (q: SwapQuote | undefined, engine: SwapEngine, voice: SwapVoiceSource): string | null => {
    if (engine === "LIPSYNC" && voice === "ENGINE_VOICE") return t("lipsyncOnly")
    if (engine !== "LIPSYNC" && !batch.settings.keepEdit) return t("needsKeep")
    if (!q) return t("unavailable")
    // Gusta 08/10: Kling's voice changes between stretches, so its engine voice stays off with that reason
    if (q.notEnabled) return engine === "KLING" ? t("klingVoice") : t("notEnabled")
    if (q.blockers.length) return t("blocked")
    return q.available ? null : t("unavailable")
  }
}

function EngineCard({
  engine, on, disabled, onSelect, quotes, voice, why, n,
}: {
  engine: SwapEngine; on: boolean; disabled: boolean; onSelect: () => void; quotes: SwapQuote[]; voice: SwapVoiceSource
  why: (q: SwapQuote | undefined, e: SwapEngine, v: SwapVoiceSource) => string | null; n: number
}) {
  const t = useTranslations("variar.swap")
  const money = useMoney()
  const q = (v: SwapVoiceSource) => quotes.find((x) => x.engine === engine && x.voiceSource === v)
  const base = q("CHAMPION_AUDIO")
  const res = base?.resolution
  const cardWhy = why(base, engine, "CHAMPION_AUDIO")
  return (
    <div
      role="radio"
      aria-checked={on}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 rounded-lg border bg-surface p-4 text-left",
        disabled ? "cursor-not-allowed border-line opacity-60" : "cursor-pointer hover:border-line-2",
        on ? "border-fg hover:border-fg" : "border-line"
      )}
    >
      <div className="flex items-start gap-2.5">
        <RadioDot on={on} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <b className="font-semibold">{t(`engine.${engine}`)}</b>
            {engine === "LIPSYNC" ? <Tag>{t("default")}</Tag> : null}
          </div>
          <span className="row-sub">{t(`engineSub.${engine}`, { res: res ?? "" })}</span>
        </div>
      </div>
      <p className="text-[13px] text-fg-2">{t(`trade.${engine}`)}</p>
      <ul className="m-0 grid list-none gap-0 border-t border-line p-0 pt-1 text-[13px]" aria-label={t("pricesFor", { engine: t(`engine.${engine}`) })}>
        {VOICES.map((v) => {
          const qq = q(v)
          const no = why(qq, engine, v)
          const current = on && voice === v
          return (
            <li key={v} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5", current ? "text-fg" : "text-fg-2")}>
              <span className="flex min-w-0 items-center gap-1.5">
                {current ? <Icon name="check" className="size-3.5 flex-none" /> : <span className="inline-block w-3.5 flex-none" aria-hidden="true" />}
                <span className="truncate">{t(v === "CHAMPION_AUDIO" ? "original" : "engineVoice")}</span>
              </span>
              {qq && !(engine === "LIPSYNC" && v === "ENGINE_VOICE") ? (
                <span className={cn("text-right font-mono tabular-nums", no && "text-fg-3 line-through decoration-fg-3/60")}>{money(qq.perItemUsd)}</span>
              ) : (
                <span className="text-right font-mono text-fg-3">—</span>
              )}
              {v === "ENGINE_VOICE" && qq?.notEnabled && engine === "SEEDANCE" ? (
                <span className="col-span-full pl-5">
                  <Tag tone="amber">{t("soon")}</Tag>
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 font-mono text-[13px] [&_span]:text-fg-3">
        <div>
          <span>{t("time")} </span>
          {base ? t("minutes", { n: Math.max(1, Math.round(base.etaSec / 60)) }) : "…"}
        </div>
        {n > 1 && base ? (
          <div>
            <span>{t("batchOf", { n })} </span>
            {money(q(on ? voice : "CHAMPION_AUDIO")?.costUsd ?? base.costUsd)}
          </div>
        ) : null}
      </div>
      {cardWhy ? <p className="flex gap-1.5 text-[13px] text-status-waiting"><Icon name="lock" className="mt-0.5 flex-none" />{cardWhy}</p> : null}
      {base?.blockers.length && engine !== "LIPSYNC" ? <BlockerList hits={base.blockers} /> : null}
    </div>
  )
}

/**
 * §13.15 (F6): the Trocar avatar engine, priced side by side from `BatchEstimate.swapQuotes` (no extra estimate calls).
 * Engine = cards; audio = toggle (only when keeping the edit). Invalid combinations stay visible, disabled, with the reason.
 */
export function SwapEnginePanel({ batch, quotes, locked }: { batch: VariationBatch; quotes: SwapQuote[]; locked: boolean }) {
  const t = useTranslations("variar.swap")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const why = useWhyNot(batch)
  const s = batch.settings
  const engine = s.swapEngine ?? "LIPSYNC"
  const voice: SwapVoiceSource = s.voiceSource === "ENGINE_VOICE" ? "ENGINE_VOICE" : "CHAMPION_AUDIO"
  const n = batch.items.filter((i) => i.kind === "SWAP_AVATAR" && i.included && i.status === "READY").length
  const save = useMutation({
    mutationFn: (b: Partial<BatchSettings>) => api.batches.updateSettings(batch.id, b),
    onSuccess: (b) => {
      qc.setQueryData(vk.batch(b.id), b)
      qc.invalidateQueries({ queryKey: vk.estimate(b.id) })
    },
    onError: (e) => {
      toast(errorMessage(e))
      qc.invalidateQueries({ queryKey: vk.batch(batch.id) })
    },
  })
  const pending = locked || save.isPending
  const q = (e: SwapEngine, v: SwapVoiceSource) => quotes.find((x) => x.engine === e && x.voiceSource === v)
  const pickEngine = (e: SwapEngine) => {
    if (e === engine) return
    // keep the audio when the new engine takes it; else fall back to the winner's audio (Lipsync never speaks on its own)
    const keepVoice = s.voiceSource === "ENGINE_VOICE" ? (why(q(e, "ENGINE_VOICE"), e, "ENGINE_VOICE") ? "CHAMPION_AUDIO" : "ENGINE_VOICE") : s.voiceSource
    save.mutate(keepVoice === s.voiceSource ? { swapEngine: e } : { swapEngine: e, voiceSource: keepVoice })
  }
  const voiceWhy = why(q(engine, "ENGINE_VOICE"), engine, "ENGINE_VOICE")
  const engineVoiceQuote = q(engine, "ENGINE_VOICE")
  const picked = q(engine, voice)
  const engineName = t(`engine.${engine}`)

  return (
    <Panel>
      <PanelHead>
        <h2>{t("title")}</h2>
        <span className="font-mono text-xs text-fg-3">{t("perVariation")}</span>
      </PanelHead>
      <p className="-mt-1.5 text-[13px] text-fg-2">{t("sub")}</p>
      <div role="radiogroup" aria-label={t("title")} className="grid grid-cols-[minmax(0,1fr)] gap-3 desktop:grid-cols-3">
        {ENGINES.map((e) => {
          const noCombo = !!why(q(e, "CHAMPION_AUDIO"), e, "CHAMPION_AUDIO") && !!why(q(e, "ENGINE_VOICE"), e, "ENGINE_VOICE")
          return (
            <EngineCard
              key={e}
              engine={e}
              on={engine === e}
              disabled={pending || (noCombo && engine !== e)}
              onSelect={() => pickEngine(e)}
              quotes={quotes}
              voice={voice}
              why={why}
              n={n}
            />
          )
        })}
      </div>
      {s.keepEdit ? (
        <div className="grid gap-1.5">
          <span className="text-xs text-fg-3">{t("audio")}</span>
          <ToggleGroup
            type="single"
            value={voice}
            disabled={pending}
            onValueChange={(v) => v && v !== voice && save.mutate({ voiceSource: v as SwapVoiceSource })}
            aria-label={t("audio")}
          >
            <ToggleGroupItem value="CHAMPION_AUDIO">{t("original")}</ToggleGroupItem>
            <ToggleGroupItem value="ENGINE_VOICE" disabled={!!voiceWhy} aria-describedby={voiceWhy ? "engine-voice-why" : undefined}>
              {t("engineVoice")}
              {engineVoiceQuote?.notEnabled && engine === "SEEDANCE" ? <span className="ml-1.5 text-xs text-status-waiting">· {t("soon")}</span> : null}
            </ToggleGroupItem>
          </ToggleGroup>
          {voiceWhy ? (
            <div id="engine-voice-why" className="grid gap-1">
              <p className="flex gap-1.5 text-[13px] text-fg-2">
                <Icon name="info" className="mt-0.5 flex-none" />
                {voiceWhy}
              </p>
              {engine !== "LIPSYNC" && engineVoiceQuote?.blockers.length ? <BlockerList hits={engineVoiceQuote.blockers} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <Memo icon="info">{engine === "LIPSYNC" ? t("explain.LIPSYNC") : t(voice === "ENGINE_VOICE" ? "explain.B" : "explain.A", { engine: engineName })}</Memo>
      {picked?.warnings.map((w) => (
        <Memo key={w} icon="alert">
          {t(`warning.${w}`)}
        </Memo>
      ))}
    </Panel>
  )
}
