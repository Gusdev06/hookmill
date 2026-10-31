"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { IterateAnswers, IterateBatch, IterateConfig, IterateGoal, IterateWant } from "@/lib/api/types"
import { ik, useIterateConfig } from "@/hooks/use-iterate"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useSession } from "@/components/providers/session-provider"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { choiceCardClass } from "@/components/ui/choice-card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Bar, Card, Head, IterActionBar, IterFlow, IterWrap, Tag } from "./parts"
import { SampleEyebrow } from "./sample"

const BASE: IterateAnswers = { goal: "auto", ai: "free_only", aiCapUsd: null, aiCapCredits: null, wants: [] }
const GOALS: IterateGoal[] = ["auto", "stretch", "new_audience", "both"]

export function GoalsScreen({ batch, onDone }: { batch: IterateBatch; onDone: () => void }) {
  const config = useIterateConfig()
  const t = useTranslations("iterate.goals")
  const errorMessage = useErrorMessage()
  if (!config.data) return <IterWrap><Head title={t("title")} /><Card role="status">{config.isError ? errorMessage(config.error) : t("loading")}</Card>{config.isError ? <Button onClick={() => config.refetch()}>{t("retry")}</Button> : null}</IterWrap>
  return <GoalsForm key={batch.id} batch={batch} config={config.data} onDone={onDone} />
}

function GoalsForm({ batch, config, onDone }: { batch: IterateBatch; config: IterateConfig; onDone: () => void }) {
  const t = useTranslations("iterate.goals")
  const ts = useTranslations("sample")
  const format = useFormatter()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  // amostra-gratis-v1 §2: the sample never asks Q2 (AI) and never offers STATIC (only free types)
  const aiEnabled = !batch.sample && (config.quiz?.aiEnabled ?? false)
  const saved = config.savedPreferences
  const initial = batch.answers ?? saved ?? BASE
  const clean = (a: IterateAnswers): IterateAnswers => aiEnabled ? a : { ...a, ai: "free_only", aiCapUsd: null, wants: a.wants.filter((w) => w !== "face" && w !== "format" && !(batch.sample && w === "static")) }
  const [answers, setAnswers] = useState<IterateAnswers>(() => clean(initial))
  const [step, setStep] = useState(0)
  const questions: ("goal" | "ai" | "wants")[] = aiEnabled ? ["goal", "ai", "wants"] : ["goal", "wants"]
  const question = questions[step]
  const ready = batch.status === "PLAN_READY"
  const save = useMutation({
    mutationFn: (a: IterateAnswers) => api.iterate.answers(batch.id, { answers: clean(a), save: true }),
    onMutate: () => qc.cancelQueries({ queryKey: ik.batch(batch.id) }),
    onSuccess: (b) => { qc.setQueryData(ik.batch(b.id), b); qc.invalidateQueries({ queryKey: ik.config }); onDone() },
  })
  const wants = (config.quiz?.wants ?? ["headline", "frames", "static", "chat_motion"]).filter((w) => (answers.ai !== "free_only" || (w !== "face" && w !== "format")) && !(batch.sample && w === "static"))
  const setWant = (want: IterateWant) => setAnswers((a) => ({ ...a, wants: a.wants.includes(want) ? a.wants.filter((w) => w !== want) : [...a.wants, want] }))
  const title = t(`question.${question}`)
  const badCap = answers.ai === "yes" && answers.aiCapUsd !== null && (answers.aiCapUsd < 1 || answers.aiCapUsd > 1000 || !Number.isFinite(answers.aiCapUsd))
  return <IterWrap>
    {/* review 29/10 F8: the same 3-step FlowBar from upload to download; "Question N of 2" below is the sub-step */}
    <IterFlow current="analyze" running={batch.status !== "PLAN_READY"} batchId={batch.id} />
    <Head eyebrow={batch.sample ? <SampleEyebrow /> : batch.source.name} title={t("title")} lede={t("lede")} />
    <Card role="status" className="gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{ready ? t("analysisReady") : t("analyzing")}</b><span className="font-mono text-xs text-fg-3">{batch.analysis.progress}%</span></div>
      <Bar value={batch.analysis.progress} label={t("analyzing")} />
    </Card>
    {saved && !batch.answers ? <Card className="gap-2">
      <p className="m-0 text-sm text-fg-2">{t("prefilled", { date: format.dateTime(new Date(saved.savedAt), { dateStyle: "medium" }) })}</p>
      <Button variant="outline" size="sm" className="self-start" disabled={save.isPending} onClick={() => save.mutate(clean(saved))}>{t("useSaved")}</Button>
    </Card> : null}
    <Card className="gap-5" aria-busy={save.isPending}>
      <div className="flex flex-col gap-1"><span className="eyebrow">{t("step", { n: step + 1, total: questions.length })}</span><h2 id="goals-question" className="text-xl">{title}</h2><p className="m-0 text-sm text-fg-3">{t(`help.${question}`)}</p></div>
      <fieldset aria-labelledby="goals-question" className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={save.isPending}>
        {/* F9: chosen = ink outline (choiceCardClass), shadcn radios/checkboxes instead of native inputs, focus = --ring */}
        {question === "goal" ? <RadioGroupPrimitive.Root value={answers.goal} onValueChange={(v) => setAnswers((a) => ({ ...a, goal: v as IterateGoal }))} aria-labelledby="goals-question" className="flex flex-col gap-2">
          {GOALS.map((goal) => <RadioGroupPrimitive.Item key={goal} value={goal} className={choiceCardClass(answers.goal === goal, "flex cursor-pointer items-start gap-3")}>
            <RadioDot on={answers.goal === goal} /><span><b className="block text-sm">{t(`goal.${goal}`)}</b><small className="text-fg-3">{t(`goalHelp.${goal}`)}</small></span>
          </RadioGroupPrimitive.Item>)}
        </RadioGroupPrimitive.Root> : null}
        {question === "ai" ? <>
          <RadioGroupPrimitive.Root value={answers.ai} onValueChange={(v) => { const ai = v as IterateAnswers["ai"]; setAnswers((a) => ({ ...a, ai, aiCapUsd: ai === "yes" ? 10 : null, wants: ai === "free_only" ? a.wants.filter((w) => w !== "face" && w !== "format") : a.wants })) }} aria-labelledby="goals-question" className="flex flex-col gap-2">
            {(["auto", "free_only", "yes"] as const).map((ai) => <RadioGroupPrimitive.Item key={ai} value={ai} className={choiceCardClass(answers.ai === ai, "flex cursor-pointer items-center gap-3")}>
              <RadioDot on={answers.ai === ai} /><span className="text-sm font-semibold">{t(`ai.${ai}`)}</span>
            </RadioGroupPrimitive.Item>)}
          </RadioGroupPrimitive.Root>
          {answers.ai === "yes" ? <div className="flex flex-col gap-1.5 text-sm"><label htmlFor="goals-cap" className="font-semibold">{t("cap")}</label><Input id="goals-cap" type="number" inputMode="decimal" min={1} max={1000} step="0.01" value={answers.aiCapUsd ?? ""} aria-invalid={badCap || undefined} aria-describedby={badCap ? "goals-cap-err" : undefined} onChange={(e) => setAnswers((a) => ({ ...a, aiCapUsd: e.target.value === "" ? null : Number(e.target.value) }))} />{badCap ? <span id="goals-cap-err" role="alert" className="text-xs text-status-failed">{t("capRange")}</span> : null}</div> : null}
        </> : null}
        {question === "wants" ? <>
          <label className={choiceCardClass(!answers.wants.length, "flex cursor-pointer items-start gap-3")}><Checkbox checked={!answers.wants.length} onCheckedChange={() => setAnswers((a) => ({ ...a, wants: [] }))} className="mt-0.5" /><span><b className="block text-sm">{t("chooseForMe")}</b><small className="text-fg-3">{t("chooseHelp")}</small></span></label>
          {wants.map((want) => <label key={want} className={choiceCardClass(answers.wants.includes(want), "flex cursor-pointer items-center gap-3")}><Checkbox checked={answers.wants.includes(want)} onCheckedChange={() => setWant(want)} /><span className="text-sm font-semibold">{t(`want.${want}`)}</span></label>)}
        </> : null}
      </fieldset>
      {save.isError ? <p role="alert" className="m-0 text-sm text-status-failed">{errorMessage(save.error)}</p> : null}
    </Card>
    <IterActionBar hint={batch.sample ? ts("goalsHint") : t("noExtraCost")}>
      {step > 0 ? <Button variant="outline" disabled={save.isPending} onClick={() => setStep((s) => s - 1)}>{t("back")}</Button> : <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(BASE)}>{t("chooseForMe")}</Button>}
      <Button variant="brand" disabled={save.isPending || badCap} onClick={() => step < questions.length - 1 ? setStep((s) => s + 1) : save.mutate(answers)}>{save.isPending ? t("saving") : step < questions.length - 1 ? t("continue") : t("seePlan")}</Button>
    </IterActionBar>
  </IterWrap>
}

/** The radio mark of /start (ink ring + dot), so a chosen card reads the same on every first-use screen. */
function RadioDot({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={cn("mt-0.5 inline-grid size-[18px] flex-none place-items-center rounded-full border-[1.5px]", on ? "border-fg" : "border-control")}>{on ? <span className="size-2 rounded-full bg-fg" /> : null}</span>
}

export function ClientPreferences({ batch, onEdit }: { batch: IterateBatch; onEdit: () => void }) {
  const t = useTranslations("iterate.goals")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const cfg = useIterateConfig()
  const a = batch.answers
  const forget = useMutation({ mutationFn: api.iterate.forgetPreferences, onSuccess: () => { qc.invalidateQueries({ queryKey: ik.config }); toast(t("forgotten")) }, onError: (e) => toast(errorMessage(e)) })
  if (!a) return null
  return <Card className="gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2>{t("preferences")}</h2>{session.workspace.role !== "CLIENT" ? <Button variant="ghost" size="sm" onClick={onEdit}>{t("edit")}</Button> : null}</div>
    <div className="flex flex-wrap gap-2"><Tag tone="neutral">{t(`goal.${a.goal}`)}</Tag>{(a.wants.length ? a.wants.map((w) => t(`want.${w}`)) : [t("chooseForMe")]).map((label) => <Tag tone="neutral" key={label}>{label}</Tag>)}</div>
    {batch.selectionInfo?.goalReasonKey === "auto_default" ? <p className="m-0 text-xs text-fg-3">{t("autoReason")}</p> : null}
    {cfg.data?.savedPreferences && ["OWNER", "ADMIN"].includes(session.workspace.role) ? <Button size="sm" variant="ghost" className="self-start" disabled={forget.isPending} onClick={() => forget.mutate()}>{t("forget")}</Button> : null}
  </Card>
}

export function SelectPieceButton({ batchId, pieceId, included, disabled }: { batchId: string; pieceId: string; included: boolean; disabled?: boolean }) {
  const t = useTranslations("iterate.goals")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const select = useMutation({
    mutationFn: () => api.iterate.select(batchId, pieceId, included),
    onMutate: () => qc.cancelQueries({ queryKey: ik.batch(batchId) }),
    onSuccess: (b) => { qc.setQueryData(ik.batch(b.id), b) },
    onError: (e) => { toast(errorMessage(e)); qc.invalidateQueries({ queryKey: ik.batch(batchId) }) },
  })
  if (session.workspace.role === "CLIENT") return null
  return <Button variant="ghost" size="sm" disabled={disabled || select.isPending} onClick={() => select.mutate()} aria-busy={select.isPending}>{included ? t("addBack") : t("remove")}</Button>
}

export function LeftOut({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("iterate.goals")
  if (!batch.notSelected?.length) return null
  return <Card><h2>{t("leftOut")}</h2><p className="m-0 text-sm text-fg-3">{t("leftOutHelp")}</p>{batch.notSelected.map((p) => <div key={p.id} className="flex items-center justify-between gap-3 border-t border-line-soft pt-3"><span className="min-w-0 text-sm"><b>{p.code}</b><span className="mt-1 block text-fg-3">{p.change}</span></span><SelectPieceButton batchId={batch.id} pieceId={p.id} included disabled={batch.pieces.length >= 12} /></div>)}{batch.pieces.length >= 12 ? <p className="m-0 text-xs text-fg-3">{t("full")}</p> : null}</Card>
}
