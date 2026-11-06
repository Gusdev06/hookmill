"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { useSession } from "@/components/providers/session-provider"
import { useCredits } from "@/hooks/use-templates"
import { CREDITS_HREF } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { useBalanceText } from "./parts"
import { Reveal } from "@/components/ui/reveal"

/*
 * Balance always in sight (spec §6): a meter in the sidebar footer (desktop) and a pill in the phone's top bar, both leading
 * to Get credits. CLIENT (no access to /credits) and an API without the route show nothing.
 */
/** `id`: only the desktop sidebar's meter carries `t-credits` (tour-v2 stop 3); the phone sheet's copy doesn't. */
export function CreditsMeter({ onNavigate, id }: { onNavigate?: () => void; id?: string }) {
  const t = useTranslations("adTemplates.meter")
  const tl = useTranslations("skeleton")
  const { session } = useSession()
  const q = useCredits()
  if (session.workspace.role === "CLIENT" || q.isError) return null
  const c = q.data
  const value = !c ? null : c.unlimited ? "∞" : c.access === "SAMPLE" ? (c.sample?.left ?? 0) : (c.balance ?? c.credits)
  const pct = !c ? 0 : c.unlimited ? 100 : c.access === "SAMPLE" && c.sample ? (c.sample.left / Math.max(1, c.sample.total)) * 100 : Math.min(100, Number(value))
  return (
    <div id={id} className="grid gap-1.5 rounded-md border border-ink-line p-2.5 text-xs text-ink-fg-2">
      <span>{!c ? t("credits") : c.unlimited ? t("team") : c.access === "SAMPLE" ? t("freeUses") : t("credits")}</span>
      <Reveal loading={value === null} id="credits.meter" label={tl("credits")}>
        <b className="wide block text-lg leading-none font-extrabold text-ink-fg tabular-nums">{value ?? "120"}</b>
      </Reveal>
      <div className="h-1 overflow-hidden rounded-full bg-ink-3" aria-hidden="true">
        <i className="block h-full bg-ink-fg-2" style={{ width: `${pct}%` }} />
      </div>
      <Link href={CREDITS_HREF} onClick={onNavigate} className="rounded-sm border border-ink-line px-2 py-1.5 text-center text-xs text-ink-fg no-underline hover:border-ink-fg">
        {t("get")}
      </Link>
    </div>
  )
}

export function CreditsPill({ className }: { className?: string }) {
  const { session } = useSession()
  const q = useCredits()
  const text = useBalanceText()
  if (session.workspace.role === "CLIENT" || q.isError || !q.data) return null
  return (
    <Link
      id="t-credits-pill"
      href={CREDITS_HREF}
      className={cn("inline-flex min-h-9 flex-none items-center rounded-sm border border-ink-line px-2 font-mono text-xs whitespace-nowrap text-ink-fg no-underline", className)}
    >
      {text(q.data)}
    </Link>
  )
}
