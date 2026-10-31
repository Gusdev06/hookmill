"use client"

import { Suspense } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { Page, PageHead } from "@/components/page"
import { MetaConnect, useMetaConnect } from "@/components/meta/meta-connect"
import { AccountModeCard } from "@/components/settings/account-mode-card"
import { useSession } from "@/components/providers/session-provider"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Settings › Connections (spec decision 6): the same MetaConnect as step 2, plus the Account mode card. */
export default function ConnectionsPage() {
  return (
    <Suspense>
      <Connections />
    </Suspense>
  )
}

function Connections() {
  const t = useTranslations("settings")
  const tm = useTranslations("meta")
  const tt = useTranslations("metaTemplates")
  const { session } = useSession()
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get })
  const m = useMetaConnect("/settings/connections")
  const name = ws.data?.name ?? session.workspace.name
  const connected = m.state === "ok" || m.state === "warning" || m.state === "blocked" || m.state === "checking"
  return (
    <Page>
      <PageHead title={t("connections")} sub={t("connectionsSub")} />
      <div className="grid max-w-[760px] grid-cols-[minmax(0,1fr)] gap-4">
        {/* QA layout 29/10 (3rd round): while the connection loads, placeholders at the size of the connected cards (the usual
            case), instead of the short "Connect" card that grew and pushed the page down */}
        {m.connection.isPending ? (
          <>
            <span className="sk h-[627px] rounded-xl tablet:h-[554px]" aria-hidden="true" />
            <span className="sk h-[152px] rounded-xl tablet:h-[89px]" aria-hidden="true" />
          </>
        ) : m.state === "off" ? null : (
          <section className="flex min-w-0 flex-col gap-3.5 rounded-xl border border-line bg-card p-4 tablet:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <h2 className="text-base font-bold">{tm("settings.title")}</h2>
              <span className={cn("inline-flex h-fit items-center rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap", connected ? "bg-status-approved-bg text-status-approved" : "bg-status-waiting-bg text-status-waiting")}>
                {connected ? tm("settings.connected") : tm("settings.notConnected")}
              </span>
            </div>
            <MetaConnect m={m} mode="settings" clientName={name} />
          </section>
        )}
        {m.state === "ok" || m.state === "warning" ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-4 tablet:p-5">
            <div className="grid min-w-0 flex-[1_1_280px] gap-1">
              <h2 className="text-base font-bold">{tt("title")}</h2>
              <span className="text-[13px] text-fg-2">{tt("cardBody")}</span>
            </div>
            <Link href="/settings/connections/templates" className={buttonVariants({ size: "sm" })}>
              {tt("manage")}
            </Link>
          </section>
        ) : null}
        <AccountModeCard />
      </div>
    </Page>
  )
}
