"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { ChampionDetail, Section, Teardown, TeardownSectionKey, TeardownSections } from "@/lib/api/types"
import { variarHref } from "@/lib/routes"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checklist, ThinkingOrb } from "@/components/fx"
import { Icon } from "@/components/icon"
import { Panel, PanelHead, Tag } from "@/components/page"
import { VideoPlayer } from "@/components/video-player"
import { ActionBar, WzHead } from "@/components/wizard/shell"
import { Banner, Memo, mmss, useMoney } from "@/components/wizard/common"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useLanguageName } from "@/hooks/use-language-name"
import { useChampionConfig, vk } from "@/hooks/use-variar"
import { cn } from "@/lib/utils"
import { VariarFrame } from "./frame"
import { aspect } from "./upload"
import { EditMapPanel } from "./keep-edit"

const FUNCTIONS = ["hook", "problem", "mechanism", "proof", "cta"] as const
type Field = { key: string; kind: "text" | "lines" | "pairs" }
type Row = { id: string; section: TeardownSectionKey; fields: Field[]; summary: (s: TeardownSections, td: Teardown) => string | null }

const txt = (...keys: string[]): Field[] => keys.map((key) => ({ key, kind: "text" }))
/** The rows of the mockup, mapped onto the 12 contract sections (identification → facts line, whySells.verdict → "Why it sells"). */
const ROWS: Row[] = [
  { id: "audience", section: "whySells", fields: txt("avatar", "awarenessLevel", "painDesire", "bigIdea", "beliefObjection", "retentionEngine"), summary: (s) => s.whySells.data?.awarenessLevel ?? null },
  { id: "hook", section: "hook", fields: txt("spoken", "onScreenText", "visual"), summary: (s) => s.hook.data?.spoken || s.hook.data?.onScreenText || null },
  { id: "structure", section: "structure", fields: [], summary: () => null },
  { id: "transcript", section: "transcript", fields: [], summary: () => null },
  { id: "copy", section: "metaCopy", fields: txt("primaryText", "headline", "description", "button", "link"), summary: (s) => s.metaCopy.data?.headline ?? s.metaCopy.data?.primaryText ?? null },
  { id: "layout", section: "layout", fields: txt("summary"), summary: (s) => s.layout.data?.summary ?? null },
  { id: "colors", section: "visual", fields: txt("person", "broll", "motion"), summary: (s) => s.visual.data?.palette.map((p) => p.role).slice(0, 3).join(", ") ?? null },
  { id: "type", section: "visual", fields: txt("typography", "captions", "uiElements"), summary: (s) => s.visual.data?.captions ?? null },
  { id: "audio", section: "audio", fields: txt("voice", "music", "sfx"), summary: (s) => (s.audio.data ? [s.audio.data.voice, s.audio.data.music].join(" ") : null) },
  { id: "offer", section: "offerProofCta", fields: txt("promise", "mechanism", "proof", "ctaSpoken", "ctaOnScreen"), summary: (s) => s.offerProofCta.data?.promise ?? null },
  { id: "keep", section: "stealVsVary", fields: [{ key: "steal", kind: "lines" }, { key: "vary", kind: "pairs" }], summary: (s) => s.stealVsVary.data?.vary[0]?.idea ?? null },
  { id: "ideas", section: "replicationPlan", fields: [], summary: (s) => s.replicationPlan.data?.suggestions.map((x) => x.lever).join(" · ") ?? null },
]

type AnyData = Record<string, unknown>
const toText = (f: Field, v: unknown) =>
  f.kind === "lines" ? ((v as string[] | null) ?? []).join("\n")
  : f.kind === "pairs" ? ((v as { lever: string; idea: string }[] | null) ?? []).map((p) => `${p.lever}: ${p.idea}`).join("\n")
  : ((v as string | null) ?? "")
const fromText = (f: Field, s: string) =>
  f.kind === "lines" ? s.split("\n").map((x) => x.trim()).filter(Boolean)
  : f.kind === "pairs" ? s.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.indexOf(":")
      return i > 0 ? { lever: x.slice(0, i).trim(), idea: x.slice(i + 1).trim() } : { lever: "", idea: x }
    })
  : s.trim() || null

/** Splits "Title: detail" (verdict lines) into the bold title + the rest, like the mockup. */
function verdictParts(v: string) {
  const i = v.search(/[:.]\s/)
  return i > 0 && i < 90 ? [v.slice(0, i + 1), v.slice(i + 2)] : [v, ""]
}

function usePatchTeardown(champion: ChampionDetail) {
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const t = useTranslations("variar.td")
  return useMutation({
    mutationFn: (body: Parameters<typeof api.champions.updateTeardown>[1]) => api.champions.updateTeardown(champion.id, body),
    onSuccess: (td) => {
      qc.setQueryData<ChampionDetail>(vk.champion(champion.id), (c) => (c ? { ...c, teardown: td } : c))
      toast(
        <>
          <Icon name="check" />
          {t("saved")}
        </>
      )
    },
    onError: (e) => toast(errorMessage(e)),
  })
}

/** BlockTimeline (spec §4): flex buttons proportional to duration, playhead, cut ticks. Tap = seek + open the block. */
function BlockTimeline({ td, time, active, onPick }: { td: Teardown; time: number; active: number; onPick: (i: number) => void }) {
  const t = useTranslations("variar.td")
  const blocks = td.sections.structure.data?.blocks ?? []
  const dur = td.measurements.durationSec || 1
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="relative flex min-w-0 gap-0.5" role="group" aria-label={t("blocks")}>
        {blocks.map((b, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === active}
            onClick={() => onPick(i)}
            style={{ flex: `${Math.max(0.1, b.endSec - b.startSec)} 1 0` }}
            className={cn(
              "grid h-11 min-w-0 content-center justify-items-start overflow-hidden rounded-[4px] border px-1.5 text-left",
              i === active ? "border-fg bg-hover" : "border-line bg-surface-2 hover:border-line-2"
            )}
          >
            <span className={cn("max-w-full truncate font-mono text-[10px] tracking-[0.06em] uppercase", i === active ? "text-fg" : "text-fg-2")}>{fnLabel(t, b.function)}</span>
            <span className="font-mono text-[11px] text-fg-3">{mmss(b.startSec)}</span>
          </button>
        ))}
        <i className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 rounded-[1px] bg-fg transition-[left] duration-100" style={{ left: `${Math.min(100, (time / dur) * 100)}%` }} aria-hidden="true" />
      </div>
      <div className="relative h-2" aria-hidden="true">
        {td.measurements.cuts.map((c, i) => (
          <i key={i} className="absolute top-0 h-2 w-px bg-fg-3" style={{ left: `${(c.atSec / dur) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-2 font-mono text-xs text-fg-3">
        <span>{t("blocksCuts", { blocks: blocks.length, cuts: td.measurements.cuts.length })}</span>
        <span>{t("ticks")}</span>
      </div>
    </div>
  )
}

function fnLabel(t: ReturnType<typeof useTranslations<"variar.td">>, fn: string) {
  return (FUNCTIONS as readonly string[]).includes(fn) ? t(`fn.${fn}` as never) : fn
}

function BlockPanel({ champion, td, index }: { champion: ChampionDetail; td: Teardown; index: number }) {
  const t = useTranslations("variar.td")
  const patch = usePatchTeardown(champion)
  const structure = td.sections.structure
  const b = structure.data?.blocks[index]
  if (!b) return null
  const setFn = (fn: string) =>
    patch.mutate({ sections: { structure: { ...structure, data: { blocks: structure.data!.blocks.map((x, i) => (i === index ? { ...x, function: fn } : x)) } } } })
  return (
    <Panel className="gap-2 text-[13px]">
      <PanelHead>
        <span className="step-lbl">
          {t("block", { n: index + 1 })} · {mmss(b.startSec)}–{mmss(b.endSec)}
        </span>
        <Select value={b.function} onValueChange={setFn} disabled={patch.isPending}>
          <SelectTrigger size="sm" className="w-auto" aria-label={t("blockFunction")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([...FUNCTIONS, b.function])].map((f) => (
              <SelectItem key={f} value={f}>
                {fnLabel(t, f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelHead>
      <dl className="m-0 grid grid-cols-[76px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 tablet:grid-cols-[96px_minmax(0,1fr)]">
        <dt className="text-xs text-fg-3">{t("spoken")}</dt>
        <dd className="m-0 min-w-0">{b.speech ? `“${b.speech}”` : "—"}</dd>
        <dt className="text-xs text-fg-3">{t("onScreen")}</dt>
        <dd className="m-0 min-w-0">{b.onScreen || "—"}</dd>
        <dt className="text-xs text-fg-3">{t("label")}</dt>
        <dd className="m-0 min-w-0">{b.label}</dd>
      </dl>
    </Panel>
  )
}

function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] tablet:grid-cols-[130px_minmax(0,1fr)]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs text-fg-3">{k}</dt>
          <dd className="m-0 mb-1.5 min-w-0 tablet:mb-0">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Transcript with word fixes: tap a word, type the right one, Enter. Times never change (contract §4.2). */
function TranscriptBody({ champion, td }: { champion: ChampionDetail; td: Teardown }) {
  const t = useTranslations("variar.td")
  const patch = usePatchTeardown(champion)
  const [edit, setEdit] = useState<{ i: number; v: string } | null>(null)
  const blocks = td.sections.structure.data?.blocks ?? []
  const words = td.transcript.words
  if (!words.length) return <p className="text-fg-2">{td.sections.transcript.naReason ?? t("noSpeech")}</p>
  const groups = blocks.length
    ? blocks.map((b) => ({ b, idx: words.map((w, i) => [w, i] as const).filter(([w]) => w.startSec >= b.startSec && w.startSec < b.endSec) }))
    : [{ b: null, idx: words.map((w, i) => [w, i] as const) }]
  const save = () => {
    if (!edit) return
    if (edit.v.trim() && edit.v.trim() !== words[edit.i].word) patch.mutate({ transcriptWords: [{ index: edit.i, word: edit.v.trim() }] })
    setEdit(null)
  }
  return (
    <div className="grid gap-2">
      <Memo icon="pencil">{t("fixWordHint")}</Memo>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[13px] tablet:grid-cols-[86px_minmax(0,1fr)]">
        {groups.map(({ b, idx }, gi) => (
          <div key={gi} className="contents">
            <span className="font-mono text-xs text-fg-3">{b ? `${mmss(b.startSec)}–${mmss(b.endSec)}` : ""}</span>
            <p className="m-0 mb-1.5 leading-relaxed">
              {idx.map(([w, i]) =>
                edit?.i === i ? (
                  <Input
                    key={i}
                    autoFocus
                    value={edit.v}
                    aria-label={t("fixWord")}
                    onChange={(e) => setEdit({ i, v: e.target.value })}
                    onBlur={save}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save()
                      if (e.key === "Escape") setEdit(null)
                    }}
                    className="inline-flex h-6 w-28 px-1 py-0 align-baseline text-[13px]"
                  />
                ) : (
                  <span key={i}>
                    <button type="button" onClick={() => setEdit({ i, v: w.word })} className="rounded-[3px] hover:bg-hover hover:underline">
                      {w.word}
                    </button>{" "}
                  </span>
                )
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function SectionBody({ row, champion, td, onEdit, editing, onDone }: {
  row: Row; champion: ChampionDetail; td: Teardown; editing: boolean; onEdit: () => void; onDone: () => void
}) {
  const t = useTranslations("variar.td")
  const tc = useTranslations("common")
  const kinds = useTranslations("variar.kind")
  const patch = usePatchTeardown(champion)
  const sec = td.sections[row.section] as Section<AnyData>
  const data = (sec.data ?? {}) as AnyData
  const [draft, setDraft] = useState<Record<string, string>>({})

  if (row.id === "transcript") return <TranscriptBody champion={champion} td={td} />

  if (editing) {
    const val = (f: Field) => draft[f.key] ?? toText(f, data[f.key])
    return (
      <div className="grid gap-3">
        {row.fields.map((f) => (
          <label key={f.key} className="grid gap-1.5">
            <span className="text-xs text-fg-3">{t(`f.${f.key}` as never)}</span>
            <Textarea rows={f.kind === "text" ? 2 : 4} value={val(f)} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
          </label>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="default"
            disabled={patch.isPending}
            onClick={() => {
              const next: AnyData = { ...data }
              for (const f of row.fields) if (draft[f.key] !== undefined) next[f.key] = fromText(f, draft[f.key])
              patch.mutate({ sections: { [row.section]: { status: "ok", naReason: null, data: next } } } as never, { onSuccess: onDone })
            }}
          >
            {tc("save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            {tc("cancel")}
          </Button>
        </div>
      </div>
    )
  }

  let body: React.ReactNode
  if (sec.status === "na") body = <p className="text-fg-2">{sec.naReason}</p>
  else if (row.id === "structure") {
    const blocks = td.sections.structure.data?.blocks ?? []
    body = (
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {blocks.map((b, i) => (
          <li key={i} className="grid grid-cols-[86px_minmax(0,1fr)] gap-2.5">
            <span className="font-mono text-xs text-fg-3">
              {mmss(b.startSec)}–{mmss(b.endSec)}
            </span>
            <span>
              <b className="font-medium">{fnLabel(t, b.function)}</b>
              {b.speech ? <span className="text-fg-2"> · “{b.speech}”</span> : null}
            </span>
          </li>
        ))}
      </ol>
    )
  } else if (row.id === "layout") {
    const l = td.sections.layout.data
    body = (
      <>
        <p className="max-w-[72ch]">{l?.summary}</p>
        <Dl rows={(l?.segments ?? []).map((s) => [`${mmss(s.startSec)}–${mmss(s.endSec)}`, s.description])} />
      </>
    )
  } else if (row.id === "colors") {
    const v = td.sections.visual.data
    body = (
      <>
        <div className="flex flex-wrap gap-2.5">
          {(v?.palette ?? []).map((p) => (
            <span key={p.hex + p.role} className="flex items-center gap-1.5 font-mono text-xs text-fg-2">
              <i className="size-[18px] rounded-[4px] border border-line-2" style={{ background: p.hex }} />
              {p.hex} · {p.role}
            </span>
          ))}
        </div>
        <Dl rows={row.fields.map((f) => [t(`f.${f.key}` as never), data[f.key] as string])} />
      </>
    )
  } else if (row.id === "keep") {
    const k = td.sections.stealVsVary.data
    body = (
      <Dl
        rows={[
          [t("f.steal"), <ul key="s" className="m-0 grid gap-1 pl-4">{k?.steal.map((x) => <li key={x}>{x}</li>)}</ul>],
          [t("f.vary"), <ul key="v" className="m-0 grid gap-1 pl-4">{k?.vary.map((x) => <li key={x.lever + x.idea}><b className="font-medium">{x.lever}:</b> {x.idea}</li>)}</ul>],
        ]}
      />
    )
  } else if (row.id === "ideas") {
    body = (
      <ul className="m-0 grid gap-1.5 pl-4">
        {td.sections.replicationPlan.data?.suggestions.map((x, i) => (
          <li key={i}>
            <b className="font-medium">{kinds(`${x.kind}.title` as never)}</b> · {x.lever}: {x.idea}
          </li>
        ))}
      </ul>
    )
  } else {
    body = <Dl rows={row.fields.map((f) => [t(`f.${f.key}` as never), data[f.key] as string])} />
  }

  return (
    <div className="grid gap-2.5">
      {body}
      {row.fields.length ? (
        <div>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Icon name="pencil" />
            {sec.status === "na" ? t("fillIn") : t("edit")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function WhySells({ champion, td }: { champion: ChampionDetail; td: Teardown }) {
  const t = useTranslations("variar.td")
  const tc = useTranslations("common")
  const patch = usePatchTeardown(champion)
  const ws = td.sections.whySells
  const [draft, setDraft] = useState<string | null>(null)
  const verdict = ws.data?.verdict ?? []
  return (
    <div className="grid gap-3 rounded-lg border border-line-2 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>{t("whySells")}</h2>
        <span className="flex gap-1.5">
          {td.editedSections.includes("whySells") ? <Tag>{t("editedByYou")}</Tag> : null}
          <Tag>{t("byWeight")}</Tag>
        </span>
      </div>
      {ws.status === "na" ? <p className="text-fg-2">{ws.naReason}</p> : null}
      {draft !== null ? (
        <div className="grid gap-2">
          <Textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t("whySells")} />
          <span className="text-xs text-fg-3">{t("oneCausePerLine")}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={patch.isPending || !draft.trim()}
              onClick={() =>
                patch.mutate(
                  { sections: { whySells: { status: "ok", naReason: null, data: { ...ws.data!, verdict: draft.split("\n").map((x) => x.trim()).filter(Boolean) } } } },
                  { onSuccess: () => setDraft(null) }
                )
              }
            >
              {tc("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ol className="m-0 grid list-none gap-2.5 p-0">
            {verdict.map((v, i) => {
              const [title, rest] = verdictParts(v)
              return (
                <li key={i} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2.5">
                  <span className="grid h-5 place-items-center rounded-[4px] border border-line-2 font-mono text-xs text-fg-3">{i + 1}</span>
                  <span>
                    <b className="font-semibold">{title}</b> <span className="text-fg-2">{rest}</span>
                  </span>
                </li>
              )
            })}
          </ol>
          {ws.data ? (
            <div>
              <Button size="sm" variant="ghost" onClick={() => setDraft(verdict.join("\n"))}>
                <Icon name="pencil" />
                {t("edit")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function useSummaryOf() {
  const t = useTranslations("variar.td")
  const lang = useLanguageName()
  return (row: Row, td: Teardown) => {
    const s = td.sections
    if (row.id === "transcript") return td.transcript.words.length ? t("words", { n: td.transcript.words.length, lang: lang(td.language) }) : (s.transcript.naReason ?? "")
    if (row.id === "structure") {
      const m = td.measurements
      return t("structureSum", { blocks: s.structure.data?.blocks.length ?? 0, cuts: m.cuts.length, per10: ((m.cuts.length / Math.max(1, m.durationSec)) * 10).toFixed(1) })
    }
    const sec = s[row.section] as Section<unknown>
    return sec.status === "na" ? (sec.naReason ?? "") : (row.summary(s, td) ?? "")
  }
}

/** Analyze again: 409 CONFIRM_DOWNSTREAM_RESET `{ editedSections }` asks before throwing away the corrections. */
function useAnalyze(champion: ChampionDetail) {
  const t = useTranslations("variar.td")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [ask, setAsk] = useState<TeardownSectionKey[] | null>(null)
  const m = useMutation({
    mutationFn: (confirm: boolean) => api.champions.analyze(champion.id, { confirm: confirm || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: vk.champion(champion.id) }),
    onError: (e) => {
      if (isApiError(e) && e.code === "CONFIRM_DOWNSTREAM_RESET") return setAsk(((e.details as { editedSections?: TeardownSectionKey[] })?.editedSections ?? []))
      toast(errorMessage(e))
    },
  })
  const rowTitle = (k: TeardownSectionKey) => {
    const row = ROWS.find((r) => r.section === k)
    return k === "whySells" ? t("whySells") : row ? t(`sec.${row.id}` as never) : k
  }
  const dialog = (
    <AlertDialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("againTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("againBody", { sections: (ask ?? []).map(rowTitle).join(", ") })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setAsk(null)}>{t("keepEdits")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setAsk(null)
              m.mutate(true)
            }}
          >
            {t("analyzeAnyway")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { run: () => m.mutate(false), pending: m.isPending, dialog }
}

/** Step 2 · Teardown (spec §5.2): analyzing (real checklist, can leave) · ready (player + timeline + why it sells + 12 sections) · failed. */
export function TeardownStep({ champion }: { champion: ChampionDetail }) {
  const t = useTranslations("variar")
  const td = champion.teardown
  const router = useRouter()
  const money = useMoney()
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  const lang = useLanguageName()
  const errorMessage = useErrorMessage()
  const config = useChampionConfig()
  const summaryOf = useSummaryOf()
  const analyze = useAnalyze(champion)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [block, setBlock] = useState(0)
  const [open, setOpen] = useState<string[]>(["hook"])
  const [editing, setEditing] = useState<string | null>(null)
  const busy = champion.status === "ANALYZING" || champion.status === "RESOLVING"
  const failed = champion.status === "FAILED"
  const ready = champion.status === "READY" && !!td
  const job = champion.job
  const price = config.data && champion.durationSec ? champion.durationSec * config.data.analysisUsdPerSec : null
  const blocks = td?.sections.structure.data?.blocks ?? []

  const onTime = (sec: number) => {
    setTime(sec)
    const i = blocks.findIndex((b) => sec >= b.startSec && sec < b.endSec)
    if (i >= 0 && i !== block) setBlock(i)
  }
  const pick = (i: number) => {
    setBlock(i)
    if (videoRef.current && blocks[i]) videoRef.current.currentTime = blocks[i].startSec
  }

  const v = champion.video
  const facts = [
    champion.sources.includes("UPLOAD") ? t("rail.upload") : t("rail.adLibrary"),
    champion.adMeta?.daysRunning ? t("td.liveDays", { n: champion.adMeta.daysRunning }) : null,
    champion.adMeta?.collationCount && champion.adMeta.collationCount > 1 ? t("td.versions", { n: champion.adMeta.collationCount }) : null,
    v?.durationSec ? `${mmss(v.durationSec)} · ${aspect(v.width, v.height) ?? ""}` : null,
    td ? lang(td.language) : null,
  ].filter(Boolean) as string[]

  const player = (
    <div className="grid min-w-0 place-items-center rounded-xl tablet:border tablet:border-line tablet:bg-stage tablet:p-3">
      <VideoPlayer
        video={v}
        poster={champion.thumbnail?.url}
        size="sm"
        videoRef={videoRef}
        onTime={onTime}
        overlay={busy ? (
          <span className="on-ink absolute bottom-3 left-3 rounded-[4px] border border-line-2 bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-fg">
            {job?.stage ? t(`job.${job.stage}` as never) : t("td.analyzing")}
          </span>
        ) : undefined}
      />
    </div>
  )

  const failedAt = job && job.status === "FAILED" ? job.checklist.findIndex((c) => !c.done) : -1
  const checklist = (job?.checklist ?? []).map((c, i) => ({
    label: (
      <span className={cn(i === failedAt && "text-status-failed")}>
        {t(`job.${c.key}` as never)}
      </span>
    ),
    state: (c.done ? "done" : job?.status === "RUNNING" && job.checklist.findIndex((x) => !x.done) === i ? "now" : "todo") as "done" | "now" | "todo",
  }))

  let right: React.ReactNode
  if (busy) {
    const n = (job?.checklist.filter((c) => c.done).length ?? 0) + 1
    right = (
      <div className="grid gap-4">
        <Panel>
          <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-4 tablet:grid-cols-[auto_minmax(0,1fr)]">
            <div className="hidden px-6 tablet:block"><ThinkingOrb /></div>
            <div className="grid gap-2.5" role="status">
              <PanelHead>
                <b className="font-semibold">{t("td.analyzingStep", { n: Math.min(n, job?.checklist.length ?? 5), total: job?.checklist.length ?? 5 })}</b>
                {job?.etaSec ? <span className="row-sub font-mono">{t("td.secLeft", { s: job.etaSec })}</span> : null}
              </PanelHead>
              <Progress value={job?.progress ?? 0} aria-label={t("td.analyzing")} />
              <Checklist items={checklist} />
              <p className="text-[13px] text-fg-2">{t("td.canLeave")}</p>
            </div>
          </div>
        </Panel>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {ROWS.map((r) => (
            <div key={r.id} className="grid grid-cols-[minmax(0,1fr)] gap-1 border-t border-line px-4 py-3 first:border-t-0 tablet:grid-cols-[180px_minmax(0,1fr)] tablet:gap-3">
              <b className="font-medium">{t(`td.sec.${r.id}` as never)}</b>
              <span className="sk mt-1.5 h-2.5 w-3/5" />
            </div>
          ))}
        </div>
      </div>
    )
  } else if (failed) {
    right = (
      <div className="grid gap-4">
        <Banner
          kind="error"
          title={t("td.failedTitle")}
          body={champion.failReason ?? errorMessage(champion.errorCode)}
          actions={
            <>
              <Link href={variarHref(champion.id, "winner")} className={buttonVariants({ size: "sm" })}>
                <Icon name="upload" />
                {t("td.uploadAnother")}
              </Link>
              {champion.action === "analyze_again" ? (
                <Button size="sm" variant="ghost" disabled={analyze.pending} onClick={analyze.run}>
                  <Icon name="refresh" />
                  {t("td.tryAgain")}
                </Button>
              ) : null}
            </>
          }
        />
        {checklist.length ? (
          <ul className="m-0 grid list-none gap-2 p-0 text-[13px]">
            {checklist.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                {c.state === "done" ? <Icon name="check" className="text-status-approved" /> : i === failedAt ? <Icon name="x" className="text-status-failed" /> : <span className="m-px size-3.5 rounded-full border-[1.5px] border-line-2" />}
                <span className={cn(c.state !== "done" && i !== failedAt && "text-fg-2")}>{c.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  } else if (td) {
    right = (
      <div className="grid min-w-0 gap-4">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-fg-2">
            {facts.map((f) => (
              <span key={f} className={cn(/\d:\d\d/.test(f) && "font-mono")}>{f}</span>
            ))}
          </div>
          {champion.adMeta?.daysRunning ? <Memo icon="info">{t("td.proxyNote")}</Memo> : null}
        </div>
        <WhySells champion={champion} td={td} />
        <EditMapPanel champion={champion} td={td} />
        <Accordion type="multiple" value={open} onValueChange={setOpen} className="overflow-hidden rounded-lg border border-line bg-surface">
          {ROWS.map((r) => {
            const edited = r.section !== "whySells" && td.editedSections.includes(r.section)
            return (
              <AccordionItem key={r.id} value={r.id}>
                <AccordionTrigger className="grid grid-cols-[minmax(0,1fr)_auto_16px] gap-x-3 gap-y-0.5 px-3.5 py-[11px] tablet:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto_16px]">
                  <b className="font-medium">{t(`td.sec.${r.id}` as never)}</b>
                  <span className="col-span-3 col-start-1 row-start-2 truncate text-[13px] text-fg-2 tablet:col-span-1 tablet:col-start-auto tablet:row-start-auto">{summaryOf(r, td)}</span>
                  <span>{edited ? <Tag>{t("td.edited")}</Tag> : null}</span>
                  <Icon name="chev" className="text-fg-3 transition-transform group-data-[state=open]:rotate-90" />
                </AccordionTrigger>
                <AccordionContent className="grid gap-2.5 px-3.5 text-[13px]">
                  <SectionBody
                    row={r}
                    champion={champion}
                    td={td}
                    editing={editing === r.id}
                    onEdit={() => setEditing(r.id)}
                    onDone={() => setEditing(null)}
                  />
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
        <Memo icon="pencil">{t("td.correctionsUsed")}</Memo>
      </div>
    )
  }

  return (
    <VariarFrame
      champion={champion}
      viewing="teardown"
      actionbar={
        <ActionBar
          hint={ready && td ? t("td.analyzedAt", { when: format.relativeTime(new Date(td.analyzedAt), now) }) : busy ? t("td.hintBusy") : null}
          back={{ href: variarHref(champion.id, "winner") }}
          primary={
            <Button data-primary variant="default" disabled={!ready} onClick={() => router.push(variarHref(champion.id, "variations"))}>
              {t("continueTo", { step: t("steps.variations") })}
            </Button>
          }
        />
      }
    >
      <WzHead
        title={t("steps.teardown")}
        sub={t("td.sub")}
        aside={
          ready ? (
            <Button disabled={analyze.pending} onClick={analyze.run}>
              <Icon name="refresh" />
              {t("td.again")}
              {price !== null ? <span className="font-mono text-fg-2">· {money(price)}</span> : null}
            </Button>
          ) : null
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 desktop:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-3 desktop:sticky desktop:top-[110px]">
          {player}
          {ready && td ? (
            <>
              <BlockTimeline td={td} time={time} active={block} onPick={pick} />
              <BlockPanel champion={champion} td={td} index={block} />
            </>
          ) : busy ? (
            <>
              <span className="sk h-11 rounded-[4px]" />
              <span className="sk h-2.5 w-1/2" />
            </>
          ) : null}
        </div>
        {right}
      </div>
      {analyze.dialog}
    </VariarFrame>
  )
}
