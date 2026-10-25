"use client"

import { Suspense, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SessionProvider, useSession } from "@/components/providers/session-provider"
import { MobileTopbar, ShellSkeleton, Sidebar } from "@/components/shell/sidebar"
import { SetupInProgress } from "@/components/onboarding/setup-in-progress"
import { onboardingHref } from "@/components/onboarding/shared"
import { TourProvider } from "@/components/tour/tour-provider"
import { accountModeOf, useMe } from "@/hooks/use-me"

/** fase2 shell: dark sidebar beside the work area (≥761 px); dark top bar + menu sheet below that. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<ShellSkeleton />}>
      <Suspense fallback={<ShellSkeleton />}>
        <Gate>{children}</Gate>
      </Suspense>
    </SessionProvider>
  )
}

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

  if (!loaded || redirect) return <ShellSkeleton />
  if (status === "SETUP" && !canEdit && !bare) return <SetupInProgress />
  if (bare) return <>{children}</>

  return (
    <TourProvider enabled={!tourDone && status !== "SETUP"} clientName={data?.workspace.name ?? session.workspace.name}>
      <div className="min-h-dvh tablet:grid tablet:grid-cols-[248px_minmax(0,1fr)]">
        <Sidebar />
        <div className="min-w-0">
          <MobileTopbar />
          <main>{children}</main>
        </div>
      </div>
    </TourProvider>
  )
}
