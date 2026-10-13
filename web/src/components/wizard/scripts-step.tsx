"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { CreativeDetail, Script } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checklist, checklistStates, ThinkingOrb } from "@/components/fx"
import { Icon } from "@/components/icon"
import { Tag } from "@/components/page"
import { StatusChip } from "@/components/status-chip"
import { qk } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useLanguageName } from "@/hooks/use-language-name"
import { cn } from "@/lib/utils"
import { ActionBar, stepHref, WizardFrame, WzHead } from "./shell"
import { Banner, Memo, mmss, useConfirmReset } from "./common"

function toastOk(msg: string) {
  toast(
    <>
      <Icon name="check" />
      {msg}
    </>
  )
}

function ScriptCard({
  s, selected, onUse, onRegenerate, onSave, busy,
}: {
  s: Script; selected: boolean; busy: boolean
  onUse: () => void; onRegenerate: () => void; onSave: (speeches: string[]) => Promise<unknown>
}) {
  const t = useTranslations("wizard.scripts")
  const tc = useTranslations("common")
  const [editing, setEditing] = useState<string[] | null>(null)
  const hook = s.blocks[0]
  const rest = s.blocks.slice(1)
  return (
    <article className={cn("flex min-w-0 flex-col rounded-lg border bg-surface", selected ? "border-fg" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
        <span className="font-mono font-medium">{t("label", { letter: s.letter })}</span>
        {s.angle ? <Tag>{s.angle}</Tag> : null}
        <span className="ml-auto font-mono text-xs text-fg-2">{t("blocks", { sec: s.durationSec ?? 0, count: s.blocks.length })}</span>
      </div>
      {hook ? (
        <div className="mx-3.5 mt-2.5 rounded-sm border border-line bg-surface-2 p-3">
          <span className="step-lbl mb-1 block">
            {hook.label} · {mmss(hook.startSec)}–{mmss(hook.endSec)}
          </span>
          {editing ? (
            <Textarea aria-label={hook.label} rows={2} className="text-base font-semibold" value={editing[0]} onChange={(e) => setEditing(editing.map((x, i) => (i === 0 ? e.target.value : x)))} />
          ) : (
            <p className="text-[17px] leading-[1.35] font-semibold tracking-[-0.01em]">{hook.speech}</p>
          )}
        </div>
      ) : null}
      <ol className="m-0 grid list-none px-3.5 pt-2.5 pb-1">
        {rest.map((b, i) => (
          <li key={i} className="grid grid-cols-[74px_minmax(0,1fr)] gap-2.5 border-t border-line py-2 text-[13px] first:border-t-0 tablet:grid-cols-[86px_minmax(0,1fr)]">
            <span className="grid content-start gap-0.5 font-mono text-xs text-fg-3">
              <b className={cn("font-sans text-xs font-medium", i === rest.length - 1 ? "text-fg" : "text-fg-2")}>{b.label}</b>
              {mmss(b.startSec)}–{mmss(b.endSec)}
            </span>
            {editing ? (
              <Textarea aria-label={b.label} rows={2} className="min-h-[52px] px-2 py-1.5 text-[13px]" value={editing[i + 1]} onChange={(e) => setEditing(editing.map((x, j) => (j === i + 1 ? e.target.value : x)))} />
            ) : (
              <span>{b.speech}</span>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-auto flex flex-wrap items-center gap-2 px-3.5 pt-2.5 pb-3.5">
        {editing ? (
          <>
            <Button size="sm" onClick={() => setEditing(null)}>
              {tc("cancel")}
            </Button>
            <span className="ml-auto" />
            <Button size="sm" variant="default" disabled={busy} onClick={() => onSave(editing).then((r) => r !== null && setEditing(null))}>
              {t("saveChanges")}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(s.blocks.map((b) => b.speech))}>
              <Icon name="pencil" />
              {t("edit")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onRegenerate}>
              <Icon name="refresh" />
              {t("regenerate")}
            </Button>
            <span className="ml-auto" />
            {selected ? (
              <StatusChip status="approved">{t("selected")}</StatusChip>
            ) : (
              <Button size="sm" disabled={busy} onClick={onUse}>
                {t("use")}
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  )
}

function StreamingCard({ s }: { s: Script }) {
  const t = useTranslations("wizard.scripts")
  const text = s.blocks[0]?.speech ?? ""
  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
        <span className="font-mono font-medium">{t("label", { letter: s.letter })}</span>
        {s.angle ? <Tag>{s.angle}</Tag> : null}
      </div>
      <div className="mx-3.5 mt-2.5 rounded-sm border border-line bg-surface-2 p-3">
        <span className="step-lbl mb-1 block">{s.blocks[0]?.label ?? "Hook"}</span>
        <p className="stream text-[17px] leading-[1.35] font-semibold tracking-[-0.01em]">{text}</p>
      </div>
      <div className="grid gap-2 p-3.5">
        <span className="sk h-2.5 w-[90%]" />
        <span className="sk h-2.5 w-3/4" />
        <span className="sk h-2.5 w-[82%]" />
      </div>
    </article>
  )
}

function SkeletonCard() {
  return (
    <article className="rounded-lg border border-line bg-surface opacity-50">
      <div className="grid gap-2.5 p-3.5">
        <span className="sk h-3 w-2/5" />
        <span className="sk h-12" />
        <span className="sk h-2.5 w-4/5" />
      </div>
    </article>
  )
}

/** Step 2 · Scripts (spec §5.2): writing (orb + checklist + streaming), ready, partial, failed. */
export function ScriptsStep({ creative, live }: { creative: CreativeDetail; live: "connecting" | "open" | "retrying" }) {
  const t = useTranslations("wizard")
  const tSteps = useTranslations("steps")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const lang = useLanguageName()
  const router = useRouter()
  const qc = useQueryClient()
  const { run, dialog } = useConfirmReset()
  const id = creative.id
  const q = useQuery({ queryKey: qk.scripts(id), queryFn: () => api.scripts.list(id) })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.scripts(id) })
    qc.invalidateQueries({ queryKey: qk.creative(id) })
  }
  const onError = (e: unknown) => toast(errorMessage(e))
  const generate = useMutation({
    mutationFn: (b: { count: number; replace: boolean }) => run((confirm) => api.scripts.generate(id, { ...b, confirm: confirm || undefined })),
    onSuccess: refresh,
    onError,
  })
  const regenerate = useMutation({
    mutationFn: (s: Script) => run((confirm) => api.scripts.regenerate(id, s.id, { confirm: confirm || undefined })),
    onSuccess: (r, s) => {
      if (r) toastOk(t("scripts.rewriting", { letter: s.letter }))
      refresh()
    },
    onError,
  })
  const select = useMutation({
    mutationFn: (s: Script) => run((confirm) => api.scripts.select(id, s.id, { confirm: confirm || undefined })),
    onSuccess: (d) => {
      if (d) qc.setQueryData(qk.creative(id), d)
      refresh()
    },
    onError,
  })
  const save = useMutation({
    mutationFn: ({ s, speeches }: { s: Script; speeches: string[] }) =>
      run((confirm) =>
        api.scripts.update(id, s.id, {
          blocks: speeches.map((speech, index) => ({ index, speech })).filter((b) => b.speech !== s.blocks[b.index]?.speech),
          confirm: confirm || undefined,
        })
      ),
    onSuccess: (r, v) => {
      if (r) toastOk(t("scripts.savedToast", { letter: v.s.letter }))
      refresh()
    },
    onError,
  })
  const busy = generate.isPending || regenerate.isPending || select.isPending || save.isPending

  const data = q.data
  const scripts = data?.scripts ?? []
  const ready = scripts.filter((s) => s.status === "READY")
  const writingList = scripts.filter((s) => s.status === "WRITING")
  const failedList = scripts.filter((s) => s.status === "FAILED")
  const writing = creative.state === "SCRIPTS_WRITING" || writingList.length > 0
  const job = data?.job
  const partial = !writing && job?.status === "PARTIAL" && failedList.length > 0
  const failedAll = !writing && creative.state === "SCRIPTS_FAILED"
  const selected = scripts.find((s) => s.selected && s.status === "READY")
  const winners = (data?.winnersUsed ?? []).filter((w) => w.sameOffer)

  let body: React.ReactNode
  if (q.isPending) {
    body = (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 tablet:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  } else if (q.isError) {
    body = <Banner kind="error" title={errorMessage(q.error)} actions={<Button size="sm" onClick={() => q.refetch()}><Icon name="refresh" />{tc("retry")}</Button>} />
  } else if (writing) {
    const now = writingList.find((s) => (s.blocks[0]?.speech ?? "").length > 0) ?? writingList[0]
    const queued = writingList.filter((s) => s !== now)
    const cl = job?.checklist ?? [{ key: "reading_brief", done: false }, { key: "studying_winners", done: false }, { key: "writing", done: false }]
    const st = checklistStates(cl.map((c) => c.done))
    const items = cl.map((c, i) => ({
      state: st[i],
      label:
        c.key === "reading_brief" ? t("scripts.readBrief", { offer: creative.offer.name })
        : c.key === "studying_winners" ? t("scripts.studiedWinners", { count: winners.length })
        : now ? (now.angle ? t("scripts.writingOne", { letter: now.letter, angle: now.angle.toLowerCase() }) : t("scripts.writingAny")) : t("scripts.writingAny"),
    }))
    if (queued.length) items.push({ state: "todo", label: t("scripts.queued", { count: queued.length, letters: queued.map((s) => s.letter).join(", ") }) })
    body = (
      <>
        <div className="flex flex-wrap items-center gap-5 rounded-lg border border-line bg-surface p-5" role="status">
          <ThinkingOrb />
          <div className="grid min-w-[200px] flex-1 gap-2.5">
            <b className="font-semibold">{t("scripts.writingTitle", { done: ready.length, total: scripts.length || 4 })}</b>
            <Checklist items={items} />
            <span className="text-[13px] text-fg-2">{t("scripts.leave")}</span>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 tablet:grid-cols-2">
          {scripts.map((s) =>
            s.status === "READY" ? (
              <ScriptCard key={s.id} s={s} selected={false} busy onUse={() => undefined} onRegenerate={() => undefined} onSave={async () => null} />
            ) : s.status === "WRITING" && s === now ? (
              <StreamingCard key={s.id} s={s} />
            ) : s.status === "WRITING" ? (
              <SkeletonCard key={s.id} />
            ) : null
          )}
        </div>
      </>
    )
  } else {
    body = (
      <>
        {partial ? (
          <Banner
            kind="error"
            title={t("scripts.partialTitle", { ready: ready.length, total: ready.length + failedList.length })}
            body={t("scripts.partialBody", { reason: failedList[0]?.failReason ?? job?.failReason ?? "", ready: ready.length, missing: failedList.length })}
            actions={
              <Button size="sm" disabled={busy} onClick={() => generate.mutate({ count: failedList.length, replace: false })}>
                <Icon name="refresh" />
                {t("scripts.writeOther", { count: failedList.length })}
              </Button>
            }
          />
        ) : null}
        {failedAll ? (
          <Banner
            kind="error"
            title={t("scripts.failedTitle")}
            body={failedList[0]?.failReason ?? job?.failReason ?? errorMessage(job?.errorCode)}
            actions={
              <Button size="sm" disabled={busy} onClick={() => generate.mutate({ count: 4, replace: true })}>
                <Icon name="refresh" />
                {t("scripts.tryAgain")}
              </Button>
            }
          />
        ) : null}
        {!partial && !failedAll && winners.length ? (
          <Memo icon="star">
            {t.rich("scripts.informedBy", {
              count: winners.length,
              names: winners.map((w) => `“${w.name}”`).join(", "),
              b: (c) => <b>{c}</b>,
            })}
          </Memo>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 tablet:grid-cols-2">
          {ready.map((s) => (
            <ScriptCard
              key={s.id}
              s={s}
              selected={s.selected}
              busy={busy}
              onUse={() => select.mutate(s)}
              onRegenerate={() => regenerate.mutate(s)}
              onSave={(speeches) => save.mutateAsync({ s, speeches }).catch(() => null)}
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <WizardFrame
      creative={creative}
      viewing="scripts"
      live={live}
      actionbar={
        <ActionBar
          hint={writing ? null : selected ? t("scripts.hint", { letter: selected.letter, sec: selected.durationSec ?? 0 }) : t("scripts.hintNone")}
          back={{ href: stepHref(id, "offer") }}
          primary={
            <Button data-primary variant="default" disabled={writing || !selected} onClick={() => router.push(stepHref(id, "avatar"))}>
              {t("continueTo", { step: tSteps("avatar") })}
            </Button>
          }
        />
      }
    >
      <WzHead
        title={t("scripts.title")}
        sub={t("scripts.sub", { count: Math.max(scripts.length, 1), offer: creative.offer.name, language: lang(creative.language) })}
        aside={
          !writing && !failedAll && ready.length ? (
            <Button disabled={busy} onClick={() => generate.mutate({ count: 4, replace: true })}>
              <Icon name="refresh" />
              {t("scripts.regenerateAll")}
            </Button>
          ) : null
        }
      />
      {body}
      {dialog}
    </WizardFrame>
  )
}
