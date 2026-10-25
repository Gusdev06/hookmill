"use client"

import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"

/*
 * Mock of Meta's login dialog (dev / MSW only). POST /meta/connect in mock mode points here; the buttons reproduce the
 * outcomes of the real callback (meta-v1 §3.4): back to `returnTo?meta=connected` or `?meta=error&code=…`.
 * The result also goes to sessionStorage so the mock GET /meta/connection knows whether to promote the connection.
 */
const RETURN_TO = new Set(["/onboarding/meta", "/settings", "/settings/connections", "/meta/done"])

export default function MetaLoginPage() {
  return (
    <Suspense>
      <MetaLogin />
    </Suspense>
  )
}

function MetaLogin() {
  const router = useRouter()
  const sp = useSearchParams()
  const raw = sp.get("returnTo") ?? "/onboarding/meta"
  const returnTo = RETURN_TO.has(raw) ? raw : "/onboarding/meta"
  const go = (result: "connected" | "denied", query: string) => {
    sessionStorage.setItem("mock:meta:result", result)
    if (returnTo === "/meta/done") {
      // "another browser" = another tab here: the origin tab's mock GET /meta/oauth/status reads this from localStorage
      const q = new URLSearchParams(query)
      localStorage.setItem("mock:meta:remote", JSON.stringify({ result: result === "connected" ? "connected" : "error", code: q.get("code"), missing: q.get("missing")?.split(",").filter(Boolean) ?? [] }))
    }
    router.push(`${returnTo}?${query}`)
  }
  const btn = "inline-flex min-h-11 items-center justify-center rounded-md px-4 font-bold"
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f0f2f5] px-4 text-[#1c1e21]">
      <div className="flex w-full max-w-[420px] flex-col gap-4 rounded-lg bg-white p-6 shadow-[0_2px_12px_rgba(0,0,0,0.15)]">
        <span className="text-2xl font-extrabold text-[#1877f2]">facebook</span>
        <h1 className="text-lg font-bold">HookMill wants to access your ad accounts</h1>
        <p className="m-0 text-sm text-[#65676b]">Mock of the Facebook Login for Business dialog (MSW). Logged in as Tordan Oliveira.</p>
        <ul className="m-0 list-disc pl-5 text-sm">
          <li>Read your ad accounts, ads and 30 days of results</li>
          <li>Create ads in a campaign when you press Send</li>
          <li>List your Pages</li>
        </ul>
        <button type="button" className={`${btn} bg-[#1877f2] text-white`} onClick={() => go("connected", "meta=connected")}>
          Continue as Tordan
        </button>
        <button type="button" className={`${btn} bg-[#e4e6eb]`} onClick={() => go("denied", "meta=error&code=META_OAUTH_DENIED")}>
          Not now
        </button>
        <details className="text-sm text-[#65676b]">
          <summary className="cursor-pointer">Other outcomes (QA)</summary>
          <div className="mt-2 flex flex-col gap-2">
            <button type="button" className={`${btn} bg-[#e4e6eb] text-sm`} onClick={() => go("denied", "meta=error&code=META_SCOPES_MISSING&missing=ads_management,business_management")}>
              Continue without some permissions
            </button>
            <button type="button" className={`${btn} bg-[#e4e6eb] text-sm`} onClick={() => go("denied", "meta=error&code=META_OAUTH_FAILED")}>
              Login failed (code exchange)
            </button>
            <button type="button" className={`${btn} bg-[#e4e6eb] text-sm`} onClick={() => go("denied", "meta=error&code=META_STATE_INVALID")}>
              Expired link (state)
            </button>
            <button type="button" className={`${btn} bg-[#e4e6eb] text-sm`} onClick={() => go("denied", "meta=error&code=META_UNAVAILABLE")}>
              Meta unavailable
            </button>
          </div>
        </details>
      </div>
    </main>
  )
}
