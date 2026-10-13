"use client"

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { getSession, refreshSession, setSession, subscribeSession, type ClientSession } from "@/lib/session/token"

const Ctx = createContext<{ session: ClientSession; logout: () => Promise<void> } | null>(null)

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSession outside SessionProvider")
  return v
}

/** Gate for signed-in screens: restores the session from the httpOnly cookie, or sends to /login. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const session = useSyncExternalStore(subscribeSession, getSession, () => null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (getSession()) {
      // async on purpose (lint: no sync setState in an effect); same outcome one microtask later
      void Promise.resolve().then(() => setChecked(true))
      return
    }
    refreshSession().then((s) => {
      setChecked(true)
      if (!s) router.replace(pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname)}`)
    })
  }, [router, pathname])

  useEffect(() => {
    if (checked && !session) router.replace("/login")
  }, [checked, session, router])

  if (!session) return fallback

  const logout = async () => {
    await fetch("/api/session", { method: "DELETE", headers: { Authorization: `Bearer ${session.accessToken}` } })
    setSession(null)
    window.location.assign("/login")
  }
  return <Ctx.Provider value={{ session, logout }}>{children}</Ctx.Provider>
}
