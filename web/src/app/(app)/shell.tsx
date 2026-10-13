"use client"

import { Suspense } from "react"
import { SessionProvider } from "@/components/providers/session-provider"
import { MobileTopbar, ShellSkeleton, Sidebar } from "@/components/shell/sidebar"

/** fase2 shell: dark sidebar beside the work area (≥761 px); dark top bar + menu sheet below that. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<ShellSkeleton />}>
      <Suspense fallback={<ShellSkeleton />}>
        <div className="min-h-dvh tablet:grid tablet:grid-cols-[248px_minmax(0,1fr)]">
          <Sidebar />
          <div className="min-w-0">
            <MobileTopbar />
            <main>{children}</main>
          </div>
        </div>
      </Suspense>
    </SessionProvider>
  )
}
