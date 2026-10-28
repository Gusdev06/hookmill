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
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Bar, Card, Head, IterActionBar, IterWrap, Tag } from "./parts"

const BASE: IterateAnswers = { goal: "auto", ai: "free_only", aiCapUsd: null, aiCapCredits: null, wants: [] }
const GOALS: IterateGoal[] = ["auto", "stretch", "new_audience", "both"]

export function GoalsFlow({ current }: { current: "goals" | "plan" }) {
  const t = useTranslations("iterate.goals")
  return <nav aria-label={t("flowLabel")} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
    {(["winner", "goals", "plan", "generate", "pieces"] as const).map((step, i) => <span key={step} aria-current={step === current ? "step" : undefined} className={cn("flex items-center gap-3", step === current && "font-semibold text-fg")}>
      {i ? <span aria-hidden="true">›</span> : null}{t(`flow.${step}`)}
    </span>)}
  </nav>
}

export function GoalsScreen({ batch, onDone }: { batch: IterateBatch; onDone: () => void }) {
  const config = useIterateConfig()
  const t = useTranslations("iterate.goals")
  const errorMessage = useErrorMessage()
  if (!config.data) return <IterWrap><Head title={t("title")} /><Card role="status">{config.isError ? errorMessage(config.error) : t("loading")}</Card>{config.isError ? <Button onClick={() => config.refetch()}>{t("retry")}</Button> : null}</IterWrap>
  return <GoalsForm key={batch.id} batch={batch} config={config.data} onDone={onDone} />
}

function GoalsForm({ batch, config, onDone }: { batch: IterateBatch; config: IterateConfig; onDone: () => void }) {
  const t = useTranslations("iterate.goals")
  const format = useFormatter()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const aiEnabled = config.quiz?.aiEnabled ?? false
  const saved = config.savedPreferences
  const initial = batch.answers ?? saved ?? BASE
  const clean = (a: IterateAnswers): IterateAnswers => aiEnabled ? a : { ...a, ai: "free_only", aiCapUsd: null, wants: a.wants.filter((w) => w !== "face" && w !== "format") }
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
  const wants = (config.quiz?.wants ?? ["headline", "frames", "static", "chat_motion"]).filter((w) => answers.ai !== "free_only" || (w !== "face" && w !== "format"))
  const setWant = (want: IterateWant) => setAnswers((a) => ({ ...a, wants: a.wants.includes(want) ? a.wants.filter((w) => w !== want) : [...a.wants, want] }))
  const title = t(`question.${question}`)
  const badCap = answers.ai === "yes" && answers.aiCapUsd !== null && (answers.aiCapUsd < 1 || answers.aiCapUsd > 1000 || !Number.isFinite(answers.aiCapUsd))
  return <IterWrap>
    <GoalsFlow current="goals" />
    <Head eyebrow={batch.source.name} title={t("title")} lede={t("lede")} />
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
        {question === "goal" ? GOALS.map((goal) => <label key={goal} className={choiceClass(answers.goal === goal)}>
          <input type="radio" name="iterate-goal" value={goal} checked={answers.goal === goal} onChange={() => setAnswers((a) => ({ ...a, goal }))} className="mt-0.5 accent-black" /><span><b className="block text-sm">{t(`goal.${goal}`)}</b><small className="text-fg-3">{t(`goalHelp.${goal}`)}</small></span>
        </label>) : null}
        {question === "ai" ? <>
          {(["auto", "free_only", "yes"] as const).map((ai) => <label key={ai} className={choiceClass(answers.ai === ai)}><input type="radio" name="iterate-ai" checked={answers.ai === ai} onChange={() => setAnswers((a) => ({ ...a, ai, aiCapUsd: ai === "yes" ? 10 : null, wants: ai === "free_only" ? a.wants.filter((w) => w !== "face" && w !== "format") : a.wants }))} className="mt-0.5 accent-black" /><span className="text-sm font-semibold">{t(`ai.${ai}`)}</span></label>)}
          {answers.ai === "yes" ? <label className="flex flex-col gap-1.5 text-sm">{t("cap")}<input type="number" min={1} max={1000} step="0.01" value={answers.aiCapUsd ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, aiCapUsd: e.target.value === "" ? null : Number(e.target.value) }))} className="w-full rounded-md border border-control bg-card px-3 py-2" />{badCap ? <span role="alert">{t("capRange")}</span> : null}</label> : null}
        </> : null}
        {question === "wants" ? <>
          <label className={choiceClass(!answers.wants.length)}><input type="checkbox" checked={!answers.wants.length} onChange={() => setAnswers((a) => ({ ...a, wants: [] }))} className="mt-0.5 accent-black" /><span><b className="block text-sm">{t("chooseForMe")}</b><small className="text-fg-3">{t("chooseHelp")}</small></span></label>
          {wants.map((want) => <label key={want} className={choiceClass(answers.wants.includes(want))}><input type="checkbox" checked={answers.wants.includes(want)} onChange={() => setWant(want)} className="mt-0.5 accent-black" /><span className="text-sm font-semibold">{t(`want.${want}`)}</span></label>)}
        </> : null}
      </fieldset>
      {save.isError ? <p role="alert" className="m-0 text-sm text-status-failed">{errorMessage(save.error)}</p> : null}
    </Card>
    <IterActionBar hint={t("noExtraCost")}>
      {step > 0 ? <Button variant="outline" disabled={save.isPending} onClick={() => setStep((s) => s - 1)}>{t("back")}</Button> : <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(BASE)}>{t("chooseForMe")}</Button>}
      <Button variant="brand" disabled={save.isPending || badCap} onClick={() => step < questions.length - 1 ? setStep((s) => s + 1) : save.mutate(answers)}>{save.isPending ? t("saving") : step < questions.length - 1 ? t("continue") : t("seePlan")}</Button>
    </IterActionBar>
  </IterWrap>
}

const choiceClass = (checked: boolean) => cn("flex cursor-pointer items-start gap-3 rounded-lg border p-4 focus-within:ring-2 focus-within:ring-fg", checked ? "border-brand-edge bg-brand-soft" : "border-line bg-card hover:bg-card-2")

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
