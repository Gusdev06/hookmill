"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { CreativeDetail, Engine, Estimate, VideoFormat } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { Panel } from "@/components/page"
import { qk } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { ActionBar, stepHref, useFaceNumber, WizardFrame, WzHead } from "./shell"
import { Banner, RadioDot, useConfirmReset, useMoney } from "./common"

const FORMATS: VideoFormat[] = ["VERTICAL_9_16", "PORTRAIT_4_5", "SQUARE_1_1"]
const FORMAT_SHORT: Record<VideoFormat, string> = { VERTICAL_9_16: "9:16", PORTRAIT_4_5: "4:5", SQUARE_1_1: "1:1" }

function EngineCard({
  on, onSelect, title, sub, trade, children, est,
}: { on: boolean; onSelect: () => void; title: string; sub: string; trade: string; children?: React.ReactNode; est: React.ReactNode }) {
  return (
    <div
      role="radio"
      aria-checked={on}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn("grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)] content-start gap-3 rounded-lg border bg-surface p-4 text-left hover:border-line-2", on ? "border-fg hover:border-fg" : "border-line")}
    >
      <div className="flex items-start gap-2.5">
        <RadioDot on={on} />
        <div className="grid min-w-0 gap-0.5">
          <b className="font-semibold">{title}</b>
          <span className="row-sub">{sub}</span>
        </div>
      </div>
      <p className="text-[13px] text-fg-2">{trade}</p>
      {children}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-2.5 font-mono text-[13px] [&_span]:text-fg-3">{est}</div>
    </div>
  )
}

/** Step 4 · Engine (spec §5.4): the only place cost shows before the fact. Primary = Generate. */
export function EngineStep({ creative, live }: { creative: CreativeDetail; live: "connecting" | "open" | "retrying" }) {
  const t = useTranslations("wizard")
  const errorMessage = useErrorMessage()
  const money = useMoney()
  const router = useRouter()
  const qc = useQueryClient()
  const { run, dialog } = useConfirmReset()
  const id = creative.id
  const faceN = useFaceNumber(creative)

  const catalog = useQuery({ queryKey: ["engines"], queryFn: api.engine.catalog, staleTime: Infinity })
  const voices = useQuery({ queryKey: ["voices", creative.language], queryFn: () => api.engine.voices(creative.language), staleTime: Infinity })
  const sceneModels = catalog.data?.engines.find((e) => e.id === "SCENES")?.models ?? []
  const lipModel = catalog.data?.engines.find((e) => e.id === "LIPSYNC")?.models[0]?.id ?? "pruna-lipsync"

  const [engine, setEngine] = useState<Engine>(creative.engine ?? "SCENES")
  const [model, setModel] = useState<string>(creative.engine === "SCENES" && creative.engineModel ? creative.engineModel : "kling-3.0")
  const [voiceId, setVoiceId] = useState<string | null>(creative.voiceId)
  const [format, setFormat] = useState<VideoFormat>(creative.format)
  const [genError, setGenError] = useState<unknown>(null)
  const voice = voiceId ?? voices.data?.[0]?.id ?? null
  const chosenModel = engine === "SCENES" ? model : lipModel

  const estScenes = useQuery({
    queryKey: ["estimate", id, "SCENES", model, format],
    queryFn: () => api.engine.estimate(id, { engine: "SCENES", model, format }),
  })
  const estLip = useQuery({
    queryKey: ["estimate", id, "LIPSYNC", lipModel, format, voice],
    queryFn: () => api.engine.estimate(id, { engine: "LIPSYNC", model: lipModel, format, voiceId: voice ?? undefined }),
    enabled: !!voice,
  })
  const est: Estimate | undefined = engine === "SCENES" ? estScenes.data : estLip.data
  const estError = engine === "SCENES" ? estScenes.error : estLip.error

  // autosave the choices (contract §9 PATCH …/engine) while still in ENGINE_PENDING
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (creative.state !== "ENGINE_PENDING") return
    const h = setTimeout(() => {
      api.engine
        .save(id, { engine, engineModel: chosenModel, voiceId: engine === "LIPSYNC" ? voice : null, format })
        .then((d) => qc.setQueryData(qk.creative(id), d))
        .catch(() => undefined)
    }, 400)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, model, voice, format])

  const generate = useMutation({
    mutationFn: () =>
      run((confirm) =>
        api.engine.generate(id, {
          engine, engineModel: chosenModel, voiceId: engine === "LIPSYNC" ? (voice ?? undefined) : undefined, format,
          expectedCostUsd: est?.costUsd ?? 0, confirm: confirm || undefined,
        })
      ),
    onMutate: () => setGenError(null),
    onSuccess: (r) => {
      if (!r) return
      qc.setQueryData(qk.creative(id), r.creative)
      qc.setQueryData(qk.scenes(id), { summary: { ready: 0, total: r.scenes.length, failed: 0, progress: 0, etaSec: null }, scenes: r.scenes })
      qc.invalidateQueries({ queryKey: ["creatives"] })
      toast(
        <>
          <Icon name="check" />
          {t("engine.started")}
        </>
      )
      router.push(stepHref(id, "generation"))
    },
    onError: (e) => {
      setGenError(e)
      if (isApiError(e) && e.code === "ESTIMATE_CHANGED") qc.invalidateQueries({ queryKey: ["estimate", id] })
    },
  })

  const playSample = () => {
    const v = voices.data?.find((x) => x.id === voice)
    if (!v) return
    void new Audio(v.sample.url).play().catch(() => undefined)
    toast(
      <>
        <Icon name="vol" />
        {t("engine.playing")}
      </>
    )
  }

  const min = (sec?: number) => (sec ? t("engine.minutes", { n: Math.max(1, Math.round(sec / 60)) }) : "…")
  const estLine = (e: Estimate | undefined, unitKey: "sceneCount" | "clips") => (
    <>
      <div>
        <span>{t("engine.est")} </span>
        {e ? money(e.costUsd) : "…"}
      </div>
      <div>
        <span>{t("engine.time")} </span>
        {min(e?.etaSec)}
      </div>
      <div>
        <span>{t(`engine.${unitKey}`)} </span>
        {e?.sceneCount ?? "…"}
      </div>
    </>
  )
  const capErr = isApiError(genError) && genError.code === "SPEND_CAP_EXCEEDED" ? (genError.details as { spentUsd: number; capUsd: number; estimateUsd: number }) : null
  const changedErr = isApiError(genError) && genError.code === "ESTIMATE_CHANGED" ? (genError.details as { estimateUsd: number }) : null
  const engineLabel = engine === "SCENES" ? (sceneModels.find((m) => m.id === model)?.label ?? model) : t("engine.lipsync")

  return (
    <WizardFrame
      creative={creative}
      viewing="engine"
      live={live}
      actionbar={
        <ActionBar
          hint={t("engine.hint")}
          back={{ href: stepHref(id, "avatar") }}
          primary={
            <Button data-primary variant="default" disabled={!est || generate.isPending || (engine === "LIPSYNC" && !voice)} onClick={() => generate.mutate()}>
              {t("engine.generate")}
            </Button>
          }
        />
      }
    >
      <WzHead title={t("engine.title")} sub={t("engine.sub")} />
      {capErr ? (
        <Banner kind="error" title={t("engine.capTitle")} body={t("engine.capBody", { estimate: money(capErr.estimateUsd), spent: money(capErr.spentUsd), cap: money(capErr.capUsd) })} />
      ) : changedErr ? (
        <Banner kind="error" title={t("engine.estimateChanged", { estimate: money(changedErr.estimateUsd) })} />
      ) : genError ? (
        <Banner kind="error" title={errorMessage(genError)} />
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desktop:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <div role="radiogroup" aria-label={t("engine.title")} className="grid grid-cols-[minmax(0,1fr)] gap-3 tablet:grid-cols-2">
            <EngineCard
              on={engine === "SCENES"}
              onSelect={() => setEngine("SCENES")}
              title={t("engine.scenes")}
              sub={sceneModels.map((m) => m.label).join(" / ") || t("engine.scenesSub")}
              trade={t("engine.scenesTrade")}
              est={estLine(estScenes.data, "sceneCount")}
            >
              {engine === "SCENES" ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <ToggleGroup type="single" value={model} onValueChange={(v) => v && setModel(v)} aria-label={t("engine.scenes")}>
                    {sceneModels.map((m) => (
                      <ToggleGroupItem key={m.id} value={m.id}>
                        {m.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              ) : null}
            </EngineCard>
            <EngineCard
              on={engine === "LIPSYNC"}
              onSelect={() => setEngine("LIPSYNC")}
              title={t("engine.lipsync")}
              sub={t("engine.lipsyncSub")}
              trade={t("engine.lipsyncTrade")}
              est={estLine(estLip.data, "clips")}
            >
              {engine === "LIPSYNC" ? (
                <div className="grid gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Label htmlFor="voice">{t("engine.voice")}</Label>
                  <div className="flex gap-2">
                    <Select value={voice ?? ""} onValueChange={setVoiceId}>
                      <SelectTrigger id="voice" className="min-w-0 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(voices.data ?? []).map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-[34px]" type="button" onClick={playSample} disabled={!voice}>
                      <Icon name="vol" />
                      {t("engine.hear")}
                    </Button>
                  </div>
                  {estLip.data?.warnings.includes("voice_gender_mismatch") ? (
                    <p className="flex gap-1.5 text-[13px] text-status-waiting">
                      <Icon name="alert" className="mt-0.5" />
                      {t("engine.genderWarning")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </EngineCard>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("engine.format")}</Label>
            <div>
              <ToggleGroup type="single" value={format} onValueChange={(v) => v && setFormat(v as VideoFormat)} aria-label={t("engine.format")}>
                {(catalog.data?.formats ?? FORMATS).map((f) => (
                  <ToggleGroupItem key={f} value={f}>
                    {t(`engine.formats.${f}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        </div>
        <Panel>
          <h2>{t("engine.summary")}</h2>
          <ul className="m-0 grid list-none p-0 text-[13px] [&>li]:flex [&>li]:justify-between [&>li]:gap-3 [&>li]:border-t [&>li]:border-line [&>li]:py-[7px] [&>li:first-child]:border-t-0 [&>li>span:first-child]:text-fg-2">
            <li>
              <span>{t("script")}</span>
              <span>
                {creative.summary.scriptLetter} · {creative.summary.scriptDurationSec}s
              </span>
            </li>
            <li>
              <span>{t("face")}</span>
              <span>
{faceN ?? "—"}
              </span>
            </li>
            <li>
              <span>{t("engineLabel")}</span>
              <span>{engineLabel}</span>
            </li>
            <li>
              <span>{t("engine.format")}</span>
              <span>{FORMAT_SHORT[format]}</span>
            </li>
            <li>
              <span>{t("engine.time")}</span>
              <span className="font-mono">{min(est?.etaSec)}</span>
            </li>
            <li className="text-sm font-semibold [&>span:first-child]:!text-fg">
              <span>{t("engine.estCost")}</span>
              <span className="font-mono tabular-nums">{est ? money(est.costUsd) : estError ? "—" : "…"}</span>
            </li>
          </ul>
          {estError ? <p className="text-[13px] text-status-failed">{t("engine.estimateError")}</p> : null}
          {est ? (
            <p className="text-[13px] text-fg-2">
              {est.spend.capUsd === null
                ? t("engine.spentNoCap", { spent: money(est.spend.monthUsd) })
                : t("engine.spent", { spent: money(est.spend.monthUsd), cap: money(est.spend.capUsd) })}
            </p>
          ) : null}
        </Panel>
      </div>
      {dialog}
    </WizardFrame>
  )
}
