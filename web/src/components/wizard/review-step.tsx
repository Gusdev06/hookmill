"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { ChangeRequestBody, ChangeType, CreativeDetail } from "@/lib/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { Panel, PanelHead } from "@/components/page"
import { VideoPlayer } from "@/components/video-player"
import { qk } from "@/hooks/use-creative"
import { setToastPosition } from "@/lib/toast-position"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { useChampion } from "@/hooks/use-variar"
import { isMetaOff, useMetaConnection } from "@/hooks/use-meta"
import { VariationLine } from "@/components/variar/variation-line"
import { EditedBadge, editorHref } from "@/components/editor/entry"
import { EdIcon } from "@/components/editor/ed-icon"
import { stepHref, useFaceNumber, WizardFrame } from "./shell"
import { Banner, Memo, mmss, RadioDot, useMoney } from "./common"

const ORDER: ChangeType[] = ["SCENE", "TEXT", "LINE", "FACE"]
const FORMAT_SHORT = { VERTICAL_9_16: "9:16", PORTRAIT_4_5: "4:5", SQUARE_1_1: "1:1" } as const

/** Step 7 · Final OK (spec §5.7): the video is the protagonist; Request changes = 4 closed paths + note. */
export function ReviewStep({ creative, live }: { creative: CreativeDetail; live: "connecting" | "open" | "retrying" }) {
  const t = useTranslations("wizard")
  const tv = useTranslations("variar")
  const tSteps = useTranslations("steps")
  const tc = useTranslations("common")
  const tEd = useTranslations("editor.entry")
  const errorMessage = useErrorMessage()
  const money = useMoney()
  const router = useRouter()
  const qc = useQueryClient()
  const id = creative.id
  const faceN = useFaceNumber(creative)
  const q = useQuery({ queryKey: qk.review(id), queryFn: () => api.review.get(id), retry: false })
  const scenes = useQuery({ queryKey: qk.scenes(id), queryFn: () => api.scenes.list(id) })
  const [open, setOpen] = useState(false)
  // feature 2: a variation compares against its winner without leaving the Final OK (spec §2.11)
  const v = creative.variation
  const champ = useChampion(v?.championId ?? null)
  const [cmp, setCmp] = useState<"variation" | "original">("variation")
  // meta-v1 §3.3: an approved video goes to Send → "Publish to Meta" (hidden when the server has no Meta)
  const metaConn = useMetaConnection()
  const metaOff = metaConn.isError && isMetaOff(metaConn.error)
  // QA bug 05/10: at 390 a bottom toast covered the name/facts; on the Final OK toasts go to the top
  useEffect(() => {
    setToastPosition("top")
    return () => setToastPosition("bottom")
  }, [])
  const [picked, setType] = useState<ChangeType>("SCENE")
  const [sceneIndex, setSceneIndex] = useState(0)
  const [line, setLine] = useState<string | null>(null)
  const [note, setNote] = useState("")

  const approve = useMutation({
    mutationFn: () => api.review.approve(id),
    onSuccess: (d) => {
      qc.setQueryData(qk.creative(id), d)
      qc.invalidateQueries({ queryKey: ["library"] })
      qc.invalidateQueries({ queryKey: ["creatives"] })
      toast(
        <>
          <Icon name="check" />
          {t("review.approved")}
        </>
      )
      router.push(`/library?new=${encodeURIComponent(id)}`)
    },
    onError: (e) => toast(errorMessage(e)),
  })
  const changes = useMutation({
    mutationFn: () => {
      const n = note.trim() || undefined
      const sceneSpeech = scenes.data?.scenes.find((s) => s.index === sceneIndex)?.speech ?? ""
      const body: ChangeRequestBody =
        type === "SCENE" ? { type, sceneIndex, note: n }
        : type === "LINE" ? { type, sceneIndex, newSpeech: (line ?? sceneSpeech).trim(), note: n }
        : { type, note: n }
      return api.review.requestChanges(id, body)
    },
    onSuccess: (r) => {
      qc.setQueryData(qk.creative(id), r.creative)
      for (const k of [qk.scenes(id), qk.edit(id), qk.faces(id), qk.review(id)]) qc.invalidateQueries({ queryKey: k })
      qc.invalidateQueries({ queryKey: ["creatives"] })
      toast(
        <>
          <Icon name="check" />
          {t("review.sent", { step: tSteps(r.returnTo) })}
        </>
      )
      router.push(stepHref(id, r.returnTo))
    },
    onError: (e) => toast(errorMessage(e)),
  })

  const notReady = q.isError && isApiError(q.error) && q.error.status === 409
  const data = q.data
  // api.md §12: changeOptions comes filtered per creative; only those paths are shown
  const offered = ORDER.filter((ty) => data?.changeOptions.some((o) => o.type === ty))
  const type: ChangeType = offered.includes(picked) ? picked : (offered[0] ?? "SCENE")
  const take = !!creative.take
  const label = (ty: ChangeType) => (take && ty === "SCENE" ? t("review.SCENE_take") : t(`review.${ty}`))
  const desc = (ty: ChangeType) => (take && ty === "SCENE" ? t("review.SCENE_take_desc") : take && ty === "LINE" ? t("review.LINE_take_desc") : t(`review.${ty}_desc`))
  const opt = data?.changeOptions.find((o) => o.type === type)
  const sceneList = scenes.data?.scenes ?? []
  const sel = sceneList.find((s) => s.index === sceneIndex)

  let body: React.ReactNode
  if (notReady) {
    body = (
      <div className="grid gap-3">
        <Memo icon="info">{t("review.notReady")}</Memo>
        <div>
          <Link href={stepHref(id, creative.step === "library" ? "review" : creative.step)} className={buttonVariants()}>
            {t("review.openStep", { step: tSteps(creative.step === "library" ? "review" : creative.step) })}
          </Link>
        </div>
      </div>
    )
  } else if (q.isError) {
    body = <Banner kind="error" title={errorMessage(q.error)} actions={<Button size="sm" onClick={() => q.refetch()}>{tc("retry")}</Button>} />
  } else if (!data) {
    body = (
      <div className="grid gap-4">
        <span className="sk mx-auto aspect-[9/16] w-full max-w-[400px] rounded-xl" />
        <span className="sk h-10" />
      </div>
    )
  } else {
    const f = data.facts
    const approved = creative.state === "APPROVED"
    body = (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {v ? (
          <div className="grid justify-items-center gap-3">
            <Link href={`/variations/${encodeURIComponent(v.championId)}/batch?batch=${encodeURIComponent(v.batchId)}`} className="inline-flex items-center gap-1.5 justify-self-start text-[13px] text-fg-2 hover:text-fg">
              <Icon name="left" />
              {tv("review.backToBatch")}
            </Link>
            <ToggleGroup type="single" value={cmp} onValueChange={(x) => x && setCmp(x as typeof cmp)} aria-label={tv("review.variation")}>
              <ToggleGroupItem value="variation">{tv("review.variation")}</ToggleGroupItem>
              <ToggleGroupItem value="original" disabled={!champ.data?.video}>
                {tv("review.original")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        ) : null}
        <div className="grid min-w-0 place-items-center rounded-xl tablet:border tablet:border-line tablet:bg-stage tablet:p-5">
          {v && cmp === "original" && champ.data?.video ? (
            <VideoPlayer key="original" video={champ.data.video} poster={champ.data.thumbnail?.url} size="lg" />
          ) : (
            <VideoPlayer key="variation" video={data.video} poster={creative.thumbnail?.url} format={f.format} size="lg" />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid w-full min-w-0 gap-1 tablet:w-auto">
            <h2>{creative.name}</h2>
            {v ? <VariationLine v={v} /> : null}
            {creative.editedInEditor ? <div><EditedBadge variation={!!v} /></div> : null}
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-fg-2">
              <span>{f.offerName}</span>
              <span>
                {t("script")} {f.scriptLetter}
              </span>
              <span>
                {t("face")} {faceN ?? "—"}
              </span>
              <span>{f.engineLabel}</span>
              <span className="font-mono">
                {mmss(f.durationSec)} · {FORMAT_SHORT[f.format]}
              </span>
              <span className="font-mono">{money(f.costUsd)}</span>
            </div>
          </div>
          {approved ? (
            metaOff ? null : (
              <div className="flex w-full flex-wrap gap-2 tablet:w-auto">
                <Link href={`/creatives/${encodeURIComponent(creative.id)}/send`} className={buttonVariants({ size: "lg", variant: "brand", className: "w-full tablet:w-auto" })}>
                  {t("review.publishMeta")}
                  <Icon name="arrowr" />
                </Link>
              </div>
            )
          ) : (
            <div className="flex w-full flex-wrap gap-2 tablet:w-auto [&>button]:flex-1 tablet:[&>button]:flex-none">
              {creative.editSettings?.templateId !== "remix-keep" ? (
                <Link href={editorHref(creative.id)} className={buttonVariants({ size: "lg", variant: "ghost", className: "w-full tablet:w-auto" })}>
                  <EdIcon name="move" />
                  {tEd("title")}
                </Link>
              ) : null}
              <Button size="lg" aria-expanded={open} disabled={!offered.length} onClick={() => setOpen((o) => !o)}>
                {t("review.requestChanges")}
              </Button>
              <Button size="lg" variant="default" disabled={approve.isPending || creative.editDirty} onClick={() => approve.mutate()}>
                <Icon name="check" />
                {t("review.approve")}
              </Button>
            </div>
          )}
        </div>
        {!approved && !offered.length ? <Memo icon="info">{t("review.none")}</Memo> : null}
        {open && !approved && offered.length ? (
          <Panel>
            <PanelHead>
              <h2>{t("review.what")}</h2>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                <Icon name="x" />
                {tc("close")}
              </Button>
            </PanelHead>
            <div role="radiogroup" aria-label={t("review.what")} className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
              {offered.map((ty) => {
                const on = type === ty
                const o = data.changeOptions.find((x) => x.type === ty)
                return (
                  <div
                    key={ty}
                    role="radio"
                    aria-checked={on}
                    tabIndex={0}
                    onClick={() => setType(ty)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                        e.preventDefault()
                        setType(ty)
                      }
                    }}
                    className={cn("grid min-w-0 cursor-pointer gap-2 rounded-lg border bg-surface px-3.5 py-3 text-left", on ? "border-fg" : "border-line")}
                  >
                    <div className="flex items-start gap-2.5">
                      <RadioDot on={on} />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <b className="font-semibold">{label(ty)}</b>
                        <span className="text-[13px] text-fg-2">
                          {desc(ty)}
                          {o ? (
                            <span className="font-mono text-fg-3">
                              {" · "}
                              {o.estimateUsd > 0 ? t("review.cost", { cost: money(o.estimateUsd), min: Math.max(1, Math.round(o.etaSec / 60)) }) : t("review.free")}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </div>
                    {on && ((ty === "SCENE" && !take) || ty === "LINE") ? (
                      <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
                        <div>
                          <ToggleGroup
                            type="single"
                            value={String(sceneIndex)}
                            onValueChange={(v) => {
                              if (!v) return
                              setSceneIndex(Number(v))
                              setLine(null)
                            }}
                            aria-label={t("review.scene")}
                          >
                            {sceneList.map((s) => (
                              <ToggleGroupItem key={s.id} value={String(s.index)}>
                                {s.index + 1} · {s.label}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </div>
                        {ty === "LINE" ? (
                          <div className="grid gap-1.5">
                            <Label htmlFor="newline">{t("review.newLine", { n: sceneIndex + 1 })}</Label>
                            <Textarea id="newline" rows={2} value={line ?? sel?.speech ?? ""} onChange={(e) => setLine(e.target.value)} />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note">{t("review.note")}</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("review.notePlaceholder")} />
            </div>
            <div className="flex justify-end">
              <Button
                variant="default"
                disabled={changes.isPending || (type === "LINE" && !(line ?? sel?.speech ?? "").trim())}
                onClick={() => changes.mutate()}
              >
                {t("review.sendBack", { step: tSteps(opt?.returnsTo ?? "edit") })}
              </Button>
            </div>
          </Panel>
        ) : null}
      </div>
    )
  }

  return (
    <WizardFrame creative={creative} viewing="review" live={live}>
      {body}
    </WizardFrame>
  )
}
