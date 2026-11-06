"use client"

import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import type { CreditEntryView, TemplateRunRef } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useCredits, useLedger, useTemplateRuns } from "@/hooks/use-templates"
import { templateRunHref } from "@/lib/routes"
import { Pill, useBalanceText } from "./parts"
import { Reveal } from "@/components/ui/reveal"

const SAMPLE_LEDGER: CreditEntryView[] = Array.from({ length: 3 }, (_, i) => ({
  id: `sample-entry-${i}`,
  kind: "CHARGE",
  pool: "CREDITS",
  delta: -3,
  amount: 3,
  balanceAfter: 120,
  note: null,
  createdAt: "2026-11-01T12:00:00.000Z",
  run: { id: "sample-run", batchId: "sample-batch", templateSlug: "sample", templateName: "Template name" },
  by: null,
}))

/*
 * /credits (mockup-templates "Get credits"): no gateway yet (T8) — "Talk to us" with the e-mail to copy, the packs with
 * "Price to be set" (T9: the value of a credit is open), the ledger of this account and the template uses.
 */
const PACKS = [
  { key: "starter", credits: 50 },
  { key: "studio", credits: 150 },
  { key: "agency", credits: null },
] as const

export function CreditsScreen() {
  const t = useTranslations("credits")
  const ts = useTranslations("sample.contact")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const tl = useTranslations("skeleton")
  const credits = useCredits()
  const balance = useBalanceText()
  const email = credits.data?.contactEmail ?? ts("email")
  const copy = (text: string, done: string) => {
    if (!navigator.clipboard) return toast(text)
    void navigator.clipboard.writeText(text).then(() => toast(done), () => toast(t("copyFallback")))
  }
  const c = credits.data
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[18px] px-[var(--gut)] pt-5 pb-16 tablet:pt-6">
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="m-0 max-w-[62ch] text-fg-2">{t("lede")}</p>
      </div>

      {credits.isError ? (
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{t("loadError")}</AlertTitle>
            <AlertDescription>{errorMessage(credits.error)}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => credits.refetch()}>
              {t("retry")}
            </Button>
          </AlertActions>
        </Alert>
      ) : (
        <div className="grid gap-3 rounded-lg border border-line bg-card p-4 tablet:grid-cols-3">
          {[
            [t("balance"), c ? balance(c) : "42 credits"],
            [t("held"), c ? (c.unlimited ? "—" : String(c.held)) : "8"],
            [t("plan"), c ? t(`access.${c.access}`) : "Paid plan"],
          ].map(([k, v], i) => (
            <div key={k} className="grid gap-1">
              <span className="eyebrow">{k}</span>
              {/* skullet (04/11): the number is drawn as a bar at its real size until the summary arrives */}
              <Reveal loading={!c} id={`credits.summary.${i}`} label={tl("credits")}>
                <b className="wide block text-xl font-extrabold tabular-nums">{v}</b>
              </Reveal>
            </div>
          ))}
        </div>
      )}

      <div role="status" className="grid gap-2.5 rounded-lg border border-status-waiting-edge bg-status-waiting-bg p-3.5 text-status-waiting tablet:px-4">
        <b>{t("noCheckout")}</b>
        <p className="m-0 text-fg-2">{t("noCheckoutBody")}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-line bg-card-2 px-2.5 py-2 font-mono text-[13px] text-fg">
          <span className="min-w-0 flex-1 select-all [overflow-wrap:anywhere]">{email}</span>
          <Button size="sm" onClick={() => copy(email, t("copied"))}>
            {t("copy")}
          </Button>
          <a className={buttonVariants({ size: "sm", variant: "ghost" })} href={`mailto:${email}?subject=${encodeURIComponent(t("mailSubject"))}&body=${encodeURIComponent(t("mailBody", { id: session.user.id }))}`}>
            {t("openMail")}
          </a>
        </div>
        <span className="text-xs text-fg-2">{t("idLine", { id: session.user.id })}</span>
      </div>

      <div className="grid gap-3 tablet:grid-cols-3">
        {PACKS.map((p) => (
          <div key={p.key} className="grid gap-2 rounded-lg border border-line bg-card p-4">
            <span className="eyebrow">{t(`packs.${p.key}.name`)}</span>
            <b className="wide text-[22px] font-extrabold">{p.credits ? t("packCredits", { n: p.credits }) : t("packCustom")}</b>
            <span className="text-[13px] text-fg-3">{t(`packs.${p.key}.body`)}</span>
            <Pill tone="warn" className="justify-self-start">{t("priceTbd")}</Pill>
          </div>
        ))}
      </div>

      <Ledger />
      <Runs />
    </div>
  )
}

function useWhat() {
  const t = useTranslations("credits.what")
  return (e: CreditEntryView) => {
    const name = e.run?.templateName ?? ""
    switch (e.kind) {
      case "RESERVE":
        return t("reserve", { name })
      case "CHARGE":
        return t("charge", { name, n: e.amount })
      case "REFUND":
        return t("refund", { name })
      case "GRANT":
        return e.pool === "SAMPLE" ? t("sampleGrant") : t("grant")
      default:
        return e.note ? t("manualNote", { note: e.note }) : t("manual")
    }
  }
}

function Ledger() {
  const t = useTranslations("credits")
  const errorMessage = useErrorMessage()
  const format = useFormatter()
  const what = useWhat()
  const tl = useTranslations("skeleton")
  const q = useLedger()
  const rows = q.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <section className="grid gap-3 rounded-lg border border-line bg-card p-4" aria-labelledby="ledger-h">
      <span id="ledger-h" className="eyebrow">{t("history")}</span>
      <Reveal
        data={q.isPending ? null : rows}
        sample={SAMPLE_LEDGER}
        id="credits.ledger"
        label={tl("credits")}
        error={q.isError ? <p className="m-0 text-[13px] text-status-failed">{errorMessage(q.error)}</p> : undefined}
      >
        {(rows) => !rows.length ? (
        <p className="m-0 text-[13px] text-fg-3">{t("historyEmpty")}</p>
      ) : (
        <div className="grid text-[13px]" role="table" aria-labelledby="ledger-h">
          <div role="row" className="hidden grid-cols-[90px_minmax(0,1fr)_90px_80px] gap-3 border-b border-line pb-2 font-mono text-[10.5px] tracking-[0.06em] text-fg-3 uppercase tablet:grid">
            <span role="columnheader">{t("col.date")}</span>
            <span role="columnheader">{t("col.what")}</span>
            <span role="columnheader" className="text-right">{t("col.credits")}</span>
            <span role="columnheader" className="text-right">{t("col.balance")}</span>
          </div>
          {rows.map((e) => (
            <div key={e.id} role="row" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-line-soft py-2.5 first:border-t-0 tablet:grid-cols-[90px_minmax(0,1fr)_90px_80px] tablet:items-center">
              <span role="cell" className="order-3 font-mono text-xs text-fg-3 tablet:order-none">{format.dateTime(new Date(e.createdAt), { month: "short", day: "numeric" })}</span>
              <span role="cell" className="order-1 min-w-0 [overflow-wrap:anywhere] tablet:order-none">
                {what(e)}
                {e.pool === "SAMPLE" ? <span className="ml-1.5 text-xs text-fg-3">· {t("samplePool")}</span> : null}
              </span>
              <span role="cell" className={cn("order-2 text-right font-mono tabular-nums tablet:order-none", e.delta > 0 ? "text-status-approved" : "text-fg")}>
                {e.delta === 0 ? "—" : e.delta > 0 ? `+${e.delta}` : `−${Math.abs(e.delta)}`}
              </span>
              <span role="cell" className="order-4 text-right font-mono text-xs text-fg-3 tabular-nums tablet:order-none tablet:text-[13px] tablet:text-fg">{e.balanceAfter}</span>
            </div>
          ))}
        </div>
      )}
      </Reveal>
      {q.hasNextPage ? (
        <Button size="sm" variant="ghost" className="justify-self-start" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {t("more")}
        </Button>
      ) : null}
    </section>
  )
}

function Runs() {
  const t = useTranslations("credits")
  const format = useFormatter()
  const q = useTemplateRuns()
  const rows: TemplateRunRef[] = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isPending || q.isError || !rows.length) return null
  return (
    <section className="grid gap-3 rounded-lg border border-line bg-card p-4" aria-labelledby="runs-h">
      <span id="runs-h" className="eyebrow">{t("uses")}</span>
      <ul className="m-0 grid list-none p-0 text-[13px]">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-line-soft first:border-t-0">
            <Link href={templateRunHref(r.batchId)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 hover:text-fg">
              <span className="min-w-0">
                <b className="block truncate">{r.selection ? t("runSelection", { name: r.templateName, n: r.selection.slugs.length }) : r.templateName}</b>
                <span className="block truncate text-xs text-fg-3">
                  {r.championName} · {format.dateTime(new Date(r.createdAt), { month: "short", day: "numeric" })}
                </span>
              </span>
              <span className="font-mono text-xs text-fg-2 tabular-nums">
                {r.pool === null ? t("runTeam") : r.status === "SETTLED" ? t("runSettled", { charged: r.charged, refunded: r.refunded }) : t("runHeld", { held: r.held })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {q.hasNextPage ? (
        <Button size="sm" variant="ghost" className="justify-self-start" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {t("more")}
        </Button>
      ) : null}
    </section>
  )
}
