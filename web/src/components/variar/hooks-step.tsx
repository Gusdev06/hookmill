"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { ChampionDetail, VariationBatch, VariationItem } from "@/lib/api/types"
import { variarHref } from "@/lib/routes"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checklist, ThinkingOrb } from "@/components/fx"
import { Icon } from "@/components/icon"
import { Panel, Tag } from "@/components/page"
import { ActionBar, WzHead } from "@/components/wizard/shell"
import { Banner, Memo, mmss } from "@/components/wizard/common"
import { useErrorMessage } from "@/hooks/use-error-message"
import { vk } from "@/hooks/use-variar"
import { cn } from "@/lib/utils"
import { VariarFrame } from "./frame"

export function usePlanActions(batch: VariationBatch) {
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: vk.batch(batch.id) })
    qc.invalidateQueries({ queryKey: vk.estimate(batch.id) })
  }
  const setItem = (it: VariationItem) =>
    qc.setQueryData<VariationBatch>(vk.batch(batch.id), (b) => (b ? { ...b, items: b.items.map((x) => (x.id === it.id ? it : x)) } : b))
  const opts = { onError: (e: unknown) => toast(errorMessage(e)) }
  return {
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.batches.updateItem>[2] }) => api.batches.updateItem(batch.id, id, body),
      onSuccess: (it) => {
        setItem(it)
        qc.invalidateQueries({ queryKey: vk.estimate(batch.id) })
      },
      ...opts,
    }),
    regenerate: useMutation({ mutationFn: (id: string) => api.batches.regenerateItem(batch.id, id), onSuccess: (it) => { setItem(it); refresh() }, ...opts }),
    replan: useMutation({ mutationFn: () => api.batches.replan(batch.id, {}), onSuccess: (b) => { qc.setQueryData(vk.batch(b.id), b); refresh() }, ...opts }),
  }
}

/** Hook card (mockup .hk): spoken line in focus, on-screen text and what follows; Edit / Rewrite / Remove. */
function HookCard({ item, n, hookEnd, actions, locked, textMode }: {
  item: VariationItem; n: number; hookEnd: number; actions: ReturnType<typeof usePlanActions>; locked: boolean; textMode: boolean
}) {
  const t = useTranslations("variar.hooks")
  const tk = useTranslations("variar.keep")
  const tc = useTranslations("common")
  const [edit, setEdit] = useState<{ speech: string; onScreenText: string } | null>(null)
  const span = `${mmss(0)}–${mmss(hookEnd)}`

  if (item.status === "WRITING") {
    return (
      <div className="grid min-w-0 gap-2.5 rounded-lg border border-line bg-surface p-3.5" role="status">
        <div className="flex items-center gap-2">
          <b className="font-mono font-semibold">{t("hookN", { n })}</b>
        </div>
        <div className="rounded-sm border border-line bg-surface-2 p-3">
          <span className="step-lbl mb-1 block">{textMode ? tk("hookText") : t("spoken")}</span>
          <p className="stream m-0 text-[17px] font-semibold text-fg-2" />
        </div>
        <span className="sk h-2.5 w-3/4" />
        <span className="sk h-2.5 w-1/2" />
      </div>
    )
  }
  if (item.status === "FAILED") {
    return (
      <div className="grid min-w-0 gap-2.5 rounded-lg border border-status-failed-edge bg-surface p-3.5">
        <b className="font-mono font-semibold">{t("hookN", { n })}</b>
        <span className="text-[13px] text-status-failed">{item.failReason}</span>
        <div>
          <Button size="sm" disabled={actions.regenerate.isPending || locked} onClick={() => actions.regenerate.mutate(item.id)}>
            <Icon name="refresh" />
            {t("writeAgain")}
          </Button>
        </div>
      </div>
    )
  }
  if (!item.included) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-dashed border-line bg-bg px-3.5 py-3 text-[13px] text-fg-2">
        <b className="font-mono font-semibold text-fg-2">{t("hookN", { n })}</b>
        <span className="min-w-0 flex-1 truncate line-through">{textMode ? item.hook?.onScreenText : item.hook?.speech}</span>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => actions.update.mutate({ id: item.id, body: { included: true } })}>
          {t("restore")}
        </Button>
      </div>
    )
  }
  return (
    <div className="grid min-w-0 rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
        <b className="font-mono font-semibold">{t("hookN", { n })}</b>
        {item.lever ? <Tag>{item.lever}</Tag> : null}
        <span className="ml-auto font-mono text-xs text-fg-3">{span}</span>
      </div>
      {edit && textMode ? (
        <div className="grid gap-3 px-3.5 pt-3 pb-3.5">
          <label className="grid gap-1.5">
            <span className="text-xs text-fg-3">{tk("hookText")}</span>
            <Input autoFocus value={edit.onScreenText} maxLength={120} onChange={(e) => setEdit({ ...edit, onScreenText: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={!edit.onScreenText.trim() || actions.update.isPending}
              onClick={() =>
                actions.update.mutate(
                  { id: item.id, body: { hook: { onScreenText: edit.onScreenText.trim() } } },
                  {
                    onSuccess: () => {
                      setEdit(null)
                      toast(
                        <>
                          <Icon name="check" />
                          {t("saved")}
                        </>
                      )
                    },
                  }
                )
              }
            >
              {tc("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      ) : edit ? (
        <div className="grid gap-3 px-3.5 pt-3 pb-3.5">
          <label className="grid gap-1.5">
            <span className="text-xs text-fg-3">{t("spoken")}</span>
            <Textarea rows={2} value={edit.speech} onChange={(e) => setEdit({ ...edit, speech: e.target.value })} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-fg-3">{t("onScreen")}</span>
            <Input value={edit.onScreenText} onChange={(e) => setEdit({ ...edit, onScreenText: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={!edit.speech.trim() || actions.update.isPending}
              onClick={() =>
                actions.update.mutate(
                  { id: item.id, body: { hook: { speech: edit.speech.trim(), onScreenText: edit.onScreenText.trim() || null } } },
                  {
                    onSuccess: () => {
                      setEdit(null)
                      toast(
                        <>
                          <Icon name="check" />
                          {t("saved")}
                        </>
                      )
                    },
                  }
                )
              }
            >
              {tc("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mx-3.5 mt-2.5 rounded-sm border border-line bg-surface-2 p-3">
            <span className="step-lbl mb-1 block">{textMode ? tk("hookText") : t("spoken")}</span>
            <p className="m-0 text-[17px] leading-snug font-semibold tracking-[-0.01em]">{textMode ? item.hook?.onScreenText || "—" : item.hook?.speech}</p>
          </div>
          <dl className="m-0 grid grid-cols-[minmax(0,1fr)] gap-x-3 px-3.5 pt-2.5 pb-1 text-[13px] tablet:grid-cols-[120px_minmax(0,1fr)]">
            <dt className="pt-[7px] text-xs text-fg-3">{textMode ? tk("spokenSame") : t("onScreen")}</dt>
            <dd className={cn("m-0 min-w-0 border-line pb-[7px] tablet:pt-[7px]", textMode && "text-fg-2")}>{(textMode ? item.hook?.speech : item.hook?.onScreenText) || "—"}</dd>
            {item.rationale ? (
              <>
                <dt className="border-t border-line pt-[7px] text-xs text-fg-3">{t("why")}</dt>
                <dd className="m-0 min-w-0 pb-[7px] text-fg-2 tablet:border-t tablet:border-line tablet:pt-[7px]">{item.rationale}</dd>
              </>
            ) : null}
            <dt className="border-t border-line pt-[7px] text-xs text-fg-3">{t("then")}</dt>
            <dd className="m-0 min-w-0 pb-[7px] text-fg-2 tablet:border-t tablet:border-line tablet:pt-[7px]">{t("thenBody", { at: mmss(hookEnd) })}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-2 px-3.5 pt-2 pb-3.5">
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => setEdit({ speech: item.hook?.speech ?? "", onScreenText: item.hook?.onScreenText ?? "" })}>
              <Icon name="pencil" />
              {t("edit")}
            </Button>
            <Button size="sm" variant="ghost" disabled={locked || actions.regenerate.isPending} onClick={() => actions.regenerate.mutate(item.id)}>
              <Icon name="refresh" />
              {t("rewrite")}
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" disabled={locked} onClick={() => actions.update.mutate({ id: item.id, body: { included: false } })}>
              <Icon name="trash" />
              {t("remove")}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Planning wait (spec §2.5): orb + real checklist (read teardown, then one line per item). */
export function PlanWait({ batch, kinds }: { batch: VariationBatch; kinds: VariationItem["kind"][] }) {
  const t = useTranslations("variar")
  const items = batch.items.filter((i) => kinds.includes(i.kind))
  const done = items.filter((i) => i.status !== "WRITING").length
  const read = batch.job?.checklist.find((c) => c.key === "reading_teardown")?.done ?? false
  let hn = 0
  let sn = 0
  const label = (i: VariationItem) =>
    i.isControl ? t("hooks.control") : i.kind === "NEW_HOOKS" ? t("hooks.hookN", { n: ++hn }) : t("estimate.swapN", { n: ++sn })
  const firstOpen = items.findIndex((i) => i.status === "WRITING")
  return (
    <Panel>
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-4 tablet:grid-cols-[auto_minmax(0,1fr)]">
        <div className="hidden px-6 tablet:block">
          <ThinkingOrb />
        </div>
        <div className="grid gap-2.5" role="status">
          <b className="font-semibold">{t("hooks.writing", { done, total: items.length })}</b>
          <Checklist
            items={[
              { label: t("job.reading_teardown"), state: read ? "done" : "now" },
              ...items.map((i, k) => ({
                label: `${label(i)}${i.status !== "WRITING" && i.lever ? ` (${i.lever})` : ""}`,
                state: (i.status !== "WRITING" ? "done" : read && k === firstOpen ? "now" : "todo") as "done" | "now" | "todo",
              })),
            ]}
          />
          <p className="text-[13px] text-fg-2">{t("hooks.usually")}</p>
        </div>
      </div>
    </Panel>
  )
}

/** Step 4 · Hooks (spec §5.4): original as reference, each new hook editable/rewritable/removable. Nothing generated yet. */
export function HooksStep({ champion, batch }: { champion: ChampionDetail; batch: VariationBatch }) {
  const t = useTranslations("variar")
  const router = useRouter()
  const actions = usePlanActions(batch)
  const hookEnd = champion.teardown?.sections.hook.data?.endSec ?? 3
  const control = batch.items.find((i) => i.kind === "NEW_HOOKS" && i.isControl)
  const hooks = batch.items.filter((i) => i.kind === "NEW_HOOKS" && !i.isControl)
  const planning = batch.status === "PLANNING"
  const locked = batch.status !== "PLAN_READY"
  const approved = hooks.filter((h) => h.included && h.status === "READY").length
  const og = champion.teardown?.sections.hook.data
  // §13.4 (a), decided 06/10: written hook on the winner's own video; the winner is the control
  const textMode = batch.settings.keepEdit && batch.settings.hookMode === "TEXT"
  const map = champion.teardown?.editMap ?? null
  const hookLayer = map?.layers.find((l) => (l.kind === "headline" || l.kind === "text") && l.startFrame < hookEnd * map.fps)
  const layerEnd = hookLayer && map ? hookLayer.endFrame / map.fps : null

  const noHooks = !batch.requests.some((r) => r.kind === "NEW_HOOKS")
  useEffect(() => {
    if (noHooks) router.replace(variarHref(champion.id, "estimate", batch.id))
  }, [noHooks, router, champion.id, batch.id])

  return (
    <VariarFrame
      champion={champion}
      batch={batch}
      viewing="hooks"
      actionbar={
        <ActionBar
          hint={planning ? null : t("hooks.approved", { n: approved })}
          back={{ href: variarHref(champion.id, "variations") }}
          primary={
            <Button data-primary variant="default" disabled={planning || batch.status === "LAUNCHED" || !approved} onClick={() => router.push(variarHref(champion.id, "estimate", batch.id))}>
              {t("continueTo", { step: t("steps.estimate") })}
            </Button>
          }
        />
      }
    >
      <WzHead
        title={t("steps.hooks")}
        sub={textMode ? t("keep.hooksSub") : t("hooks.sub")}
        aside={
          batch.status === "PLAN_READY" || batch.status === "PLAN_FAILED" ? (
            <Button disabled={actions.replan.isPending} onClick={() => actions.replan.mutate()}>
              <Icon name="refresh" />
              {t("hooks.rewriteAll")}
            </Button>
          ) : null
        }
      />
      {batch.status === "LAUNCHED" ? <Banner title={t("hooks.launched")} /> : null}
      {batch.status === "PLAN_FAILED" ? (
        <Banner
          kind="error"
          title={t("hooks.failedTitle")}
          body={batch.job?.failReason ?? undefined}
          actions={
            <Button size="sm" disabled={actions.replan.isPending} onClick={() => actions.replan.mutate()}>
              <Icon name="refresh" />
              {t("hooks.planAgain")}
            </Button>
          }
        />
      ) : null}
      {planning ? <PlanWait batch={batch} kinds={["NEW_HOOKS"]} /> : null}
      <div className="grid gap-2.5">
        <div className="grid min-w-0 rounded-lg border border-dashed border-line bg-bg">
          <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
            <b className="font-mono font-semibold">{t("hooks.original")}</b>
            {textMode ? <Tag>{t("keep.controlIsWinner")}</Tag> : control?.included === false ? <Tag>{t("hooks.controlOff")}</Tag> : <Tag>{t("hooks.controlTag")}</Tag>}
            <span className="ml-auto font-mono text-xs text-fg-3">
              {mmss(0)}–{mmss(hookEnd)}
            </span>
          </div>
          <div className="mx-3.5 mt-2.5 rounded-sm border border-line bg-surface-2 p-3">
            <span className="step-lbl mb-1 block">{textMode ? t("keep.hookText") : t("hooks.spoken")}</span>
            <p className="m-0 text-[17px] leading-snug font-medium text-fg-2">{(textMode ? hookLayer?.text ?? og?.onScreenText : og?.spoken) || "—"}</p>
          </div>
          <dl className="m-0 grid grid-cols-[minmax(0,1fr)] gap-x-3 px-3.5 pt-2.5 pb-3 text-[13px] tablet:grid-cols-[120px_minmax(0,1fr)]">
            <dt className="pt-[7px] text-xs text-fg-3">{textMode ? t("keep.spokenSame") : t("hooks.onScreen")}</dt>
            <dd className="m-0 min-w-0 pb-[7px] tablet:pt-[7px]">{(textMode ? og?.spoken : og?.onScreenText) || "—"}</dd>
            <dt className="border-t border-line pt-[7px] text-xs text-fg-3">{t("hooks.firstFrame")}</dt>
            <dd className="m-0 min-w-0 pb-[7px] tablet:border-t tablet:border-line tablet:pt-[7px]">{og?.visual || "—"}</dd>
          </dl>
          <p className={cn("mx-3.5 mb-3 text-[13px] text-fg-3")}>{textMode ? t("keep.controlIsWinnerNote") : t("hooks.controlNote")}</p>
        </div>
        {textMode && map && !hookLayer ? <Memo icon="info">{t("keep.noHeadline")}</Memo> : null}
        {textMode && layerEnd !== null && layerEnd > hookEnd + 0.5 ? <Memo icon="info">{t("keep.headlineLong", { at: mmss(layerEnd) })}</Memo> : null}
        {hooks.map((h, i) => (
          <HookCard key={h.id} item={h} n={i + 1} hookEnd={hookEnd} actions={actions} locked={locked} textMode={textMode} />
        ))}
      </div>
    </VariarFrame>
  )
}
