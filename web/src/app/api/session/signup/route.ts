import { NextResponse, type NextRequest } from "next/server"
import { authServer } from "@/lib/session/auth-server"
import { failSession, respondSession } from "@/lib/session/bff"
import type { SignupBody } from "@/lib/api/types"

/** fase2-cadastro §4.3: POST /auth/signup through the BFF. Same cookie handling as login (refresh in the httpOnly cookie + locale). */
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const raw = (await req.json().catch(() => null)) as Partial<SignupBody> | null
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request.", statusCode: 400 } }, { status: 400 })
  }
  // only the contract's fields go to the API (it rejects unknown ones)
  const body: SignupBody = {
    name: String(raw.name ?? ""),
    email: String(raw.email ?? ""),
    password: String(raw.password ?? ""),
    ...(raw.agencyName?.trim() ? { agencyName: raw.agencyName.trim() } : {}),
    ...(raw.uiLocale === "EN" || raw.uiLocale === "PT_BR" ? { uiLocale: raw.uiLocale } : {}),
  }
  try {
    return await respondSession(await authServer.signup(body), true)
  } catch (e) {
    // a failed sign-up says nothing about an existing cookie: keep it
    return failSession(e, false)
  }
}
