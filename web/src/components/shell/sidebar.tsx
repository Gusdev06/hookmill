"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Dialog as DialogPrimitive } from "radix-ui"
import { toast } from "sonner"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSession } from "@/components/providers/session-provider"
import { api } from "@/lib/api/client"
import { switchWorkspace } from "@/lib/session/token"
import { cn } from "@/lib/utils"
import { SoonBadge } from "@/components/soon"
import { startReplay } from "@/components/tour/tour-state"
import { useResetTips } from "@/components/tour/tip"
import { useAccountMode, useMe } from "@/hooks/use-me"
import { useResearchStatus } from "@/hooks/use-research"
import { isMetaOff, metaReady, useMetaConnection, useRelativeTime } from "@/hooks/use-meta"
import { LanguageToggle } from "./language-toggle"
import { ClientAvatar, LogoMark } from "./logo"
import { NavIcon, type NavIconName } from "./nav-icon"
import { TEMPLATES } from "@/lib/flags"
import { TEMPLATES_ADMIN_HREF } from "@/lib/routes"
import { CreditsMeter, CreditsPill } from "@/components/templates/credits-meter"
import { useIsTeamOwner } from "@/components/templates/admin"

/*
 * App shell (fase2-telas-novas §4, plan §1): dark sidebar instead of the header with tabs.
 * WORKSPACE: Home, Campaigns (soon), Eddy (soon), Brain · MAKE ADS: Iterate a winner, New concepts, Review, Library
 * · footer: All clients (AGENCY) or Settings (OWN), account, EN/PT. ≤760 px: dark top bar (client + menu) and the same
 * nav in a sheet from the top. onboarding-v2 decision 11: in OWN mode the client selector becomes the workspace identity
 * card (name + Meta status → Settings › Connections); no "All clients", no "New client"; role shown as "Owner".
 */
type NavKey = "home" | "campaigns" | "eddy" | "brain" | "radar" | "iterate" | "templates" | "aiVariations" | "concepts" | "review" | "library" | "clients" | "settings" | "admin"

/** Home v2 (31/10): the full list left Home; Review opens it filtered */
export const REVIEW_HREF = "/creatives?filter=needs_you"
const NAV: { group: "groupWorkspace" | "groupMakeAds"; items: { key: NavKey; href: string; icon: NavIconName; soon?: boolean }[] }[] = [
  {
    group: "groupWorkspace",
    items: [
      { key: "home", href: "/", icon: "home" },
      // campanhas-v1: real screen; "Soon" only while the server has Meta off (META_MODE=off)
      { key: "campaigns", href: "/campaigns", icon: "chart" },
      { key: "eddy", href: "/eddy", icon: "chat", soon: true },
      { key: "brain", href: "/brain", icon: "brain" },
    ],
  },
  {
    group: "groupMakeAds",
    items: [
      // ads-research-v1 C.1: Ad Radar on top of Make ads (the step before Templates); "Soon" while ADS_RESEARCH_MODE=off
      { key: "radar", href: "/radar", icon: "radar" },
      // templates-creditos-v1 T1 (31/10): Templates replaces "Iterate a winner" (/iterate stays reachable from the links to it)
      TEMPLATES ? { key: "templates", href: "/templates", icon: "iter" } : { key: "iterate", href: "/iterate/new", icon: "iter" },
      { key: "concepts", href: "/creatives/new", icon: "bulb" },
      { key: "review", href: REVIEW_HREF, icon: "review" },
      { key: "library", href: "/library", icon: "lib" },
    ],
  },
]

function useActive(): NavKey | null {
  const pathname = usePathname()
  const filter = useSearchParams().get("filter")
  if (pathname === "/") return "home"
  if (pathname === "/creatives") return filter === "needs_you" ? "review" : "library"
  if (pathname.startsWith("/templates/admin")) return "admin"
  const first = pathname.split("/")[1]
  const map: Record<string, NavKey> = {
    campaigns: "campaigns", eddy: "eddy", brain: "brain", offers: "brain", radar: "radar",
    "ai-variations": "aiVariations",
    variations: TEMPLATES ? "templates" : "iterate", iterate: TEMPLATES ? "templates" : "iterate", templates: "templates", credits: "templates", creatives: "concepts", library: "library", clients: "clients", onboarding: "clients", settings: "settings",
  }
  return map[first] ?? null
}

/** Same query as the Home "Waiting for you" list (shared cache); the Review badge = creatives only (fase2-agencia §3.6). */
function useReviewCount() {
  const q = useQuery({
    queryKey: ["creatives", { filter: "needs_you", limit: 6 }],
    queryFn: ({ signal }) => api.creatives.list({ filter: "needs_you", limit: 6 }, { signal }),
    refetchInterval: 30_000,
  })
  return q.data?.meta.counts.needs_you ?? 0
}

const itemCls =
  "flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left font-medium text-ink-fg-2 hover:bg-ink-2 hover:text-ink-fg [&>svg]:text-ink-fg-3 aria-[current=page]:bg-ink-3 aria-[current=page]:font-bold aria-[current=page]:text-white aria-[current=page]:[&>svg]:text-brand"

function NavLink({ href, icon, active, children, onNavigate }: { href: string; icon: NavIconName; active: boolean; children: React.ReactNode; onNavigate?: () => void }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={itemCls} onClick={onNavigate}>
      <NavIcon name={icon} />
      {children}
    </Link>
  )
}

const topCls = "flex w-full min-w-0 items-center gap-2.5 rounded-btn border border-ink-line bg-ink-2 text-left text-ink-fg outline-none hover:border-[#3a3f46] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info-on-ink"

/** Client selector = workspace switch (POST /auth/switch-workspace through /api/session). "All clients" at the end. Clients in setup show "Setup 33 %". */
function ClientSwitcher({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const t = useTranslations("shell")
  const to = useTranslations("onboarding")
  const { session } = useSession()
  const router = useRouter()
  const qc = useQueryClient()
  const [pending, start] = useTransition()
  const me = useMe()
  const active = me.data?.workspace ?? session.workspace
  const name = active.name
  const others = me.data?.workspaces ?? [session.workspace]
  const setupLine = (w: { status?: string; onboarding?: { percent: number } }) => (w.status === "SETUP" ? to("setupPct", { pct: w.onboarding?.percent ?? 0 }) : null)

  const change = (id: string) => {
    if (id === session.workspace.id) return
    start(async () => {
      try {
        await switchWorkspace(id)
        qc.clear()
        onNavigate?.()
        router.push("/")
      } catch {
        toast.error(t("switchFailed"))
      }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t("switchClient", { name })} aria-busy={pending} className={cn(topCls, compact ? "min-h-10 px-2 py-1" : "min-h-14 px-2.5 py-2")}>
        <ClientAvatar name={name} className={compact ? "size-[26px] text-xs" : undefined} />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate font-bold">{pending ? t("switching") : name}</b>
          {compact ? null : <small className="truncate text-xs text-ink-fg-3">{setupLine(active) ?? t("clientWorkspace")}</small>}
        </span>
        <NavIcon name="updown" size={compact ? 16 : 18} className="text-ink-fg-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
        <DropdownMenuLabel className="eyebrow">{t("clients")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={session.workspace.id} onValueChange={change}>
          {others.map((w) => {
            const line = setupLine(w)
            return (
              <DropdownMenuRadioItem key={w.id} value={w.id} disabled={pending} className="min-h-10">
                <span className="truncate">{w.name}</span>
                {line ? <span className="ml-auto rounded-full bg-status-waiting-bg px-1.5 py-px font-mono text-[10px] font-semibold whitespace-nowrap text-status-waiting">{line}</span> : null}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-10">
          <Link href="/clients" onClick={onNavigate}>
            <NavIcon name="bld" size={16} />
            {t("nav.clients")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** OWN mode (spec decision 11): the workspace identity card with the Meta status line; leads to Settings › Connections. */
function WorkspaceIdentity({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const t = useTranslations("shell")
  const { session } = useSession()
  const me = useMe()
  const name = me.data?.workspace.name ?? session.workspace.name
  const conn = useMetaConnection()
  const rel = useRelativeTime()
  const off = conn.isError && isMetaOff(conn.error)
  const ready = metaReady(conn.data)
  return (
    <Link href="/settings/connections" onClick={onNavigate} className={cn(topCls, "no-underline", compact ? "min-h-10 px-2 py-1" : "min-h-14 px-2.5 py-2")}>
      <ClientAvatar name={name} className={compact ? "size-[26px] text-xs" : undefined} />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate font-bold">{name}</b>
        {compact || off || conn.isPending ? null : (
          <small className={cn("flex items-center gap-1.5 truncate text-xs", ready ? "text-[#8bd7a9]" : "text-[#efc45a]")}>
            <i className="size-2 flex-none rounded-full bg-current" aria-hidden="true" />
            {ready ? t("metaOk", { ago: rel(conn.data?.lastSyncAt ?? conn.data?.connectedAt) }) : t("metaOff")}
          </small>
        )}
      </span>
    </Link>
  )
}

function Account({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations()
  const { session, logout } = useSession()
  const mode = useAccountMode()
  const resetTips = useResetTips()
  const initials = session.user.name.slice(0, 1).toUpperCase()
  const role = mode === "OWN" && session.workspace.role === "OWNER" ? t("shell.ownRole") : t(`shell.roleLabel.${session.workspace.role}`)
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("common.account")}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info-on-ink"
        >
          <span className="inline-grid size-8 flex-none place-items-center rounded-full bg-ink-line text-[13px] font-bold text-ink-fg" aria-hidden="true">
            {initials}
          </span>
          <span className="flex min-w-0 flex-col">
            <b className="truncate font-semibold text-ink-fg">{session.user.name}</b>
            <small className="truncate text-xs text-ink-fg-3">{role}</small>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="min-w-52">
          <DropdownMenuLabel className="grid gap-0.5 font-normal">
            <span className="font-medium text-fg">{session.user.name}</span>
            <span className="truncate text-xs text-fg-2">{session.user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings" onClick={onNavigate}>
              {t("shell.nav.settings")}
            </Link>
          </DropdownMenuItem>
          {/* tour-v2: the provider takes the replay to its first stop; "Show tips again" clears the tips seen */}
          <DropdownMenuItem
            onSelect={() => {
              startReplay()
              onNavigate?.()
            }}
          >
            {t("tour.replay")}
          </DropdownMenuItem>
          {session.workspace.role === "CLIENT" ? null : (
            <DropdownMenuItem
              onSelect={() => {
                resetTips()
                onNavigate?.()
                toast(t("tour.tipsResetDone"))
              }}
            >
              {t("tour.tipsReset")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void logout()}>{t("common.logout")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LanguageToggle persist className="p-0.5 [&>button]:px-2 [&>button]:py-1 [&>button]:font-mono [&>button]:text-[11px]" />
    </div>
  )
}

/** Sidebar content (desktop column and mobile sheet share it). */
function SidebarNav({ onNavigate, showClient = true }: { onNavigate?: () => void; showClient?: boolean }) {
  const t = useTranslations("shell")
  const active = useActive()
  const review = useReviewCount()
  const mode = useAccountMode()
  const metaConn = useMetaConnection()
  const metaOff = metaConn.isError && isMetaOff(metaConn.error)
  const team = useIsTeamOwner()
  const radar = useResearchStatus()
  const tr = useTranslations("radar.bar")
  const radarSyncing = radar.data?.discovery.status === "QUEUED" || radar.data?.discovery.status === "RUNNING"
  return (
    <>
      {showClient ? mode === "OWN" ? <WorkspaceIdentity onNavigate={onNavigate} /> : <ClientSwitcher onNavigate={onNavigate} /> : null}
      {NAV.map((g) => (
        <div key={g.group} className="flex flex-col gap-0.5">
          <span className="px-2.5 pb-1.5 font-mono text-[11px] tracking-[0.08em] text-ink-fg-3 uppercase">{t(g.group)}</span>
          {g.items.map((it) => (
            <NavLink key={it.key} href={it.href} icon={it.icon} active={active === it.key} onNavigate={onNavigate}>
              {t(`nav.${it.key}`)}
              {it.soon || (it.key === "campaigns" && metaOff) || (it.key === "radar" && radar.data?.mode === "off") ? <SoonBadge mini /> : null}
              {it.key === "radar" && radarSyncing ? (
                <span className="ml-auto rounded-full border border-ink-line bg-ink-3 px-1.5 font-mono text-[10px] text-ink-fg-2">{tr("syncing")}</span>
              ) : null}
              {it.key === "review" && review > 0 ? (
                <span className="ml-auto rounded-full bg-brand px-[7px] py-px font-mono text-[11px] font-semibold text-[#15171a]">
                  {review}
                  <span className="sr-only"> ({t("reviewCount", { count: review })})</span>
                </span>
              ) : null}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="mt-auto flex flex-col gap-2.5 border-t border-ink-line pt-3">
        {TEMPLATES ? <CreditsMeter onNavigate={onNavigate} id={onNavigate ? undefined : "t-credits"} /> : null}
        {TEMPLATES && team ? (
          <NavLink href={TEMPLATES_ADMIN_HREF} icon="folder" active={active === "admin"} onNavigate={onNavigate}>
            {t("nav.admin")}
          </NavLink>
        ) : null}
        {mode === "OWN" ? (
          <NavLink href="/settings" icon="gear" active={active === "settings"} onNavigate={onNavigate}>
            {t("nav.settings")}
          </NavLink>
        ) : (
          <NavLink href="/clients" icon="bld" active={active === "clients"} onNavigate={onNavigate}>
            {t("nav.clients")}
          </NavLink>
        )}
        <Account onNavigate={onNavigate} />
      </div>
    </>
  )
}

function Brand() {
  const t = useTranslations("common")
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-sm px-1.5 text-ink-fg no-underline" aria-label={t("home")}>
      <LogoMark />
      <span className="wide text-[15px]">HookMill</span>
    </Link>
  )
}

/** Desktop sidebar (≥761 px): a dark floating card of the panel shell (31/10), scrolling on its own. */
const SIDEBAR_CARD =
  "on-ink hidden min-h-0 flex-col gap-[18px] rounded-[22px] border border-ink-line bg-ink px-3.5 pt-[18px] pb-5 shadow-[0_1px_2px_rgba(0,0,0,.12),0_10px_30px_rgba(21,23,26,.18)] tablet:flex"

export function Sidebar() {
  const t = useTranslations("common")
  return (
    <nav
      aria-label={t("main")}
      className={cn(SIDEBAR_CARD, "no-scrollbar overflow-y-auto overscroll-contain text-ink-fg-2")}
    >
      <Brand />
      <SidebarNav />
    </nav>
  )
}

/** ≤760 px: dark top bar (HM · client · menu); the menu opens the same nav in a sheet from the top. */
export function MobileTopbar() {
  const t = useTranslations()
  const mode = useAccountMode()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <div className="on-ink sticky top-0 z-20 flex h-14 items-center gap-2.5 bg-ink px-4 pt-[env(safe-area-inset-top,0px)] tablet:hidden">
      <Link href="/" aria-label={t("common.home")} className="flex-none rounded-sm">
        <LogoMark />
      </Link>
      <div className="min-w-0 flex-1">{mode === "OWN" ? <WorkspaceIdentity compact /> : <ClientSwitcher compact />}</div>
      {TEMPLATES ? <CreditsPill /> : null}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger
          aria-label={t("shell.openMenu")}
          className="grid size-11 flex-none place-items-center rounded-md border border-ink-line text-ink-fg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info-on-ink"
        >
          <NavIcon name="menu" />
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/55 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="on-ink fixed inset-x-0 top-0 z-50 flex max-h-dvh flex-col gap-[18px] overflow-y-auto border-b border-ink-line bg-ink px-3.5 pt-[calc(10px+env(safe-area-inset-top,0px))] pb-[calc(20px+env(safe-area-inset-bottom,0px))] text-ink-fg-2 outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-top-4"
          >
            <div className="flex items-center justify-between gap-2.5">
              <DialogPrimitive.Title asChild>
                <span className="flex items-center gap-2.5 px-1.5 text-ink-fg">
                  <LogoMark />
                  <span className="wide text-[15px]">HookMill</span>
                  <span className="sr-only">{t("shell.menu")}</span>
                </span>
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label={t("shell.closeMenu")}
                className="grid size-11 place-items-center rounded-md border border-ink-line text-ink-fg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info-on-ink"
              >
                <NavIcon name="x" />
              </DialogPrimitive.Close>
            </div>
            <SidebarNav onNavigate={close} showClient={false} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  )
}

/** Same footprint while the session is restored (no layout jump). */
export function ShellSkeleton() {
  return (
    <div className="min-h-dvh tablet:grid tablet:h-dvh tablet:grid-cols-[248px_minmax(0,1fr)] tablet:gap-3 tablet:overflow-hidden tablet:bg-[color-mix(in_oklab,var(--bg)_88%,var(--fg))] tablet:p-3">
      <div className={SIDEBAR_CARD} aria-hidden="true">
        <div className="flex min-h-11 items-center gap-2.5 px-1.5">
          <LogoMark />
          <span className="sk h-3 w-20" />
        </div>
        <span className="sk h-14 w-full rounded-btn" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <span key={i} className="sk mx-2.5 h-3" style={{ width: 90 + ((i * 37) % 60) }} />
        ))}
      </div>
      <div className="hidden rounded-[22px] border border-line bg-bg tablet:block" aria-hidden="true" />
      <div className="on-ink flex h-14 items-center gap-2.5 bg-ink px-4 tablet:hidden" aria-hidden="true">
        <LogoMark />
        <span className="sk h-3 w-28" />
      </div>
    </div>
  )
}
