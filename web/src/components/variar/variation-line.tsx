"use client"

import { useTranslations } from "next-intl"
import type { AutoVariationRef } from "@/lib/api/types"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

/** "↳ Variation of <winner> · <kind>" (spec §2.12, §5.8): Home rows, waiting cards, Library, Final OK. */
export function VariationLine({ v, className }: { v: AutoVariationRef; className?: string }) {
  const t = useTranslations("variar")
  return (
    <span className={cn("row-sub inline-flex min-w-0 items-center gap-1.5", className)}>
      <Icon name="branch" className="size-3.5 flex-none text-fg-3" />
      <span className="truncate">
        {t("variationOf", { name: v.championName })} · {v.isControl ? t("hooks.control") : v.code ? <span className="font-mono">{v.code}</span> : t(`kindShort.${v.kind}`)}
      </span>
    </span>
  )
}
