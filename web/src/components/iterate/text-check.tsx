"use client"

import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import type { IterateBatch, IteratePiece, PieceFormat, StaticTextCheck } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { useIterateConfig } from "@/hooks/use-iterate"
import { cn } from "@/lib/utils"
import { Dot, FORMAT_LABEL, Tag, isImagePiece } from "./parts"
import { type CapInfo, useCanMakeFormats, usePieceActions } from "./piece-actions"

/*
 * Text check of the assembled STATIC (estatico-montado-e-molduras-v1 §A6/§A10, spec design/estatico-montado-2026-10-25.md §7,
 * mockup design/mockup-estatico-textcheck.html). G1–G4 approved 25/10: critical text still wrong after 2 tries leaves the zip by
 * default (the API sets inZip false); the price sits on the Retry button, no dialog; `extraText` counts as a critical error.
 */

type Item = StaticTextCheck["items"][number]
/** Same rule as the backend's `compararTexto` (§A6): NFC, case and spaces/line breaks ignored, accents count. Fallback only. */
const norm = (s: string) => s.normalize("NFC").toLocaleLowerCase().replace(/\s+/g, " ").trim()
/** §A10 (25/10): `items` = every text checked, each with `match`; the wrong ones are `!match` (compare only if the API omits it). */
export const itemMatches = (it: Item) => (typeof it.match === "boolean" ? it.match : it.seen !== null && norm(it.seen) === norm(it.expected))

export type TextVerdict = "ok" | "minor" | "critical" | "skipped"
/** null = no check (video, legacy static, image not ready). G3: invented text = critical. */
export function textVerdict(tc: StaticTextCheck | null | undefined): TextVerdict | null {
  if (!tc) return null
  if (tc.status === "ok") return "ok"
  if (tc.status === "skipped") return "skipped"
  const bad = tc.items.filter((i) => !itemMatches(i))
  return bad.some((i) => i.critical) || (tc.extraText?.length ?? 0) > 0 ? "critical" : "minor"
}
/** Pieces in the zip whose text doesn't match (the Download line "N pieces have a text error"). */
export const hasTextError = (p: IteratePiece) => p.status === "ready" && !p.render && (textVerdict(p.textCheck) === "minor" || textVerdict(p.textCheck) === "critical")

/** Common prefix/suffix on the NFC strings: the middle is the wrong part (spec §7.2: the letter that differs is marked). */
function diffParts(expected: string, seen: string) {
  const a = Array.from(expected.normalize("NFC"))
  const b = Array.from(seen.normalize("NFC"))
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  const cut = (x: string[]) => [x.slice(0, i).join(""), x.slice(i, x.length - j).join(""), x.slice(x.length - j).join("")] as const
  return { a: cut(a), b: cut(b) }
}

/** Chip on the thumbnail (spec §7.1): only when something needs a look; success makes no noise. */
export function TextCheckChip({ p, className }: { p: IteratePiece; className?: string }) {
  const t = useTranslations("iterate.textCheck")
  if (!isImagePiece(p)) return null
  if (p.render?.stage === "text_check")
    return (
      <Tag tone="neutral" className={className}>
        <Dot pulse />
        {t("stage.check")}
      </Tag>
    )
  if (p.status !== "ready" || p.render) return null
  const v = textVerdict(p.textCheck)
  if (!v) return null
  // the reason wins over "out of the zip" (live finding 25/10: "Ready · Out of zip" said nothing about why)
  if (!p.inZip && v !== "minor" && v !== "critical") return <Tag tone="neutral" className={className}>{t("chip.out")}</Tag>
  if (v === "minor") return <Tag tone="warn" className={className}><Dot />{t("chip.minor")}</Tag>
  if (v === "critical") return <Tag tone="bad" className={className}><Dot />{t("chip.critical")}</Tag>
  if (v === "skipped") return <Tag tone="neutral" className={className}>{t("chip.skipped")}</Tag>
  return null
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
/** One line saying what is wrong: invented text first (G3), then the first wrong critical item, then the first wrong one. */
export function useTextSummary() {
  const t = useTranslations("iterate.textCheck.sum")
  return (tc: StaticTextCheck | null | undefined) => {
    if (!tc || tc.status !== "mismatch") return null
    const extra = tc.extraText ?? []
    const bad = tc.items.filter((i) => !itemMatches(i)).sort((x, y) => Number(y.critical) - Number(x.critical))
    const total = extra.length + bad.length
    const first = extra.length
      ? t("extra", { text: clip(extra[0]) })
      : bad.length
        ? bad[0].seen === null
          ? t("missing", { expected: clip(bad[0].expected) })
          : t("item", { seen: clip(bad[0].seen), expected: clip(bad[0].expected) })
        : null
    if (!first) return null
    return total > 1 ? `${first} ${t("more", { n: total - 1 })}` : first
  }
}

/**
 * The text error on the piece's own line (Generate row, Download card): reason + Retry (with the price, G2) + Leave out /
 * Put back, without opening the Preview. Only for a ready STATIC whose check says `mismatch` (wrong item OR extraText).
 */
export function PieceTextAlert({ batchId, p, compact }: { batchId: string; p: IteratePiece; compact?: boolean }) {
  const t = useTranslations("iterate.textCheck")
  const usd = useUsd()
  const summary = useTextSummary()
  const canAct = useCanMakeFormats()
  const cfg = useIterateConfig()
  const [cap, setCap] = useState<CapInfo | null>(null)
  const { retry, inZip } = usePieceActions(batchId, { onCap: setCap })
  if (!isImagePiece(p) || p.status !== "ready" || p.render) return null
  const v = textVerdict(p.textCheck)
  if (v !== "minor" && v !== "critical") return null
  const line = summary(p.textCheck)
  const price = p.retryUsd ?? cfg.data?.staticImageUsd ?? null
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={cn("text-[13px] font-semibold [overflow-wrap:anywhere]", v === "critical" ? "text-status-failed" : "text-status-waiting")}>
        {line}
        {!p.inZip ? <span className="font-normal text-fg-3"> · {t("chip.out")}</span> : null}
      </span>
      <div className={cn("flex flex-wrap gap-1.5", compact && "[&>*]:flex-[1_1_auto]")}>
        {canAct ? (
          <Button size="sm" variant="outline" disabled={!!cap || retry.isPending} onClick={() => retry.mutate({ piece: p })}>
            {price ? t("retry", { cost: usd(price) }) : t("retryFree")}
          </Button>
        ) : null}
        <Button size="sm" variant={p.inZip ? "ghost" : "default"} disabled={inZip.isPending} onClick={() => inZip.mutate({ piece: p, value: !p.inZip })}>
          {p.inZip ? t("leave") : t("putBack")}
        </Button>
      </div>
      {cap ? (
        <span className="text-xs font-semibold text-status-failed">
          {Number.isFinite(cap.spentUsd) ? t("cap", { spent: usd(cap.spentUsd), cap: usd(cap.capUsd) }) : t("capShort")}
        </span>
      ) : null}
    </div>
  )
}

/** Honest stage of a STATIC while it renders (§A10 render.stage / attempt): image → spelling check → (2nd image). */
export function useStaticStage() {
  const t = useTranslations("iterate.textCheck")
  return (p: IteratePiece) => {
    const r = p.render
    if (!r || !isImagePiece(p) || !r.stage) return null
    if (r.stage === "retake") return t("stage.retake", { s: 90 })
    if (r.stage === "text_check") return r.attempt === 2 ? t("stage.check2") : t("stage.check")
    return t("stage.gen", { s: 90 })
  }
}

/** "US$ 0.40" in the interface locale (G2: on the button itself). */
function useUsd() {
  const format = useFormatter()
  return (v: number) => format.number(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function useBlockLabel() {
  const t = useTranslations("iterate.textCheck.block")
  return (key: string | undefined) => {
    if (!key) return null
    const m = /^(benefits|trust)\.(\d+)\.(\w+)$/.exec(key)
    if (m) {
      const k = `${m[1]}_${m[3]}`
      return t.has(k as never) ? t(k as never, { n: Number(m[2]) } as never) : key
    }
    const k = key.replace(/\./g, "_")
    return t.has(k as never) ? t(k as never) : key
  }
}

function ItemRow({ it }: { it: Item }) {
  const t = useTranslations("iterate.textCheck")
  const label = useBlockLabel()
  const name = label(it.key)
  return (
    <li className="flex flex-col gap-1.5 border-b border-line-soft px-3.5 py-3 last:border-b-0">
      {it.critical || name ? (
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-fg-3">
          {it.critical ? <Tag tone="bad">{t("critical")}</Tag> : null}
          {name ? <span>{name}</span> : null}
        </div>
      ) : null}
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 font-mono text-[13px]">
        <dt className="pt-0.5 text-[11px] tracking-[0.04em] text-fg-3 uppercase">{t("expected")}</dt>
        {it.seen === null ? (
          <>
            <dd className="m-0 [overflow-wrap:anywhere]">{it.expected}</dd>
            <dt className="pt-0.5 text-[11px] tracking-[0.04em] text-fg-3 uppercase">{t("seen")}</dt>
            <dd className="m-0 font-sans font-semibold text-status-failed">{t("missing")}</dd>
          </>
        ) : (
          <Diff expected={it.expected} seen={it.seen} />
        )}
      </dl>
    </li>
  )
}
function Diff({ expected, seen }: { expected: string; seen: string }) {
  const t = useTranslations("iterate.textCheck")
  const { a, b } = diffParts(expected, seen)
  return (
    <>
      <dd className="m-0 [overflow-wrap:anywhere]">
        {a[0]}
        {a[1] ? <span className="rounded-[3px] bg-status-approved-bg px-px font-semibold text-status-approved">{a[1]}</span> : null}
        {a[2]}
      </dd>
      <dt className="pt-0.5 text-[11px] tracking-[0.04em] text-fg-3 uppercase">{t("seen")}</dt>
      <dd className="m-0 [overflow-wrap:anywhere]">
        {b[0]}
        {b[1] ? (
          <span className="rounded-[3px] bg-status-failed-bg px-px font-semibold text-status-failed underline decoration-wavy underline-offset-[3px]">{b[1]}</span>
        ) : null}
        {b[2]}
      </dd>
    </>
  )
}
function ExtraRow({ text }: { text: string }) {
  const t = useTranslations("iterate.textCheck")
  return (
    <li className="flex flex-col gap-1.5 border-b border-line-soft px-3.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-fg-3">
        <Tag tone="bad">{t("critical")}</Tag>
        <span>{t("extraHead")}</span>
      </div>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 font-mono text-[13px]">
        <dt className="pt-0.5 text-[11px] tracking-[0.04em] text-fg-3 uppercase">{t("seen")}</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">
          <span className="rounded-[3px] bg-status-failed-bg px-px font-semibold text-status-failed underline decoration-wavy underline-offset-[3px]">{text}</span>
        </dd>
      </dl>
    </li>
  )
}
/** Wrong ones first (critical before minor), then the invented text, then "N other texts match". */
function Items({ tc }: { tc: StaticTextCheck }) {
  const t = useTranslations("iterate.textCheck")
  const bad = tc.items.filter((i) => !itemMatches(i)).sort((x, y) => Number(y.critical) - Number(x.critical))
  const matched = tc.items.length - bad.length
  const extra = tc.extraText ?? []
  if (!bad.length && !extra.length) return null
  return (
    <ul className="m-0 list-none p-0">
      {bad.map((it, i) => (
        <ItemRow key={`${it.key ?? "i"}-${i}`} it={it} />
      ))}
      {extra.map((x, i) => (
        <ExtraRow key={`x-${i}`} text={x} />
      ))}
      {matched > 0 ? (
        <li className="flex items-center gap-2 px-3.5 py-3 text-[12.5px] text-fg-3">
          <span className="size-[7px] flex-none rounded-full bg-status-approved" aria-hidden="true" />
          {t("matched", { n: matched })}
        </li>
      ) : null}
    </ul>
  )
}

type Tone = "ok" | "warn" | "bad" | "neutral" | "run"
const HEAD: Record<Tone, string> = {
  ok: "border-status-approved-edge bg-status-approved-bg",
  warn: "border-status-waiting-edge bg-status-waiting-bg",
  bad: "border-status-failed-edge bg-status-failed-bg",
  neutral: "border-line bg-card-2",
  run: "border-line bg-card-2",
}
const ICO: Record<Tone, string> = {
  ok: "bg-status-approved text-white",
  warn: "bg-status-waiting text-white",
  bad: "bg-status-failed text-white",
  neutral: "bg-fg-3 text-white",
  run: "border-2 border-line-strong border-t-fg motion-safe:animate-spin",
}
function Box({ tone, mark, head, sub, children }: { tone: Tone; mark: string; head: React.ReactNode; sub: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-line" aria-live="polite">
      <div className={cn("flex items-start gap-2.5 border-b px-3.5 py-3", HEAD[tone], !children && "border-b-0")}>
        <span className={cn("grid size-[22px] flex-none place-items-center rounded-full text-xs font-extrabold", ICO[tone])} aria-hidden="true">
          {mark}
        </span>
        <div className="min-w-0">
          <b className="block text-sm">{head}</b>
          <p className="mt-0.5 mb-0 text-[12.5px] text-fg-2">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

/** Mobile: the actions are a bar fixed to the bottom of the full-screen preview (spec §7.5), with the safe area. */
function Actions({ children, note, block }: { children: React.ReactNode; note?: React.ReactNode; block?: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-[3] flex flex-col gap-2 border-t border-line bg-card px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] shadow-[0_-6px_24px_rgba(21,23,26,0.08)] tablet:static tablet:border-t-0 tablet:p-0 tablet:shadow-none">
        <div className="flex gap-2 [&>*]:min-h-11 [&>*]:min-w-0 [&>*]:flex-1 tablet:flex-wrap tablet:[&>*]:flex-[1_1_140px]">{children}</div>
        {block ? <p className="m-0 text-[12.5px] font-semibold text-status-failed" id="tc-cap">{block}</p> : null}
        {note ? <p className="m-0 text-xs text-fg-3">{note}</p> : null}
      </div>
    </>
  )
}

function FormatCheck({ tc, label }: { tc: StaticTextCheck; label: string }) {
  const t = useTranslations("iterate.textCheck")
  const v = textVerdict(tc)
  const note = <span className="mt-1 block text-xs text-fg-3">{t("formatNote", { format: label })}</span>
  if (v === "ok") return <Box tone="ok" mark="✓" head={t("okHead")} sub={<>{t("ok", { n: tc.items.length })}{note}</>} />
  if (v === "skipped") return <Box tone="neutral" mark="?" head={t("skipHead")} sub={<>{t("skipSub")}{note}</>} />
  const nBad = tc.items.filter((i) => !itemMatches(i)).length + (tc.extraText?.length ?? 0)
  return (
    <Box tone={v === "critical" ? "bad" : "warn"} mark="!" head={v === "critical" ? t("critHead") : t("minorHead", { n: nBad })} sub={note}>
      <Items tc={tc} />
    </Box>
  )
}

/**
 * The "Text check" panel of the Preview: the 9 states of the mockup (generating, checking, retaking, ok, minor, critical,
 * cap reached, skipped, left out). Retry = POST /iterate/pieces/:id/retry (cap → 409 SPEND_CAP_EXCEEDED); Leave out / Put back
 * = PATCH /iterate/pieces/:id { inZip } (§A10).
 */
export function TextCheckPanel({ batch, piece, format }: { batch: IterateBatch; piece: IteratePiece; format?: PieceFormat }) {
  const t = useTranslations("iterate.textCheck")
  const usd = useUsd()
  const canAct = useCanMakeFormats()
  const cfg = useIterateConfig()
  const [cap, setCap] = useState<CapInfo | null>(null)
  const { retry, inZip } = usePieceActions(batch.id, { onCap: setCap })
  const tc = piece.textCheck ?? null
  const r = piece.render
  const price = piece.retryUsd ?? cfg.data?.staticImageUsd ?? null
  const retryLabel = price ? t("retry", { cost: usd(price) }) : t("retryFree")
  const doRetry = () => retry.mutate({ piece })
  const setZip = (value: boolean) => inZip.mutate({ piece, value })

  // 4:5 / 1:1 tab: that image's own check (PieceFormat.textCheck), read-only — Retry / Leave out act on the piece's 9:16
  if (format && format.format !== "9x16") {
    const ftc = format.state === "ready" ? (format.textCheck ?? null) : null
    return ftc ? <FormatCheck tc={ftc} label={FORMAT_LABEL[format.format]} /> : null
  }

  // waiting states (the piece is rendering: 1st image, check, or the automatic 2nd image)
  if (r && piece.status === "rendering") {
    if (r.stage === "retake" || (r.stage === "image" && r.attempt === 2))
      return (
        <Box tone="run" mark="" head={t("retHead")} sub={price ? t("retSub", { cost: usd(price) }) : t("retSubFree")}>
          {tc ? <Items tc={tc} /> : null}
        </Box>
      )
    if (r.stage === "text_check")
      return (
        <Box tone="run" mark="" head={t("chkHead")} sub={t("chkSub")}>
          <ul className="m-0 list-none p-0" aria-hidden="true">
            {[["40%", "85%"], ["30%", "70%"]].map(([a, b], i) => (
              <li key={i} className="flex flex-col gap-1.5 border-b border-line-soft px-3.5 py-3 last:border-b-0">
                <span className="sk h-3" style={{ width: a }} />
                <span className="sk h-3" style={{ width: b }} />
              </li>
            ))}
          </ul>
        </Box>
      )
    return <Box tone="run" mark="" head={t("genHead")} sub={t("genSub")} />
  }
  if (piece.status !== "ready" || !tc) return null
  const v = textVerdict(tc)

  if (!piece.inZip)
    return (
      <>
        <Box tone="neutral" mark="–" head={t("outHead")} sub={v === "critical" ? (tc.items.every(itemMatches) ? t("outSubExtra") : t("outSubCritical")) : t("outSub")}>
          {v === "minor" || v === "critical" ? <Items tc={tc} /> : null}
        </Box>
        <Actions>
          <Button variant="outline" disabled={inZip.isPending} onClick={() => setZip(true)}>
            {t("putBack")}
          </Button>
        </Actions>
      </>
    )
  if (v === "ok")
    return <Box tone="ok" mark="✓" head={t("okHead")} sub={tc.items.length ? t("ok", { n: tc.items.length }) : t("okAll")} />
  if (v === "skipped")
    return <Box tone="neutral" mark="?" head={t("skipHead")} sub={t("skipSub")} />

  const critical = v === "critical"
  const nBad = tc.items.filter((i) => !itemMatches(i)).length + (tc.extraText?.length ?? 0)
  const retryBtn = canAct ? (
    <Button key="retry" variant="outline" disabled={!!cap || retry.isPending} aria-describedby={cap ? "tc-cap" : undefined} onClick={doRetry}>
      {retry.isPending ? <span className="spin-ring size-3.5 border-current" aria-hidden="true" /> : null}
      {retryLabel}
    </Button>
  ) : null
  const leaveBtn = (
    <Button key="leave" variant={critical || cap ? "default" : "ghost"} disabled={inZip.isPending} onClick={() => setZip(false)}>
      {t("leave")}
    </Button>
  )
  return (
    <>
      <Box
        tone={critical ? "bad" : "warn"}
        mark="!"
        head={critical ? t("critHead") : t("minorHead", { n: nBad })}
        sub={critical ? t("critSub") : t("minorSub")}
      >
        <Items tc={tc} />
      </Box>
      <Actions
        block={cap ? (Number.isFinite(cap.spentUsd) ? t("cap", { spent: usd(cap.spentUsd), cap: usd(cap.capUsd) }) : t("capShort")) : null}
        note={cap || !canAct ? null : t("retryNote")}
      >
        {critical && !cap ? [leaveBtn, retryBtn] : [retryBtn, leaveBtn]}
      </Actions>
    </>
  )
}
