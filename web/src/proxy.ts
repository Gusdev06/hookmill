import { NextResponse, type NextRequest } from "next/server"

/** Optimistic check only (cookie present); the real check is the refresh in /api/session. */
const SESSION_COOKIE = "maq_session"
/** fase2-cadastro §4.2: pages for people without a session; with one they go Home. */
const PUBLIC = new Set(["/login", "/signup", "/welcome"])

export function proxy(req: NextRequest) {
  const has = req.cookies.has(SESSION_COOKIE)
  const { pathname, search } = req.nextUrl
  if (pathname.startsWith("/invite/")) return NextResponse.next()
  if (!has) {
    // the landing is served at "/" (the URL stays "/")
    if (pathname === "/") return NextResponse.rewrite(new URL("/welcome", req.url))
    if (PUBLIC.has(pathname)) return NextResponse.next()
    const url = new URL("/login", req.url)
    url.searchParams.set("next", pathname + search)
    return NextResponse.redirect(url)
  }
  if (PUBLIC.has(pathname)) return NextResponse.redirect(new URL("/", req.url))
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|mockServiceWorker.js|mock/|dev/|fonts/|fixtures/).*)"],
}
