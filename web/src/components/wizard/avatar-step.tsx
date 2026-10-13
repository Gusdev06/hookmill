"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { CreativeDetail, Face, FaceCount } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { GenCanvas } from "@/components/fx"
import { Icon } from "@/components/icon"
import { Panel } from "@/components/page"
import { qk } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { ActionBar, stepHref, WizardFrame, WzHead } from "./shell"
import { Banner, Memo, mmss, useConfirmReset } from "./common"
import { FaceCountControl } from "./face-count"

const GRID = "grid grid-cols-2 gap-3 desktop:grid-cols-4"

function useElapsed(running: boolean, key: number | undefined) {
  // start time per key + the last tick, both in state (render stays pure: no Date.now/ref reads during render)
  const [clock, setClock] = useState<{ starts: Record<number, number>; now: number }>({ starts: {}, now: 0 })
  useEffect(() => {
    if (!running) return
    const tick = () =>
      setClock((c) => {
        const now = Date.now()
        return { now, starts: key === undefined || key in c.starts ? c.starts : { ...c.starts, [key]: now } }
      })
    const first = setTimeout(tick, 0)
    const iv = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(iv)
    }
  }, [running, key])
  if (!running || key === undefined || !(key in clock.starts)) return 0
  return Math.max(0, clock.now - clock.starts[key]) / 1000
}

/** Step 3 · Avatar (spec §5.3): describe, generate 1-4 faces (§13.13) (effect per tile + elapsed), pick one; safety block keeps old faces dimmed. */
export function AvatarStep({ creative, live }: { creative: CreativeDetail; live: "connecting" | "open" | "retrying" }) {
  const t = useTranslations("wizard")
  const tSteps = useTranslations("steps")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const qc = useQueryClient()
  const { run, dialog } = useConfirmReset()
  const id = creative.id
  const q = useQuery({ queryKey: qk.faces(id), queryFn: () => api.faces.list(id) })
  const [desc, setDesc] = useState<string | null>(null)
  const description = desc ?? q.data?.description ?? creative.faceDescription ?? ""

  // autosave the description field (contract §8 PATCH …/faces/description)
  useEffect(() => {
    if (desc === null || desc === (q.data?.description ?? "")) return
    const h = setTimeout(() => api.faces.saveDescription(id, desc).catch(() => undefined), 800)
    return () => clearTimeout(h)
  }, [desc, id, q.data?.description])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.faces(id) })
    qc.invalidateQueries({ queryKey: qk.creative(id) })
  }
  const [pickedCount, setCount] = useState<FaceCount | null>(null)
  const generate = useMutation({
    mutationFn: () => api.faces.generate(id, { description: description.trim(), count }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e)),
  })
  const select = useMutation({
    mutationFn: (f: Face) => run((confirm) => api.faces.select(id, f.id, { confirm: confirm || undefined })),
    onSuccess: (d) => {
      if (d) qc.setQueryData(qk.creative(id), d)
      refresh()
    },
    onError: (e) => toast(errorMessage(e)),
  })

  const batches = q.data?.batches ?? []
  const latest = batches[0]
  const generating = creative.state === "FACES_GENERATING" || !!latest?.faces.some((f) => f.status === "QUEUED" || f.status === "GENERATING")
  const failedBatch = !generating && latest && latest.faces.every((f) => f.status === "FAILED") ? latest : null
  // §13.13: "more faces" repeats the last count; a first generation defaults to 4
  const count = pickedCount ?? ((latest?.faces.length ?? 4) as FaceCount)
  // newest round first, then the earlier ready faces, so a 1-face round never hides the one before it
  const shown = batches.flatMap((b) => (b === latest && !failedBatch ? b.faces : b === latest ? [] : b.faces.filter((f) => f.status === "READY")))
  const selectedId = q.data?.selectedFaceId ?? null
  const selectedFace = batches.flatMap((b) => b.faces).find((f) => f.id === selectedId)
  const faceNo = (f: Face) => (shown.indexOf(f) + 1 || f.position + 1)
  const elapsed = useElapsed(generating, latest?.batch)
  const code = failedBatch?.faces[0]?.errorCode

  let grid: React.ReactNode
  if (q.isPending) {
    grid = (
      <div className={GRID}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="sk aspect-[4/5] rounded-lg" />
        ))}
      </div>
    )
  } else if (generating) {
    grid = (
      <>
        <Banner kind="info" icon="clock" title={t("avatar.generatingTitle", { n: latest?.faces.length ?? count, elapsed: mmss(elapsed) })} body={t("avatar.generatingBody")} />
        <div className={GRID} role="status">
          {(latest?.faces ?? []).map((f, i) => (
            <div key={f.id} className="grid min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
              <div className="aspect-[4/5]">
                {f.status === "READY" && f.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.image.url} alt="" className="size-full object-cover" />
                ) : (
                  <GenCanvas seed={i} />
                )}
              </div>
              <div className="flex items-center justify-between gap-1.5 border-t border-line px-2.5 py-2 text-[13px]">
                <span className="text-fg-2">{t("avatar.face", { n: i + 1 })}</span>
                <span className="font-mono text-fg-3">{f.status === "READY" ? <Icon name="check" className="text-status-approved" /> : null}</span>
              </div>
            </div>
          ))}
        </div>
      </>
    )
  } else {
    grid = (
      <>
        {failedBatch ? (
          <Banner
            kind="error"
            title={code === "SAFETY_BLOCK" ? t("avatar.blockedTitle") : t("avatar.failedTitle")}
            body={`${failedBatch.faces[0]?.failReason ?? errorMessage(code)}${shown.length ? ` ${t("avatar.kept")}` : ""}`}
            actions={
              <Button size="sm" disabled={generate.isPending || description.trim().length < 10} onClick={() => generate.mutate()}>
                <Icon name="refresh" />
                {t("avatar.tryAgain")}
              </Button>
            }
          />
        ) : null}
        {shown.length ? (
          <RadioGroupPrimitive.Root
            value={selectedId ?? ""}
            onValueChange={(v) => {
              const f = shown.find((x) => x.id === v)
              if (f) select.mutate(f)
            }}
            aria-label={t("avatar.title")}
            className={cn(GRID, failedBatch && "opacity-60")}
          >
            {shown.map((f, i) => (
              <RadioGroupPrimitive.Item
                key={f.id}
                value={f.id}
                disabled={f.status !== "READY" || select.isPending}
                className="relative grid min-w-0 overflow-hidden rounded-lg border border-line bg-surface p-0 text-left data-[state=checked]:border-fg data-[state=checked]:shadow-[0_0_0_1px_var(--fg)] disabled:cursor-not-allowed"
              >
                <div className="aspect-[4/5]">
                  {f.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.image.url} alt={t("avatar.face", { n: i + 1 })} className="size-full object-cover object-[50%_35%]" />
                  ) : null}
                </div>
                {f.id === selectedId ? (
                  <span className="absolute top-2 right-2 grid size-[22px] place-items-center rounded-full bg-fg text-bg">
                    <Icon name="check" />
                  </span>
                ) : null}
                <div className="flex items-center justify-between gap-1.5 border-t border-line px-2.5 py-2 text-[13px]">
                  <span>{t("avatar.face", { n: i + 1 })}</span>
                  <span className="text-fg-3">{f.id === selectedId ? t("avatar.selected") : ""}</span>
                </div>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
        ) : !failedBatch ? (
          <Memo icon="info">{t("avatar.empty")}</Memo>
        ) : null}
      </>
    )
  }

  return (
    <WizardFrame
      creative={creative}
      viewing="avatar"
      live={live}
      actionbar={
        <ActionBar
          hint={generating ? null : selectedFace ? t("avatar.hint", { n: faceNo(selectedFace) }) : t("avatar.hintNone")}
          back={{ href: stepHref(id, "scripts") }}
          primary={
            <Button data-primary variant="default" disabled={generating || !selectedId} onClick={() => router.push(stepHref(id, "engine"))}>
              {t("continueTo", { step: tSteps("engine") })}
            </Button>
          }
        />
      }
    >
      <WzHead title={t("avatar.title")} sub={t("avatar.sub", { letter: creative.summary.scriptLetter ?? "" })} />
      {q.isError ? (
        <Banner kind="error" title={errorMessage(q.error)} actions={<Button size="sm" onClick={() => q.refetch()}>{tc("retry")}</Button>} />
      ) : null}
      <Panel>
        <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-2 tablet:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="who">{t("avatar.who")}</Label>
            <Textarea id="who" rows={2} value={description} maxLength={600} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <FaceCountControl
            count={count}
            onChange={setCount}
            unitPriceUsd={q.data?.faceUnitPriceUsd}
            disabled={generating || generate.isPending}
            action={
              <Button disabled={generating || generate.isPending || description.trim().length < 10} onClick={() => generate.mutate()}>
                <Icon name="refresh" />
                {t("avatar.generate", { n: count })}
              </Button>
            }
          />
        </div>
      </Panel>
      {grid}
      {dialog}
    </WizardFrame>
  )
}
