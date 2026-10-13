import { NextResponse } from "next/server"
import { AuthFailure } from "@/lib/session/auth-server"
import { cookieOptions, sealRefreshToken, SESSION_COOKIE } from "@/lib/session/cookie"
import { fromUiLocale, LOCALE_COOKIE } from "@/i18n/config"
import type { AuthSession } from "@/lib/api/types"

/** Shared by the /api/session routes: the refresh token goes into the httpOnly cookie, the browser gets the rest. */
export async function respondSession(session: AuthSession, setLocale: boolean, extra?: Record<string, unknown>) {
  const res = NextResponse.json({
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    user: session.user,
    workspace: session.workspace,
    ...extra,
  })
  res.cookies.set(SESSION_COOKIE, await sealRefreshToken(session.refreshToken), cookieOptions)
  if (setLocale) res.cookies.set(LOCALE_COOKIE, fromUiLocale(session.user.uiLocale), { path: "/", maxAge: 31536000, sameSite: "lax" })
  res.headers.set("Cache-Control", "no-store")
  return res
}

/** Error envelope. `dropCookie` only when the refresh cookie itself is bad (401 on refresh/login). */
export function failSession(e: unknown, dropCookie = true) {
  // AuthFailure (real API) or the mock's Failure (same shape: code, status, message, details)
  const o = e as { code?: string; status?: number; message?: string; details?: unknown } | null
  const f = e instanceof AuthFailure ? e : { code: o?.code ?? "INTERNAL_ERROR", status: o?.status ?? 500, message: o?.code ? (o.message ?? "Error") : "Error", details: o?.code ? o.details : undefined }
  const details = (f as { details?: unknown }).details
  const res = NextResponse.json(
    { success: false, error: { code: f.code, message: f.message, statusCode: f.status, ...(details ? { details } : {}) } },
    { status: f.status }
  )
  if (dropCookie && f.status === 401) res.cookies.delete(SESSION_COOKIE)
  return res
}
