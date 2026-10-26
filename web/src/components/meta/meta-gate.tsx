"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { MetaConnection } from "@/lib/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { isMetaOff, useMetaConnection } from "@/hooks/use-meta"
import { effectiveRole } from "@/lib/dev-role"
import { cn } from "@/lib/utils"

/*
 * Meta gate (Gusta 25/10): any ad data (spend, CPA, ROAS, CTR, results, campaigns, ad sets, ads, Meta ranking) shows ONLY
 * with the workspace's ad account connected and usable. Otherwise: no zeros, no placeholders, no mock numbers — a lock
 * with Connect Meta (or Reconnect when the login expired or a permission is missing). State from GET /meta/connection.
 *   off      META_NOT_CONFIGURED: the server has no Meta → Meta surfaces stay hidden (as before)
 *   none     never connected / disconnected → Connect Meta (OAuth)
 *   choose   connected, no ad account + Page chosen yet → Settings › Connections
 *   expired  TOKEN_INVALID → Reconnect (OAuth)
 *   broken   ACTIVE but a blocking check failed on token / scopes / ad account (e.g. a permission missing) → Reconnect
 *   ready    data can be shown
 */
export type MetaGateState = "loading" | "failed" | "off" | "none" | "choose" | "expired" | "broken" | "ready"
const BLOCKING = ["token", "scopes", "account"] as const

export function metaGateOf(c: MetaConnection | null | undefined): Exclude<MetaGateState, "loading" | "failed" | "off"> {
  if (!c || c.status === "DISCONNECTED") return "none"
  if (c.status === "TOKEN_INVALID") return "expired"
  if (c.health?.checks.some((x) => (BLOCKING as readonly string[]).includes(x.key) && x.level === "bad")) return "broken"
  if (!c.adAccount || !c.page) return "choose"
  return "ready"
}

export function useMetaGate() {
  const conn = useMetaConnection()
  const state: MetaGateState = conn.isPending
    ? "loading"
    : conn.isError
      ? isMetaOff(conn.error)
        ? "off"
        : "failed"
      : metaGateOf(conn.data)
  return { state, conn, ready: state === "ready" }
}

/** States that mean "show the lock instead of the numbers". */
export const isLocked = (s: MetaGateState) => s === "none" || s === "choose" || s === "expired" || s === "broken"

/** The action: OAuth for none / expired / broken (back on Settings › Connections to pick the account), a link for choose. */
function GateAction({ state, size }: { state: MetaGateState; size?: "sm" | "default" }) {
  const t = useTranslations("metaGate")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const canConnect = role === "OWNER" || role === "ADMIN"
  const connect = useMutation({
    mutationFn: () => api.meta.connect({ returnTo: "/settings/connections" }),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (e) => toast(errorMessage(e)),
  })
  if (!canConnect) return <span className="text-[13px] text-fg-3">{t("askAdmin")}</span>
  if (state === "choose")
    return (
      <Link href="/settings/connections" className={buttonVariants({ variant: "brand", size })}>
        {t("choose")}
        <Icon name="arrowr" />
      </Link>
    )
  return (
    <Button variant="brand" size={size} disabled={connect.isPending} onClick={() => connect.mutate()}>
      {connect.isPending ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : <Icon name={state === "none" ? "link" : "refresh"} />}
      {state === "none" ? t("connect") : t("reconnect")}
    </Button>
  )
}

function copy(t: ReturnType<typeof useTranslations<"metaGate">>, state: MetaGateState, what: "screen" | "metrics") {
  const s = state === "expired" || state === "broken" || state === "choose" ? state : "none"
  return { title: t(`${what}.${s}.title`), body: t(`${what}.${s}.body`) }
}

/** Whole screen that only makes sense with Meta (Campaigns): the lock takes the place of the content. */
export function MetaLockScreen({ state, section }: { state: MetaGateState; section: string }) {
  const t = useTranslations("metaGate")
  const { title, body } = copy(t, state, "screen")
  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-6 px-[var(--gut)] pt-5 pb-16 tablet:pt-7">
      <h1 className="m-0">{section}</h1>
      <section
        aria-labelledby="meta-lock-h"
        className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-3.5 rounded-xl border border-line bg-card px-5 py-10 text-center tablet:px-10 tablet:py-14"
      >
        <span className={cn("grid size-12 place-items-center rounded-full", state === "expired" || state === "broken" ? "bg-status-waiting-bg text-status-waiting" : "bg-card-2 text-fg-2")}>
          <Icon name="lock" />
        </span>
        <span className="eyebrow">{t(`eyebrow.${state === "expired" || state === "broken" ? "attention" : "locked"}`)}</span>
        <h2 id="meta-lock-h" className="m-0 text-xl font-bold text-balance">{title}</h2>
        <p className="m-0 max-w-[440px] text-pretty text-fg-3">{body}</p>
        <GateAction state={state} />
      </section>
    </div>
  )
}

/** Mixed screens: the metric blocks become this card; the rest of the screen keeps working. */
export function MetaLockCard({ state, className, compact }: { state: MetaGateState; className?: string; compact?: boolean }) {
  const t = useTranslations("metaGate")
  const { title, body } = copy(t, state, "metrics")
  const warn = state === "expired" || state === "broken"
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 tablet:flex-row tablet:items-center tablet:gap-4 tablet:p-[18px]",
        warn ? "border-status-waiting-edge bg-status-waiting-bg" : "border-line bg-card",
        className
      )}
    >
      <span className={cn("hidden size-10 flex-none place-items-center rounded-full tablet:grid", warn ? "bg-card text-status-waiting" : "bg-card-2 text-fg-2")}>
        <Icon name="lock" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <b className={compact ? "text-sm" : "text-[15px]"}>{title}</b>
        <span className="text-[13px] text-pretty text-fg-2">{body}</span>
      </div>
      <div className="flex-none [&>*]:w-full tablet:[&>*]:w-auto">
        <GateAction state={state} size="sm" />
      </div>
    </section>
  )
}
