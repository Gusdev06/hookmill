"use client"

import { Suspense, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SessionProvider, useSession } from "@/components/providers/session-provider"
import { MobileTopbar, ShellSkeleton, Sidebar } from "@/components/shell/sidebar"
import { SetupInProgress } from "@/components/onboarding/setup-in-progress"
import { onboardingHref } from "@/components/onboarding/shared"
import { TourProvider } from "@/components/tour/tour-provider"
import { accountModeOf, useMe } from "@/hooks/use-me"
import { APP_SCROLL_ID } from "@/lib/scroll"

/**
 * Panel shell (31/10, Gusta): from 761 px the shell fills exactly the viewport (h-dvh, the page doesn't scroll) with
 * floating rounded panels on a neutral frame: the dark sidebar card and the central content card, each scrolling on its
 * own (the content scrolls in `#app-scroll`). Below 761 px: dark top bar + menu sheet and the window scrolls, full bleed.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<ShellSkeleton />}>
      <Suspense fallback={<ShellSkeleton />}>
        <Gate>{children}</Gate>
      </Suspense>
    </SessionProvider>
  )
}

/** Frame + panels of the shell (also used by the skeleton, so restoring the session doesn't move anything). */
export const SHELL_FRAME =
  "min-h-dvh tablet:grid tablet:h-dvh tablet:grid-cols-[248px_minmax(0,1fr)] tablet:gap-3 tablet:overflow-hidden tablet:bg-[color-mix(in_oklab,var(--bg)_88%,var(--fg))] tablet:p-3"
export const SHELL_PANEL =
  "min-w-0 tablet:min-h-0 tablet:overflow-hidden tablet:rounded-[22px] tablet:border tablet:border-line tablet:bg-bg tablet:shadow-[0_1px_2px_rgba(21,23,26,.05),0_10px_30px_rgba(21,23,26,.07)]"

/** Routes that draw their own minimal shell (no sidebar): /start, /onboarding/*. */
const bareRoute = (p: string) => p === "/start" || p === "/onboarding" || p.startsWith("/onboarding/")

/*
 * Entry rules of onboarding-v2 (§3.1-3.4), all from GET /auth/me:
 *  1. accountMode null + OWNER → /start (asked once, right after the signup).
 *  2. workspace SETUP + OWNER/ADMIN → only /onboarding/*; any other route goes to the saved step. MEMBER/CLIENT see
 *     "Setup in progress" instead of the app (they can't edit the setup).
 *  3. OWN → no /clients (→ Home).
 *  4. LIVE + tourCompletedAt null → the tour runs over the real screens until Finish.
 */
function Gate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { session } = useSession()
  const me = useMe()
  const data = me.data
  const role = session.workspace.role
  const canEdit = role === "OWNER" || role === "ADMIN"
  const mode = accountModeOf(data, session.user.accountMode)
  const status = data?.workspace.status ?? session.workspace.status ?? "LIVE"
  const step = data?.workspace.onboarding?.step ?? session.workspace.onboarding?.step ?? 1
  const tourDone = (data?.workspace.tourCompletedAt ?? session.workspace.tourCompletedAt) !== null
  const loaded = !!data || me.isError
  // `null` = not answered; `undefined` = an API without the field (treated as AGENCY, never asked)
  const needsStart = !!data && data.user.accountMode === null && role === "OWNER"
  const bare = bareRoute(pathname)

  let redirect: string | null = null
  if (loaded) {
    if (needsStart && pathname !== "/start") redirect = "/start"
    else if (!needsStart && pathname === "/start") redirect = status === "SETUP" ? onboardingHref(step) : "/"
    else if (status === "SETUP" && canEdit && !bare) redirect = onboardingHref(step)
    else if (mode === "OWN" && pathname === "/clients") redirect = "/"
  }
  useEffect(() => {
    if (redirect) router.replace(redirect)
  }, [redirect, router])
  // a new route starts at the top of the content card
  useEffect(() => {
    document.getElementById(APP_SCROLL_ID)?.scrollTo(0, 0)
  }, [pathname])

  if (!loaded || redirect) return <ShellSkeleton />
  if (status === "SETUP" && !canEdit && !bare) return <SetupInProgress />
  if (bare) return <>{children}</>

  return (
    <TourProvider enabled={!tourDone && status !== "SETUP"} clientName={data?.workspace.name ?? session.workspace.name}>
      <div className={SHELL_FRAME}>
        <Sidebar />
        <div className={SHELL_PANEL}>
          <MobileTopbar />
          <main id={APP_SCROLL_ID} className="tablet:relative tablet:h-full tablet:overflow-y-auto tablet:overscroll-contain">
            {children}
          </main>
        </div>
      </div>
    </TourProvider>
  )
}
