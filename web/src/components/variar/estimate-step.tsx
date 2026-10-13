"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { BatchEstimate, BatchSettings, CastingStyle, ChampionDetail, FaceCount, VariationBatch, VariationCasting, VariationItem, VariationKind, VideoFormat } from "@/lib/api/types"
import { variarHref } from "@/lib/routes"
import { Button, buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { GenCanvas } from "@/components/fx"
import { Icon } from "@/components/icon"
import { Panel, PanelHead } from "@/components/page"
import { ActionBar, WzHead } from "@/components/wizard/shell"
import { Banner, Memo, useMoney } from "@/components/wizard/common"
import { FaceCountControl } from "@/components/wizard/face-count"
import { useErrorMessage } from "@/hooks/use-error-message"
import { vk } from "@/hooks/use-variar"
import { cn } from "@/lib/utils"
import { VariarFrame } from "./frame"
import { PlanWait, usePlanActions } from "./hooks-step"
import { CastingStyleReplan } from "./casting-style"
import { SwapEnginePanel } from "./swap-engine"

const FORMATS: VideoFormat[] = ["VERTICAL_9_16", "PORTRAIT_4_5", "SQUARE_1_1"]
const FORMAT_SHORT: Record<VideoFormat, string> = { VERTICAL_9_16: "9:16", PORTRAIT_4_5: "4:5", SQUARE_1_1: "1:1" }
type Missing = { castingId: string; reason: "face_not_selected" } | { itemId: string; reason: "not_ready" } | { field: "voiceId" }

/** What the launch would refuse with BATCH_INCOMPLETE, worked out from the batch so the screen can point at it first. */
function missingOf(b: VariationBatch): Missing[] {
  const inc = b.items.filter((i) => i.included)
  const out: Missing[] = inc.filter((i) => i.status !== "READY").map((i) => ({ itemId: i.id, reason: "not_ready" as const }))
  for (const id of new Set(inc.map((i) => i.castingId).filter(Boolean) as string[])) {
    if (!b.castings.find((c) => c.id === id)?.selectedFaceId) out.push({ castingId: id, reason: "face_not_selected" })
  }
  // §13: keeping the edit uses the winner's own audio (swap) or speech (written hook): no voice to pick
  if (!b.settings.keepEdit && inc.some((i) => i.kind === "NEW_HOOKS" || (i.kind === "SWAP_AVATAR" && b.settings.voiceSource === "CATALOG")) && !b.settings.voiceId) out.push({ field: "voiceId" })
  return out
}

/** Who a casting is for, in words ("Swap 2", "the hooks and the control"). */
function useCastingTitle(b: VariationBatch) {
  const t = useTranslations("variar.estimate")
  const swaps = b.items.filter((i) => i.kind === "SWAP_AVATAR")
  return (c: VariationCasting) => (c.scope === "SHARED" ? t("faceShared") : t("faceFor", { n: swaps.findIndex((i) => i.castingId === c.id) + 1 }))
}

function CastingPanel({ batch, casting, items, locked }: { batch: VariationBatch; casting: VariationCasting; items: VariationItem[]; locked: boolean }) {
  const t = useTranslations("variar.estimate")
  const tw = useTranslations("wizard")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const actions = usePlanActions(batch)
  const title = useCastingTitle(batch)(casting)
  const [desc, setDesc] = useState<string | null>(null)
  const description = desc ?? casting.description
  const latest = casting.batches[0]
  const generating = !!latest?.faces.some((f) => f.status === "QUEUED" || f.status === "GENERATING")
  const allFailed = !generating && !!latest && latest.faces.every((f) => f.status === "FAILED")
  // newest round first, then the earlier ready faces: a 1-face round never hides the one before it (§13.13)
  const shown = casting.batches.flatMap((r) => (r === latest ? (allFailed ? [] : r.faces) : r.faces.filter((f) => f.status === "READY")))
  // §13.13: casting default 1; "more faces" repeats the last count
  const [pickedCount, setCount] = useState<FaceCount | null>(null)
  const count = pickedCount ?? ((latest?.faces.length ?? 1) as FaceCount)
  const included = items.some((i) => i.included)
  const setCasting = (c: VariationCasting) =>
    qc.setQueryData<VariationBatch>(vk.batch(batch.id), (b) => (b ? { ...b, castings: b.castings.map((x) => (x.id === c.id ? c : x)) } : b))

  const generate = useMutation({
    mutationFn: () => api.batches.generateFaces(batch.id, casting.id, { description: description.trim(), count }),
    onSuccess: () => qc.invalidateQueries({ queryKey: vk.batch(batch.id) }),
    onError: (e) => toast(errorMessage(e)),
  })
  const select = useMutation({
    mutationFn: (faceId: string) => api.batches.selectFace(batch.id, casting.id, faceId),
    onSuccess: (c) => {
      setCasting(c)
      qc.invalidateQueries({ queryKey: vk.estimate(batch.id) })
    },
    onError: (e) => toast(errorMessage(e)),
  })

  return (
    <div className={cn("grid min-w-0 gap-3 rounded-lg border bg-surface px-4 py-3.5", included ? "border-line" : "border-dashed border-line opacity-60")}>
      <PanelHead>
        <b className="font-semibold">{title}</b>
        {casting.scope === "ITEM" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => items.forEach((i) => actions.update.mutate({ id: i.id, body: { included: !included } }))}
          >
            {included ? (
              <>
                <Icon name="trash" />
                {t("remove")}
              </>
            ) : (
              t("restore")
            )}
          </Button>
        ) : null}
      </PanelHead>
      {included ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-2 tablet:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-1.5">
              <span className="text-xs text-fg-3">{t("who")}</span>
              <Textarea rows={2} value={description} maxLength={600} onChange={(e) => setDesc(e.target.value)} disabled={locked} />
            </label>
            <FaceCountControl
              count={count}
              onChange={setCount}
              unitPriceUsd={batch.faceUnitPriceUsd}
              disabled={locked || generating || generate.isPending}
              action={
                <Button
                  variant={latest ? "outline" : "default"}
                  disabled={locked || generating || generate.isPending || description.trim().length < 10}
                  onClick={() => generate.mutate()}
                >
                  <Icon name="refresh" />
                  {latest ? t("moreFaces", { n: count }) : t("generateFaces", { n: count })}
                </Button>
              }
            />
          </div>
          {allFailed ? <Banner kind="error" title={latest.faces[0]?.failReason ?? errorMessage(latest.faces[0]?.errorCode)} /> : null}
          {shown.length ? (
            <RadioGroupPrimitive.Root
              value={casting.selectedFaceId ?? ""}
              onValueChange={(v) => select.mutate(v)}
              aria-label={title}
              className="grid max-w-[440px] grid-cols-4 gap-2"
            >
              {shown.map((f, i) =>
                f.status === "READY" && f.image ? (
                  <RadioGroupPrimitive.Item
                    key={f.id}
                    value={f.id}
                    disabled={locked || select.isPending}
                    aria-label={tw("avatar.face", { n: i + 1 })}
                    className="relative aspect-[4/5] max-w-full overflow-hidden rounded-sm border border-line bg-surface p-0 data-[state=checked]:border-fg data-[state=checked]:shadow-[0_0_0_1px_var(--fg)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.image.url} alt="" className="size-full object-cover object-[50%_35%]" />
                    {f.id === casting.selectedFaceId ? (
                      <span className="absolute top-1 right-1 grid size-[18px] place-items-center rounded-full bg-fg text-bg">
                        <Icon name="check" className="size-3" />
                      </span>
                    ) : null}
                  </RadioGroupPrimitive.Item>
                ) : (
                  <div key={f.id} className="relative aspect-[4/5] overflow-hidden rounded-sm border border-line bg-surface-2" role="status">
                    {f.status === "FAILED" ? (
                      <span className="grid size-full place-items-center text-status-failed">
                        <Icon name="alert" />
                      </span>
                    ) : (
                      <GenCanvas seed={i} width={80} height={100} />
                    )}
                  </div>
                )
              )}
            </RadioGroupPrimitive.Root>
          ) : null}
          {generating ? (
            <span className="text-[13px] text-fg-2">{t("generatingFaces", { n: latest?.faces.length ?? count })}</span>
          ) : !latest ? (
            <span className="text-[13px] text-fg-2">{t("noFacesYet")}</span>
          ) : !casting.selectedFaceId ? (
            <span className="text-[13px] text-status-waiting">{t("pickFace")}</span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function SettingsPanel({ batch, locked }: { batch: VariationBatch; locked: boolean }) {
  const t = useTranslations("variar.estimate")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const voices = useQuery({ queryKey: ["voices", batch.language], queryFn: () => api.engine.voices(batch.language) })
  const save = useMutation({
    mutationFn: (b: Partial<BatchSettings>) => api.batches.updateSettings(batch.id, b),
    onSuccess: (b) => {
      qc.setQueryData(vk.batch(b.id), b)
      qc.invalidateQueries({ queryKey: vk.estimate(b.id) })
    },
    onError: (e) => toast(errorMessage(e)),
  })
  const s = batch.settings
  const tk = useTranslations("variar.keep")
  if (s.keepEdit) {
    return (
      <Panel>
        <h2>{t("voiceFormat")}</h2>
        <Memo icon="lock">{tk(s.voiceSource === "ENGINE_VOICE" ? "estimateNoteEngineVoice" : "estimateNote", { format: FORMAT_SHORT[s.format] })}</Memo>
        <span className="text-[13px] text-fg-3">{tk("newBatchToChange")}</span>
      </Panel>
    )
  }
  const hasSwap = batch.items.some((i) => i.kind === "SWAP_AVATAR" && i.included)
  const needsVoice = batch.items.some((i) => i.included && (i.kind === "NEW_HOOKS" || (i.kind === "SWAP_AVATAR" && s.voiceSource === "CATALOG")))
  return (
    <Panel>
      <h2>{t("voiceFormat")}</h2>
      {hasSwap ? (
        <div className="grid gap-1.5">
          <span className="text-xs text-fg-3">{t("swapVoice")}</span>
          <ToggleGroup
            type="single"
            value={s.voiceSource}
            disabled={locked}
            onValueChange={(v) => v && save.mutate({ voiceSource: v as BatchSettings["voiceSource"] })}
            aria-label={t("swapVoice")}
          >
            <ToggleGroupItem value="CHAMPION_AUDIO">{t("originalAudio")}</ToggleGroupItem>
            <ToggleGroupItem value="CATALOG">{t("catalogVoice")}</ToggleGroupItem>
          </ToggleGroup>
          {/* §13.15.1: Kling/Seedance only redraw the face over the winner's own edit */}
          <span className="flex gap-1.5 text-[13px] text-fg-3">
            <Icon name="lock" className="mt-0.5 flex-none" />
            {t("videoEnginesNeedKeep")}
          </span>
        </div>
      ) : null}
      {needsVoice ? (
        <div className="grid gap-1.5">
          <span className="text-xs text-fg-3">{t("voice")}</span>
          <Select value={s.voiceId ?? ""} onValueChange={(v) => save.mutate({ voiceId: v })} disabled={locked || voices.isPending}>
            <SelectTrigger className="w-full max-w-80" aria-label={t("voice")}>
              <SelectValue placeholder={t("pickVoice")} />
            </SelectTrigger>
            <SelectContent>
              {(voices.data ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <span className="text-xs text-fg-3">{t("format")}</span>
        <ToggleGroup type="single" value={s.format} disabled={locked} onValueChange={(v) => v && save.mutate({ format: v as VideoFormat })} aria-label={t("format")}>
          {FORMATS.map((f) => (
            <ToggleGroupItem key={f} value={f}>
              {FORMAT_SHORT[f]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <Memo icon="info">{t("sameForAll")}</Memo>
    </Panel>
  )
}

function EstimateTable({ est, batch, champion }: { est: BatchEstimate; batch: VariationBatch; champion: ChampionDetail }) {
  const t = useTranslations("variar")
  const money = useMoney()
  const dur = champion.durationSec ?? 0
  const hookSec = champion.teardown?.sections.hook.data?.endSec ?? 3
  const byId = new Map(batch.items.map((i) => [i.id, i]))
  const groups: { key: string; kind: VariationKind; control: boolean; n: number; sum: number }[] = []
  for (const it of est.items) {
    const control = !!byId.get(it.itemId)?.isControl
    const key = `${it.kind}${control ? ":control" : ""}`
    const g = groups.find((x) => x.key === key)
    if (g) {
      g.n++
      g.sum += it.costUsd
    } else groups.push({ key, kind: it.kind, control, n: 1, sum: it.costUsd })
  }
  const swapQuote = est.swapQuotes?.find((q) => q.selected)
  const swapVideo = swapQuote && swapQuote.engine !== "LIPSYNC" ? swapQuote : null
  const note = (g: (typeof groups)[number]) =>
    batch.settings.keepEdit
      ? g.kind === "SWAP_AVATAR"
        ? swapVideo
          ? t(swapVideo.voiceSource === "ENGINE_VOICE" ? "keep.noteSwapVideoB" : "keep.noteSwapVideoA", {
              engine: t(`swap.engine.${swapVideo.engine}`), s: Math.round(swapVideo.lines.find((l) => l.kind === "VIDEO")?.units ?? 0),
            })
          : t("keep.noteSwap", { s: Math.round(dur) })
        : t("keep.noteHooks")
      : g.kind === "SWAP_AVATAR"
      ? batch.settings.voiceSource === "CHAMPION_AUDIO" ? t("estimate.noteSwapOriginal", { s: Math.round(dur) }) : t("estimate.noteSwapCatalog", { s: Math.round(dur) })
      : g.control ? t("estimate.noteControl", { s: Math.round(dur) }) : t("estimate.noteHooks", { s: Math.round(hookSec) })
  const count = est.items.length
  const row = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-line px-4 py-3 text-[13px] first:border-t-0 tablet:grid-cols-[minmax(0,2.4fr)_minmax(0,.6fr)_minmax(0,1fr)_minmax(0,1fr)] tablet:items-center tablet:gap-3"
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className={cn(row, "hidden bg-bg py-[9px] font-mono text-[11px] tracking-[0.06em] text-fg-3 uppercase tablet:grid")}>
        <span>{t("estimate.thVariation")}</span>
        <span className="text-right">{t("estimate.thQty")}</span>
        <span className="text-right">{t("estimate.thEach")}</span>
        <span className="text-right">{t("estimate.thSubtotal")}</span>
      </div>
      {groups.map((g) => (
        <div key={g.key} className={row}>
          <span className="font-medium">{g.control ? t("estimate.controlRow") : t(`kind.${g.kind}.title`)}</span>
          <span className="hidden text-right font-mono tablet:block">×{g.n}</span>
          <span className="hidden text-right font-mono tablet:block">{g.sum === 0 ? t("keep.free") : money(g.sum / g.n)}</span>
          <span className="col-start-2 row-start-1 text-right font-mono tablet:col-start-auto tablet:row-start-auto">{g.sum === 0 ? t("keep.free") : money(g.sum)}</span>
          <span className="col-span-full text-xs text-fg-2">
            <span className="tablet:hidden">×{g.n} · </span>
            {note(g)}
          </span>
        </div>
      ))}
      <div className={cn(row, "bg-surface-2 text-sm font-semibold")}>
        <span>
          {t("estimate.total", { n: count })}
          <span className="block text-xs font-normal text-fg-2">{t("estimate.eta", { min: Math.max(1, Math.round(est.etaSec / 60)) })}</span>
        </span>
        <span className="hidden tablet:block" />
        <span className="hidden tablet:block" />
        <span className="col-start-2 row-start-1 text-right font-mono tablet:col-start-auto tablet:row-start-auto">{money(est.costUsd)}</span>
      </div>
    </div>
  )
}

function SpendPanel({ est }: { est: BatchEstimate }) {
  const t = useTranslations("variar.estimate")
  const money = useMoney()
  const { monthUsd, capUsd, afterUsd } = est.spend
  const over = capUsd !== null && afterUsd > capUsd
  const scale = Math.max(capUsd ?? afterUsd, afterUsd) || 1
  return (
    <Panel className="content-start">
      <h2>{t("monthly")}</h2>
      <div className="flex h-1.5 overflow-hidden rounded-[3px] bg-line" aria-hidden="true">
        <b className="block h-full bg-fg-3" style={{ width: `${(monthUsd / scale) * 100}%` }} />
        <b className={cn("block h-full", over ? "bg-status-failed" : "bg-fg")} style={{ width: `${(est.costUsd / scale) * 100}%` }} />
      </div>
      <ul className="m-0 grid list-none p-0 text-[13px]">
        <li className="flex justify-between gap-3 py-[7px]">
          <span className="text-fg-2">{t("spentSoFar")}</span>
          <span className="font-mono">{money(monthUsd)}</span>
        </li>
        <li className="flex justify-between gap-3 border-t border-line py-[7px]">
          <span className="text-fg-2">{t("thisBatch")}</span>
          <span className="font-mono">{money(est.costUsd)}</span>
        </li>
        <li className="flex justify-between gap-3 border-t border-line py-[7px] text-sm font-semibold">
          <span>{t("after")}</span>
          <span className={cn("font-mono", over && "text-status-failed")}>
            {money(afterUsd)}
            {capUsd !== null ? ` / ${money(capUsd)}` : ""}
          </span>
        </li>
      </ul>
      {capUsd === null ? <span className="text-[13px] text-fg-3">{t("noCap")}</span> : null}
    </Panel>
  )
}

/** Step 5 · Estimate (spec §5.5): faces of each casting, voice/format of the batch, cost per kind, monthly cap, explicit OK. */
export function EstimateStep({ champion, batch }: { champion: ChampionDetail; batch: VariationBatch }) {
  const t = useTranslations("variar")
  const money = useMoney()
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const qc = useQueryClient()
  const castingTitle = useCastingTitle(batch)
  const planning = batch.status === "PLANNING"
  const locked = batch.status !== "PLAN_READY"
  const est = useQuery({
    queryKey: vk.estimate(batch.id),
    queryFn: () => api.batches.estimate(batch.id),
    enabled: batch.status === "PLAN_READY",
    retry: (n, e) => !(isApiError(e) && e.code === "BATCH_INCOMPLETE") && n < 2,
  })
  const missing = missingOf(batch)

  const launch = useMutation({
    mutationFn: () => api.batches.launch(batch.id, { expectedCostUsd: est.data!.costUsd }),
    onSuccess: (r) => {
      qc.setQueryData(vk.batch(batch.id), r.batch)
      qc.invalidateQueries({ queryKey: ["creatives"] })
      router.push(variarHref(champion.id, "batch", batch.id))
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "ESTIMATE_CHANGED") {
        est.refetch()
        return toast(t("estimate.changed", { cost: money(Number((e.details as { estimateUsd?: number })?.estimateUsd ?? 0)) }))
      }
      // the batch view already lists what is missing; refresh it so it matches what the API refused
      if (isApiError(e) && e.code === "BATCH_INCOMPLETE") qc.invalidateQueries({ queryKey: vk.batch(batch.id) })
      toast(errorMessage(e))
    },
  })

  useEffect(() => {
    if (batch.status === "LAUNCHED") router.replace(variarHref(champion.id, "batch", batch.id))
  }, [batch.status, router, champion.id, batch.id])

  const shownMissing = missing
  const over = !!est.data && est.data.spend.capUsd !== null && est.data.spend.afterUsd > est.data.spend.capUsd
  const usedCastings = batch.castings.filter((c) => batch.items.some((i) => i.castingId === c.id && i.status === "READY"))
  const missingLine = shownMissing
    .map((m) => ("field" in m ? t("estimate.missVoice") : m.reason === "face_not_selected" ? t("estimate.missFace", { who: castingTitle(batch.castings.find((c) => c.id === m.castingId)!) }) : null))
    .filter(Boolean)
    .join(" · ")
  const hasHooks = batch.requests.some((r) => r.kind === "NEW_HOOKS")
  // §13.13: castingStyle is not a setting; switching it after the plan rewrites the plan
  const replanCast = useMutation({
    mutationFn: (castingStyle: CastingStyle) => api.batches.replan(batch.id, { castingStyle }),
    onSuccess: (b) => {
      qc.setQueryData(vk.batch(b.id), b)
      qc.invalidateQueries({ queryKey: vk.estimate(b.id) })
    },
    onError: (e) => toast(errorMessage(e)),
  })
  // §13.13 + §13.15.1: with the engine's own voice the gender is free; otherwise it follows the winner's voice
  const swapOnOriginal = batch.items.some((i) => i.kind === "SWAP_AVATAR" && i.included) && batch.settings.voiceSource !== "ENGINE_VOICE" && (batch.settings.keepEdit || batch.settings.voiceSource === "CHAMPION_AUDIO")

  return (
    <VariarFrame
      champion={champion}
      batch={batch}
      viewing="estimate"
      actionbar={
        <ActionBar
          hint={missingLine || (est.data ? t("estimate.hint", { cost: money(est.data.costUsd), n: est.data.items.length }) : null)}
          back={{ href: variarHref(champion.id, hasHooks ? "hooks" : "variations", hasHooks ? batch.id : null) }}
          primary={
            <Button
              data-primary
              variant="default"
              disabled={locked || !est.data || over || launch.isPending || shownMissing.some((m) => !("itemId" in m))}
              onClick={() => launch.mutate()}
            >
              {t("estimate.approve")}
            </Button>
          }
        />
      }
    >
      <WzHead title={t("steps.estimate")} sub={t("estimate.sub")} />
      {planning ? <PlanWait batch={batch} kinds={["SWAP_AVATAR", "NEW_HOOKS", "COPY_NEW", "REMIX_EDIT"]} /> : null}
      {batch.status === "PLAN_FAILED" ? <Banner kind="error" title={t("hooks.failedTitle")} body={batch.job?.failReason ?? undefined} /> : null}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desktop:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-4">
          {batch.castings.length ? (
            <CastingStyleReplan
              value={batch.castingStyle}
              hasHooks={hasHooks && !batch.settings.keepEdit}
              genderFollowsVoice={swapOnOriginal}
              disabled={batch.status !== "PLAN_READY" && batch.status !== "PLAN_FAILED"}
              pending={replanCast.isPending}
              onReplan={(v) => replanCast.mutate(v)}
            />
          ) : null}
          {usedCastings.length ? (
            <div className="grid gap-2.5">
              <h2>{t("estimate.faces")}</h2>
              {usedCastings.map((c) => (
                <CastingPanel key={c.id} batch={batch} casting={c} items={batch.items.filter((i) => i.castingId === c.id && !i.isControl)} locked={locked} />
              ))}
            </div>
          ) : null}
          {est.data?.swapQuotes && batch.settings.keepEdit ? <SwapEnginePanel batch={batch} quotes={est.data.swapQuotes} locked={locked} /> : null}
          {!planning ? <SettingsPanel batch={batch} locked={locked} /> : null}
          {over ? (
            <Banner
              kind="error"
              title={t("estimate.overTitle")}
              body={t("estimate.overBody")}
              actions={
                <>
                  <Link href={variarHref(champion.id, "variations")} className={buttonVariants({ size: "sm" })}>
                    {t("estimate.change")}
                  </Link>
                  <Link href="/settings" className={buttonVariants({ size: "sm", variant: "ghost" })}>
                    {t("estimate.raiseCap")}
                  </Link>
                </>
              }
            />
          ) : null}
          {est.data ? (
            <>
              <EstimateTable est={est.data} batch={batch} champion={champion} />
              {est.data.savedByReuseUsd > 0 ? <Memo icon="info">{t("estimate.saved", { cost: money(est.data.savedByReuseUsd) })}</Memo> : null}
              {est.data.warnings.map((w) => (
                <Memo key={w} icon="alert">
                  {t(`estimate.warning.${w}`)}
                </Memo>
              ))}
              <Memo icon="info">{t("estimate.background")}</Memo>
            </>
          ) : est.isError && !planning ? (
            <Banner kind={isApiError(est.error) && est.error.code === "BATCH_INCOMPLETE" ? "info" : "error"} title={isApiError(est.error) && est.error.code === "BATCH_INCOMPLETE" ? t("estimate.nothingReady") : errorMessage(est.error)} />
          ) : !planning && batch.status === "PLAN_READY" ? (
            <span className="sk h-40 rounded-lg" />
          ) : null}
        </div>
        {est.data ? <SpendPanel est={est.data} /> : <span className="hidden desktop:block" />}
      </div>
    </VariarFrame>
  )
}
