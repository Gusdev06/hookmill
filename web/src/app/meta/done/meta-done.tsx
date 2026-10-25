"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import type { MetaOAuthErrorCode } from "@/lib/api/types"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

const OAUTH_CODES: MetaOAuthErrorCode[] = ["META_OAUTH_DENIED", "META_OAUTH_FAILED", "META_STATE_INVALID", "META_SCOPES_MISSING", "META_UNAVAILABLE"]

/** Minimal card: the logo is in the page; here only the outcome. Same oauth messages as MetaConnect (`meta.oauth.*`). */
export function MetaDone({ meta, code, missing }: { meta: "connected" | "error"; code: string | null; missing: string[] }) {
  const t = useTranslations("metaDone")
  const tm = useTranslations("meta")
  const ok = meta === "connected"
  const oauthCode: MetaOAuthErrorCode = OAUTH_CODES.includes(code as MetaOAuthErrorCode) ? (code as MetaOAuthErrorCode) : "META_OAUTH_FAILED"
  // popup flow: tell the opener and close; a plain tab (other browser) just shows the page
  useEffect(() => {
    const opener = window.opener as Window | null
    if (!opener || opener.closed) return
    try {
      opener.postMessage({ type: "meta:done", meta, code: ok ? null : oauthCode, missing }, window.location.origin)
      window.close()
    } catch {
      // cross-origin opener or blocked: keep the page
    }
  }, [meta, ok, oauthCode, missing])
  return (
    <div role="status" aria-live="polite" className="flex w-full max-w-[440px] flex-col items-center gap-4 rounded-xl border border-line bg-card p-6 text-center tablet:p-8">
      <span
        aria-hidden="true"
        className={cn("inline-grid size-12 place-items-center rounded-full [&_svg]:size-6", ok ? "bg-status-approved-bg text-status-approved" : "bg-status-failed-bg text-status-failed")}
      >
        <Icon name={ok ? "check" : "alert"} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-xl font-bold [font-stretch:110%]">{ok ? t("connectedTitle") : tm("loginFailed")}</h1>
        <p className="m-0 text-sm text-fg-2 text-pretty">
          {ok ? t("connectedBody") : (
            <>
              {oauthCode === "META_SCOPES_MISSING" ? tm("oauth.META_SCOPES_MISSING", { list: missing.join(", ") || "—" }) : tm(`oauth.${oauthCode}`)} {t("errorBody")}
            </>
          )}
        </p>
      </div>
    </div>
  )
}
