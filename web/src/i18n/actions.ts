"use server"

import { cookies } from "next/headers"
import { LOCALE_COOKIE, toLocale } from "./config"

export async function setLocaleCookie(value: string) {
  ;(await cookies()).set(LOCALE_COOKIE, toLocale(value), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })
}
