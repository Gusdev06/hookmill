"use client"

import { Suspense } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { Page, PageHead } from "@/components/page"
import { MetaConnect, useMetaConnect } from "@/components/meta/meta-connect"
import { AccountModeCard } from "@/components/settings/account-mode-card"
import { useSession } from "@/components/providers/session-provider"
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
  const { session } = useSession()
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get })
  const m = useMetaConnect("/settings/connections")
  const name = ws.data?.name ?? session.workspace.name
  const connected = m.state === "ok" || m.state === "warning" || m.state === "blocked" || m.state === "checking"
  return (
    <Page>
      <PageHead title={t("connections")} sub={t("connectionsSub")} />
      <div className="grid max-w-[760px] grid-cols-[minmax(0,1fr)] gap-4">
        {m.state === "off" ? null : (
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
        <AccountModeCard />
      </div>
    </Page>
  )
}
