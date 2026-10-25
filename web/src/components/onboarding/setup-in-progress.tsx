"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { ClientAvatar } from "@/components/shell/logo"
import { MinimalShell } from "@/components/shell/minimal-shell"
import { useOpenClient } from "@/components/clients/open-client"
import { useSession } from "@/components/providers/session-provider"
import { useMe } from "@/hooks/use-me"
import { OnboardingError, OnboardingLoading, percentOf, stepsOf } from "./shared"

/*
 * "Setup in progress" (onboarding-v2 §3.2, spec §5): what a MEMBER / CLIENT sees while the active workspace is in SETUP.
 * No shell: who is setting it up (`onboarding.updatedBy`), the step and %, the other workspaces to switch to, Sign out.
 */
export function SetupInProgress() {
  const t = useTranslations("waiting")
  const to = useTranslations("onboarding")
  const { session, logout } = useSession()
  const me = useMe()
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get, refetchInterval: 30_000 })
  const { open, pending, opening } = useOpenClient()

  if (ws.isError && !ws.data) return <OnboardingError error={ws.error} retry={() => ws.refetch()} />
  if (!ws.data) return <OnboardingLoading />
  const w = ws.data
  const steps = stepsOf(w)
  const pos = Math.max(0, steps.findIndex((s) => s.step === w.onboarding.step))
  const pct = percentOf(w)
  const by = w.onboarding.updatedBy?.name ?? null
  const others = (me.data?.workspaces ?? []).filter((x) => x.id !== session.workspace.id)

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
        <h1 className="text-pretty">{by ? t("titleBy", { by, name: w.name }) : t("title", { name: w.name })}</h1>
        <p className="m-0 text-fg-3 text-pretty">{t("lede")}</p>
      </div>
      <div className="flex flex-col gap-3.5 rounded-xl border border-line bg-card p-4 tablet:p-5">
        <div className="flex items-center gap-2.5">
          <ClientAvatar name={w.name} className="size-9" />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate">{w.name}</b>
            <small className="text-xs text-fg-3">{to("stepOfNamed", { n: pos + 1, total: steps.length, title: steps[pos] ? to(`rail.${steps[pos].key}.title`) : "" })}</small>
          </span>
          <span className="font-mono text-[22px] font-semibold tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={to("setUp")}>
          <i className="block h-full rounded-full bg-brand-edge transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {others.length ? (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 tablet:p-5">
          <h2 className="text-base font-bold">{t("others")}</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {others.map((o) => {
              const setup = o.status === "SETUP"
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-3 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0">
                  <ClientAvatar name={o.name} className="size-8" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{o.name}</span>
                  {setup ? <span className="text-xs text-fg-3">{to("setupPct", { pct: o.onboarding?.percent ?? 0 })}</span> : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || setup}
                    aria-busy={pending && opening === o.id}
                    onClick={() => open({ id: o.id, status: o.status ?? "LIVE", onboarding: { step: o.onboarding?.step ?? 1, completedAt: o.onboarding?.completedAt ?? "done" } })}
                  >
                    {t("open")}
                    <Icon name="arrowr" />
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </MinimalShell>
  )
}
