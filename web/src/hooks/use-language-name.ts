"use client"

import { useMemo } from "react"
import { useLocale } from "next-intl"

/** BCP 47 code → language name in the interface language. */
export function useLanguageName() {
  const locale = useLocale()
  const names = useMemo(() => new Intl.DisplayNames([locale], { type: "language" }), [locale])
  return (code: string) => {
    try {
      return names.of(code) ?? code
    } catch {
      return code
    }
  }
}

