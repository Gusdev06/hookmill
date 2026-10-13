import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { authServer, AuthFailure } from "@/lib/session/auth-server"
import { openRefreshToken, SESSION_COOKIE } from "@/lib/session/cookie"
import { failSession, respondSession } from "@/lib/session/bff"
import type { AuthSession } from "@/lib/api/types"

/**
 * Session BFF (contract §2): the refresh token only ever lives in an encrypted httpOnly cookie.
 * POST = login · GET = refresh (rotates the cookie, returns a fresh access token) · PUT = switch workspace (client selector) · DELETE = logout.
 */
export const dynamic = "force-dynamic"

const respond = (session: AuthSession, setLocale: boolean) => respondSession(session, setLocale)
const failure = (e: unknown) => failSession(e)

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string; inviteToken?: string; name?: string } | null
  if (body?.inviteToken) {
    // invite acceptance (contract §2): same cookie handling as login
    try {
      return await respond(await authServer.acceptInvite(body.inviteToken, body.name ?? "", body.password ?? ""), true)
    } catch (e) {
      return failure(e)
    }
  }
  if (!body?.email || !body?.password) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Email and password are required.", statusCode: 400 } }, { status: 400 })
  }
  try {
    return await respond(await authServer.login(body.email, body.password), true)
  } catch (e) {
    return failure(e)
  }
}

export async function GET() {
  const rt = await openRefreshToken((await cookies()).get(SESSION_COOKIE)?.value)
  if (!rt) return failure(new AuthFailure("UNAUTHORIZED", 401, "No session."))
  try {
    return await respond(await authServer.refresh(rt), false)
  } catch (e) {
    return failure(e)
  }
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { workspaceId?: string } | null
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "")
  if (!bearer) return failure(new AuthFailure("UNAUTHORIZED", 401, "No session."))
  if (!body?.workspaceId) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "workspaceId is required.", statusCode: 400 } }, { status: 400 })
  }
  try {
    return await respond(await authServer.switchWorkspace(body.workspaceId, bearer), false)
  } catch (e) {
    // a 401 here is the access token, not the refresh cookie: keep the cookie
    const f = e instanceof AuthFailure ? e : null
    return NextResponse.json({ success: false, error: { code: f?.code ?? "INTERNAL_ERROR", message: f?.message ?? "Error", statusCode: f?.status ?? 500 } }, { status: f?.status ?? 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const rt = await openRefreshToken((await cookies()).get(SESSION_COOKIE)?.value)
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "")
  if (rt) await authServer.logout(rt, bearer)
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
