"use client"

import { useId } from "react"
import { useFormatter, useTranslations } from "next-intl"
import type { FaceCount } from "@/lib/api/types"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const COUNTS: FaceCount[] = [1, 2, 3, 4]

/** §13.13: how many faces to generate (1-4), next to the generate button, with `count × faceUnitPriceUsd`. */
export function FaceCountControl({ count, onChange, unitPriceUsd, disabled, action }: {
  count: FaceCount
  onChange: (n: FaceCount) => void
  unitPriceUsd: number | undefined
  disabled?: boolean
  action: React.ReactNode
}) {
  const t = useTranslations("faceCount")
  const format = useFormatter()
  const labelId = useId()
  // Soul costs fractions of a cent: show up to 3 decimals (US$ 0,006)
  const price = unitPriceUsd === undefined ? null : format.number(count * unitPriceUsd, { style: "currency", currency: "USD", maximumFractionDigits: 3 })
  return (
    <div className="grid min-w-0 gap-1.5">
      <span id={labelId} className="font-mono text-xs text-fg-3" aria-live="polite">
        {price === null ? t("faces", { n: count }) : t("price", { n: count, price })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={String(count)}
          disabled={disabled}
          onValueChange={(v) => v && onChange(Number(v) as FaceCount)}
          aria-label={t("label")}
          aria-describedby={labelId}
          className="flex-none"
        >
          {COUNTS.map((n) => (
            <ToggleGroupItem key={n} value={String(n)} className="min-w-8 px-2 font-mono tabular-nums" aria-label={t("faces", { n })}>
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {action}
      </div>
    </div>
  )
}
