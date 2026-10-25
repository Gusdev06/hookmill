"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { ClientCard } from "@/lib/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { ClientAvatar } from "@/components/shell/logo"
import { MinimalShell } from "@/components/shell/minimal-shell"
import { NewClientDialog } from "@/components/clients/new-client-dialog"
import { useOpenClient } from "@/components/clients/open-client"
import { OnboardingError, OnboardingLoading, onboardingHref, percentOf, stepsOf } from "@/components/onboarding/shared"
import { useSession } from "@/components/providers/session-provider"
import { useAccountMode } from "@/hooks/use-me"
import { cn } from "@/lib/utils"

/*
 * /onboarding/saved · the resume screen after "Save and exit" (spec decision 4): the client with its % and the lime
 * "Continue setup"; AGENCY also lists the other clients (Live → Open, Setup → Continue setup) and "New client";
 * OWN only "Sign out" and "Next time you sign in, you land right here".
 */
export default function SavedPage() {
  const t = useTranslations("saved")
  const to = useTranslations("onboarding")
  const tc = useTranslations("clients")
  const { session, logout } = useSession()
  const mode = useAccountMode()
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get })
  const clients = useQuery({ queryKey: ["clients"], queryFn: ({ signal }) => api.clients.list({ signal }), enabled: mode === "AGENCY" })
  const { open, pending, opening } = useOpenClient()
  const [creating, setCreating] = useState(false)

  if (ws.isError && !ws.data) return <OnboardingError error={ws.error} retry={() => ws.refetch()} />
  if (!ws.data) return <OnboardingLoading />
  const w = ws.data
  const steps = stepsOf(w)
  const pos = Math.max(0, steps.findIndex((s) => s.step === w.onboarding.step))
  const pct = percentOf(w)
  const nextName = steps[pos] ? to(`rail.${steps[pos].key}.title`) : ""
  const others = (clients.data?.data ?? []).filter((c) => c.id !== session.workspace.id)

  return (
    <MinimalShell
      narrow
      right={
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          {t("signOut")}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="text-pretty">{t("title", { name: w.name, n: pos + 1 })}</h1>
        <p className="m-0 text-fg-3 text-pretty">{mode === "OWN" ? t("ledeOwn") : t("ledeAgency", { name: w.name })}</p>
      </div>

      <div className="flex flex-col gap-3.5 rounded-xl border-[1.5px] border-fg bg-card p-4 tablet:p-5">
        <div className="flex items-center gap-2.5">
          <ClientAvatar name={w.name} className="size-9" />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate">{w.name}</b>
            <small className="text-xs text-fg-3">
              {mode === "OWN" ? t("yourWorkspace") : t("clientWorkspace")} · {to("setupPct", { pct })}
            </small>
          </span>
          <span className="inline-flex h-fit items-center rounded-full bg-status-waiting-bg px-2 py-[3px] text-[11px] font-bold whitespace-nowrap text-status-waiting">{t("setupTag")}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={to("setUp")}>
          <i className="block h-full rounded-full bg-brand-edge transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[13px] text-fg-3">{t("next", { step: nextName })}</span>
        <Link href={onboardingHref(w.onboarding.step)} className={buttonVariants({ variant: "brand", size: "lg" })}>
          {t("continue")}
          <Icon name="arrowr" />
        </Link>
      </div>

      {mode === "AGENCY" ? (
        <div className="flex flex-col gap-3.5 rounded-xl border border-line bg-card p-4 tablet:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <h2 className="text-base font-bold">{t("others")}</h2>
            <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              {tc("new")}
            </Button>
          </div>
          {clients.isPending ? (
            <div className="grid gap-3 tablet:grid-cols-2" aria-busy="true">
              <span className="sk h-[96px] rounded-xl" />
              <span className="sk h-[96px] rounded-xl" />
            </div>
          ) : others.length ? (
            <div className="grid gap-3 tablet:grid-cols-2">
              {others.map((c) => (
                <OtherTile key={c.id} c={c} busy={pending && opening === c.id} disabled={pending} onOpen={() => open(c)} />
              ))}
            </div>
          ) : (
            <p className="m-0 text-[13px] text-fg-3">{t("noOthers")}</p>
          )}
          <NewClientDialog open={creating} onOpenChange={setCreating} />
        </div>
      ) : (
        <p className="m-0 text-[13px] text-fg-3">{t("ownNote")}</p>
      )}
    </MinimalShell>
  )
}

function OtherTile({ c, busy, disabled, onOpen }: { c: ClientCard; busy: boolean; disabled: boolean; onOpen: () => void }) {
  const t = useTranslations("saved")
  const tc = useTranslations("clients")
  const setup = !c.onboarding.completedAt
  const pct = typeof c.onboarding.percent === "number" ? c.onboarding.percent : Math.round(((c.onboarding.step - 1) / 6) * 100)
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-card p-4">
      <div className="flex items-center gap-2.5">
        <ClientAvatar name={c.name} className="size-9" />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate">{c.name}</b>
          <small className="truncate text-xs text-fg-3">
            {setup ? tc("status.SETUP", { n: c.onboarding.step }) : c.waitingOnYou.total ? t("liveWaiting", { count: c.waitingOnYou.total }) : tc("status.LIVE")}
          </small>
        </span>
        <span
          className={cn(
            "inline-flex h-fit items-center rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap",
            setup ? "bg-status-waiting-bg text-status-waiting" : c.status === "PAUSED" ? "bg-card-2 text-fg-2" : "bg-status-approved-bg text-status-approved"
          )}
        >
          {setup ? t("setupPctTag", { pct }) : tc(`status.${c.status === "PAUSED" ? "PAUSED" : "LIVE"}`)}
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={onOpen} disabled={disabled} aria-busy={busy} className="self-start">
        {busy ? tc("opening") : setup ? t("continue") : t("open")}
        <Icon name="arrowr" />
      </Button>
    </div>
  )
}
