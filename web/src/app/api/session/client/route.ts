import { type NextRequest } from "next/server"
import { authServer, AuthFailure } from "@/lib/session/auth-server"
import { failSession, respondSession } from "@/lib/session/bff"
import type { CreateClientBody } from "@/lib/api/types"

/**
 * New client (fase2-agencia §3.2): POST /workspaces returns tokens for the new workspace, like switch-workspace,
 * so it goes through the BFF to rotate the refresh cookie. Body = CreateClientBody; answers session + `client`.
 */
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CreateClientBody | null
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "")
  if (!bearer) return failSession(new AuthFailure("UNAUTHORIZED", 401, "No session."), false)
  if (!body?.name?.trim()) return failSession(new AuthFailure("VALIDATION_ERROR", 400, "name is required."), false)
  try {
    const s = await authServer.createClient(body, bearer)
    return await respondSession(s, false, { client: s.client })
  } catch (e) {
    // a 401 here is the access token, not the refresh cookie: keep the cookie
    return failSession(e, false)
  }
}
