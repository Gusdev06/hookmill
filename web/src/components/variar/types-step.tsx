"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import { Icon } from "@/components/icon"
import type { CastingStyle, ChampionDetail, VariationKind } from "@/lib/api/types"
import { variarHref } from "@/lib/routes"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Panel } from "@/components/page"
import { ActionBar, WzHead } from "@/components/wizard/shell"
import { Banner, Memo } from "@/components/wizard/common"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useChampionBatches, vk } from "@/hooks/use-variar"
import { cn } from "@/lib/utils"
import { VariarFrame } from "./frame"
import { LeverTags, Stepper } from "./bits"
import { isKeepKind, KeepAvailability } from "./keep-edit"
import { CastingStyleChoice } from "./casting-style"

/** Count ranges per kind (feature-2 §2). Batch ≤ 10 items + the automatic control. */
export const RANGE: Record<VariationKind, [number, number]> = { SWAP_AVATAR: [1, 4], NEW_HOOKS: [2, 5], COPY_NEW: [1, 4], REMIX_EDIT: [1, 4], AUTO_EDIT: [0, 0] }
const ORDER: VariationKind[] = ["SWAP_AVATAR", "NEW_HOOKS", "COPY_NEW", "REMIX_EDIT"]
const MAX_ITEMS = 10

/** Step 3 · Variations (spec §5.3): kinds × quantity, unavailable kinds with the reason, "This batch" summary. */
export function TypesStep({ champion }: { champion: ChampionDetail }) {
  const t = useTranslations("variar")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const qc = useQueryClient()
  const earlier = useChampionBatches(champion.id)
  const [on, setOn] = useState<Record<VariationKind, boolean>>({ SWAP_AVATAR: true, NEW_HOOKS: true, COPY_NEW: false, REMIX_EDIT: false, AUTO_EDIT: false })
  const [count, setCount] = useState<Record<VariationKind, number>>({ SWAP_AVATAR: 2, NEW_HOOKS: 3, COPY_NEW: 2, REMIX_EDIT: 2, AUTO_EDIT: 0 })
  const [notes, setNotes] = useState("")
  const avail = (k: VariationKind) => champion.availableKinds.find((a) => a.kind === k)
  const active = ORDER.filter((k) => on[k] && avail(k)?.available)
  const total = active.reduce((a, k) => a + count[k], 0)
  const over = total > MAX_ITEMS
  const ready = champion.status === "READY"
  // §13: keep the winner's edit is one switch for the batch; on by default when every chosen kind can keep it
  const keepKinds = active.filter(isKeepKind)
  const keepAllowed = keepKinds.length > 0 && keepKinds.length === active.length && keepKinds.every((k) => champion.keepEdit[k].available)
  const [keepChoice, setKeepChoice] = useState<boolean | null>(null)
  const [cleanOk, setCleanOk] = useState(false)
  const keep = keepAllowed && keepChoice !== false
  const blockedKinds = keepKinds.filter((k) => !champion.keepEdit[k].available)
  const needsChoice = !keepAllowed && blockedKinds.length > 0 && !cleanOk
  // §13.13: new people come from the swap, and from the hooks/copy when they don't keep the edit
  const [castingStyle, setCastingStyle] = useState<CastingStyle>("DIVERSE")
  const hasCast = active.includes("SWAP_AVATAR") || (!keep && active.some((k) => k === "NEW_HOOKS" || k === "COPY_NEW"))

  // §13.11 (a): a blocked or unmapped winner shows the reason and a way to analyze again; the clean talking head stays an explicit choice
  const analyze = useMutation({
    mutationFn: () => api.champions.analyze(champion.id, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vk.champion(champion.id) })
      router.push(variarHref(champion.id, "teardown"))
    },
    onError: (e) => {
      // edited sections: the teardown asks before discarding them
      if (isApiError(e) && e.code === "CONFIRM_DOWNSTREAM_RESET") return router.push(variarHref(champion.id, "teardown"))
      toast(errorMessage(e))
    },
  })

  const create = useMutation({
    mutationFn: () =>
      api.champions.createBatch(champion.id, {
        requests: active.map((kind) => ({ kind, count: count[kind] })),
        settings: { keepEdit: keep, hookMode: "TEXT" },
        notes: notes.trim() || undefined,
        castingStyle,
      }),
    onSuccess: (b) => {
      qc.setQueryData(vk.batch(b.id), b)
      qc.invalidateQueries({ queryKey: vk.batches(champion.id) })
      router.push(variarHref(champion.id, b.requests.some((r) => r.kind === "NEW_HOOKS") ? "hooks" : "estimate", b.id))
    },
    onError: (e) => toast(errorMessage(e)),
  })

  const next = active.includes("NEW_HOOKS") ? "hooks" : "estimate"
  const lastBatch = earlier.data?.[0]

  return (
    <VariarFrame
      champion={champion}
      viewing="variations"
      actionbar={
        <ActionBar
          hint={over ? t("types.tooMany", { max: MAX_ITEMS }) : needsChoice ? t("keep.needChoice") : t("types.hint", { n: total })}
          back={{ href: variarHref(champion.id, "teardown") }}
          primary={
            <Button data-primary variant="default" disabled={!ready || !total || over || needsChoice || create.isPending} onClick={() => create.mutate()}>
              {t("continueTo", { step: t(`steps.${next}`) })}
            </Button>
          }
        />
      }
    >
      <WzHead title={t("steps.variations")} sub={t("types.sub")} />
      {!ready ? <Banner title={t("types.notReady")} /> : null}
      {lastBatch ? (
        <Memo icon="info">
          {t.rich("types.earlier", {
            n: earlier.data!.length,
            a: (c) => (
              <Link className="underline underline-offset-2" href={variarHref(champion.id, lastBatch.status === "LAUNCHED" ? "batch" : "estimate", lastBatch.id)}>
                {c}
              </Link>
            ),
          })}
        </Memo>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desktop:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-2.5">
          {ORDER.map((k) => {
            const a = avail(k)
            const soon = a?.reason === "NOT_ENABLED"
            const blocked = !a?.available
            const checked = on[k] && !blocked
            const [min, max] = RANGE[k]
            return (
              <div
                key={k}
                className={cn(
                  "grid min-w-0 gap-3 rounded-lg border px-4 py-3.5",
                  soon ? "border-dashed border-line bg-bg" : checked ? "border-fg bg-surface" : "border-line bg-surface"
                )}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`k-${k}`}
                    className="mt-0.5"
                    checked={checked}
                    disabled={blocked}
                    onCheckedChange={(v) => setOn((o) => ({ ...o, [k]: v === true }))}
                    aria-describedby={`kd-${k}`}
                  />
                  <label htmlFor={`k-${k}`} className="grid min-w-0 flex-1 gap-0.5">
                    <b className={cn("font-semibold", soon && "text-fg-2")}>{t(`kind.${k}.title`)}</b>
                    <span id={`kd-${k}`} className="max-w-[62ch] text-[13px] text-fg-2">
                      {t(`kind.${k}.desc`)}
                    </span>
                  </label>
                  {soon ? (
                    <span className="inline-flex flex-none items-center rounded-full border border-line px-[7px] py-px text-xs text-fg-2">{t("types.soon")}</span>
                  ) : checked ? (
                    <Stepper value={count[k]} min={min} max={max} label={t(`kind.${k}.title`)} onChange={(n) => setCount((c) => ({ ...c, [k]: n }))} />
                  ) : null}
                </div>
                <div className="grid min-w-0 gap-2 tablet:pl-[30px]">
                  <LeverTags kind={k} />
                  {a?.reason === "NO_SPEECH" ? <span className="text-[13px] text-status-waiting">{t("types.noSpeech")}</span> : null}
                  {soon ? <span className="text-[13px] text-fg-3">{t(`types.soonNote.${k}` as never)}</span> : null}
                  {checked && k === "SWAP_AVATAR" ? <span className="text-[13px] text-fg-2">{keep ? t("keep.swapNote") : t("types.swapNote")}</span> : null}
                  {checked && k === "NEW_HOOKS" ? <span className="text-[13px] text-fg-2">{keep ? t("keep.hooksNote") : t("types.hooksNote")}</span> : null}
                </div>
              </div>
            )
          })}
          {keepKinds.length ? (
            <Panel>
              <div className="flex items-start gap-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <label htmlFor="keep-edit" className="font-semibold">{t("keep.title")}</label>
                  <span className="max-w-[62ch] text-[13px] text-fg-2">{t("keep.desc")}</span>
                </div>
                <Switch
                  id="keep-edit"
                  checked={keep}
                  disabled={!keepAllowed}
                  onCheckedChange={(v) => setKeepChoice(v)}
                  aria-describedby="keep-state"
                />
              </div>
              <div id="keep-state" className="grid gap-2.5">
                <KeepAvailability keepEdit={champion.keepEdit} kinds={keepKinds} />
                {keepAllowed && !keep ? <Memo icon="info">{t("keep.offNote")}</Memo> : null}
                {!keepAllowed && active.some((k) => !isKeepKind(k)) && !blockedKinds.length ? <Memo icon="info">{t("keep.offNote")}</Memo> : null}
                {blockedKinds.length ? (
                  <div>
                    <Button size="sm" disabled={analyze.isPending} onClick={() => analyze.mutate()}>
                      <Icon name="refresh" />
                      {t("td.again")}
                    </Button>
                  </div>
                ) : null}
                {blockedKinds.length ? (
                  <label
                    className={cn(
                      "flex items-start gap-3 rounded-lg border px-3.5 py-3",
                      cleanOk ? "border-fg bg-surface-2" : "border-status-waiting/40 bg-bg"
                    )}
                  >
                    <Checkbox className="mt-0.5" checked={cleanOk} onCheckedChange={(v) => setCleanOk(v === true)} />
                    <span className="grid min-w-0 gap-0.5">
                      <b className="font-semibold">{t("keep.clean")}</b>
                      <span className="text-[13px] text-fg-2">{t("keep.cleanDesc")}</span>
                    </span>
                  </label>
                ) : null}
              </div>
            </Panel>
          ) : null}
          {hasCast ? (
            <CastingStyleChoice value={castingStyle} onChange={setCastingStyle} genderFollowsVoice={keep && active.includes("SWAP_AVATAR")} />
          ) : null}
        </div>
        <Panel className="content-start">
          <h2>{t("types.thisBatch")}</h2>
          <ul className="m-0 grid list-none p-0 text-[13px]">
            {ORDER.map((k) => {
              const a = avail(k)
              const off = a?.reason === "NOT_ENABLED"
              return (
                <li key={k} className={cn("flex justify-between gap-3 border-t border-line py-[7px] first:border-t-0", off && "text-fg-3 line-through")}>
                  <span className={cn(!off && "text-fg-2")}>{t(`kind.${k}.title`)}</span>
                  <span className="font-mono">{off ? t("types.soonShort") : on[k] && a?.available ? count[k] : 0}</span>
                </li>
              )
            })}
            {on.NEW_HOOKS && avail("NEW_HOOKS")?.available && !keep ? (
              <li className="flex justify-between gap-3 border-t border-line py-[7px] text-fg-3">
                <span>{t("types.control")}</span>
                <span className="font-mono">+1</span>
              </li>
            ) : null}
            <li className="flex justify-between gap-3 border-t border-line py-[7px] text-sm font-semibold">
              <span>{t("rail.variations")}</span>
              <span className={cn("font-mono", over && "text-status-failed")}>{total}</span>
            </li>
          </ul>
          <label className="grid gap-1.5">
            <span className="text-[13px] text-fg-2">{t("types.notes")}</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("types.notesPh")} maxLength={500} />
          </label>
          <p className="text-[13px] text-fg-2">{t("types.costNext")}</p>
        </Panel>
      </div>
    </VariarFrame>
  )
}
