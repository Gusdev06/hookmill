"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { buttonVariants } from "@/components/ui/button"
import { Page } from "@/components/page"
import { useSession } from "@/components/providers/session-provider"
import { ClientAvatar } from "@/components/shell/logo"
import { SoonSection } from "@/components/soon"
import { cn } from "@/lib/utils"

/*
 * Placeholder pages for routes without a screen yet (plan F2): the whole-section "Em breve" with the faded
 * preview of the Ads Machine screen. Everything in the preview is static EXAMPLE data (fase2-agencia §8).
 */
export type SoonPageKey = "campaigns" | "eddy" | "brain" | "clients"

const card = "flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-card px-[18px] py-4"
const tag = "inline-flex h-fit items-center rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap"

function CampaignsPreview() {
  const t = useTranslations("soon.preview")
  const kpis: [string, string][] = [
    [t("spent"), "$8,912"],
    [t("purchases"), "341"],
    [t("cpa"), "$26.13"],
    [t("roas"), "2.41x"],
  ]
  const rows: [string, string, string, string, "warn" | "ok"][] = [
    ["MC_TEST · I tried 11 masks", t("live"), "$2,410", "$26.80", "warn"],
    ["MC_TEST · Flashlight test", t("live"), "$1,380", "$22.10", "ok"],
    ["MC_TEST · Partner reads till 1am", t("paused"), "$640", "$24.90", "ok"],
  ]
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-3">
        {kpis.map(([k, v]) => (
          <div key={k} className={card}>
            <span className="text-[13px] text-fg-3">{k}</span>
            <span className="font-mono text-[26px] font-semibold tracking-[-0.02em]">{v}</span>
          </div>
        ))}
      </div>
      <div className={cn(card, "gap-0 overflow-x-auto")}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-xs text-fg-3">
              <th className="border-b border-line px-2.5 py-2 font-semibold">{t("campaign")}</th>
              <th className="border-b border-line px-2.5 py-2 font-semibold">{t("status")}</th>
              <th className="border-b border-line px-2.5 py-2 text-right font-semibold">{t("spent")}</th>
              <th className="border-b border-line px-2.5 py-2 text-right font-semibold">CPA</th>
              <th className="border-b border-line px-2.5 py-2 font-semibold">Eddy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([n, s, sp, cpa, tone]) => (
              <tr key={n}>
                <td className="border-b border-line-soft px-2.5 py-2.5 whitespace-nowrap">{n}</td>
                <td className="border-b border-line-soft px-2.5 py-2.5">{s}</td>
                <td className="border-b border-line-soft px-2.5 py-2.5 text-right font-mono">{sp}</td>
                <td className="border-b border-line-soft px-2.5 py-2.5 text-right font-mono">{cpa}</td>
                <td className="border-b border-line-soft px-2.5 py-2.5">
                  <span className={cn(tag, tone === "warn" ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok")}>{tone === "warn" ? t("tiring") : t("winner")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function EddyPreview() {
  const t = useTranslations("soon.preview")
  const notes: [string, string, string][] = [
    [t("tiring"), "bg-warn-bg text-warn", t("note1")],
    [t("working"), "bg-ok-bg text-ok", t("note2")],
    [t("gap"), "bg-info-bg text-info", t("note3")],
  ]
  return (
    <div className="flex flex-col gap-2.5">
      {notes.map(([k, c, n]) => (
        <div key={k} className={cn(card, "flex-row items-start gap-3")}>
          <span className={cn(tag, "uppercase", c)}>{k}</span>
          <span className="text-[13px]">{n}</span>
        </div>
      ))}
    </div>
  )
}

function BrainPreview() {
  const t = useTranslations("soon.preview")
  const sections: [string, number][] = [
    [t("business"), 100],
    [t("audience"), 80],
    [t("proof"), 60],
    [t("voice"), 40],
    [t("competitors"), 0],
    [t("learnings"), 0],
  ]
  return (
    <>
      <div className={cn(card, "gap-2")}>
        <b>{t("complete", { pct: 62 })}</b>
        <div className="h-2 overflow-hidden rounded-full bg-line-soft">
          <i className="block h-full w-[62%] rounded-full bg-fg" />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3">
        {sections.map(([k, v]) => (
          <div key={k} className={card}>
            <b>{k}</b>
            <span className="font-mono text-xs text-fg-3">{v}%</span>
          </div>
        ))}
      </div>
    </>
  )
}

function ClientsPreview() {
  const t = useTranslations("soon.preview")
  const clients: [string, string, string, number][] = [
    ["Mooncloth", t("live"), "bg-ok-bg text-ok", 3],
    ["Northpeak Dental", t("setupStep", { n: 3 }), "bg-warn-bg text-warn", 0],
    ["Brightside", t("paused"), "bg-card-2 text-fg-2 border border-line-soft", 1],
  ]
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
      {clients.map(([n, s, c, w]) => (
        <div key={n} className={cn(card, "gap-3")}>
          <div className="flex items-center gap-2.5">
            <ClientAvatar name={n} />
            <b className="min-w-0 flex-1 truncate">{n}</b>
            <span className={cn(tag, c)}>{s}</span>
          </div>
          <span className="text-[13px] text-fg-3">{t("waiting", { count: w })}</span>
        </div>
      ))}
    </div>
  )
}

const PREVIEW: Record<SoonPageKey, () => React.ReactNode> = {
  campaigns: CampaignsPreview,
  eddy: EddyPreview,
  brain: BrainPreview,
  clients: ClientsPreview,
}

export function SoonPage({ section }: { section: SoonPageKey }) {
  const t = useTranslations()
  const { session } = useSession()
  const client = session.workspace.name
  const Preview = PREVIEW[section]
  const [primary, secondary]: [{ href: string; label: string }, { href: string; label: string }] =
    section === "campaigns"
      ? [{ href: "/iterate/new", label: t("soon.actions.iterate") }, { href: "/library", label: t("soon.actions.library") }]
      : section === "eddy"
        ? [{ href: "/creatives/new", label: t("soon.actions.concepts") }, { href: "/library", label: t("soon.actions.library") }]
        : section === "brain"
          ? [{ href: "/offers", label: t("soon.actions.offers") }, { href: "/library", label: t("soon.actions.library") }]
          : [{ href: "/", label: t("soon.actions.home") }, { href: "/library", label: t("soon.actions.library") }]

  return (
    <Page>
      <SoonSection
        title={t(section === "clients" ? "shell.clients" : `shell.nav.${section}`)}
        eyebrow={section === "campaigns" ? t("soon.campaigns.eyebrow", { client }) : undefined}
        heading={t(`soon.${section}.heading`, { client })}
        promise={t(`soon.${section}.promise`)}
        actions={
          <>
            <Link href={primary.href} className={buttonVariants({ variant: "brand" })}>
              {primary.label}
            </Link>
            <Link href={secondary.href} className={buttonVariants({ variant: "outline" })}>
              {secondary.label}
            </Link>
          </>
        }
        exampleLabel={t("soon.exampleNotYours", { client })}
        preview={<Preview />}
      />
    </Page>
  )
}
