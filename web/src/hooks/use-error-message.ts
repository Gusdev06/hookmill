"use client"

import { useTranslations } from "next-intl"
import { isApiError } from "@/lib/api/errors"

/** Translates an error by its `code` (contract §1 HTTP codes and async errorCodes); falls back to a generic line. */
export function useErrorMessage() {
  const t = useTranslations("errors")
  return (e: unknown) => {
    const code = isApiError(e) ? e.code : typeof e === "string" ? e : (e as { code?: unknown } | null)?.code
    return typeof code === "string" && t.has(code as never) ? t(code as never) : t("fallback")
  }
}
