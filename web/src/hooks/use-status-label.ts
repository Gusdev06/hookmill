"use client"

import { useTranslations } from "next-intl"
import type { CreativeRow } from "@/lib/api/types"

/** Chip text from statusKey + statusParams (contract StatusParamsByKey). Shared by Home and the variation batch. */
export function useStatusLabel() {
  const t = useTranslations("status")
  return (c: Pick<CreativeRow, "statusKey" | "statusParams">) => {
    const key = c.statusKey.replace(/^status\./, "")
    return t.has(key as never) ? t(key as never, c.statusParams as never) : key
  }
}
