"use client"

import { useTranslations } from "next-intl"
import type { VariationKind } from "@/lib/api/types"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

/** Stepper (spec §4): − / + with a mono output. */
export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const t = useTranslations("variar.types")
  return (
    <span className="inline-flex flex-none items-center rounded-sm border border-line bg-surface-2" role="group" aria-label={label}>
      <button type="button" className="grid size-7 place-items-center text-fg-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t("fewer")}>
        <Icon name="minus" />
      </button>
      <output className="min-w-6 text-center font-mono text-[13px]" aria-live="polite">
        {value}
      </output>
      <button type="button" className="grid size-7 place-items-center text-fg-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t("more")}>
        <Icon name="plus" />
      </button>
    </span>
  )
}

/** "Keeps · X" / "New · Y" tags of a variation kind (one lever per test). */
const LEVERS: Record<VariationKind, { keep: string[]; change: string[] }> = {
  SWAP_AVATAR: { keep: ["copy", "audio", "edit"], change: ["face"] },
  NEW_HOOKS: { keep: ["body", "cta", "face"], change: ["first"] },
  COPY_NEW: { keep: ["structure", "timing"], change: ["script", "face", "engine"] },
  REMIX_EDIT: { keep: ["footage", "audio"], change: ["layout"] },
  AUTO_EDIT: { keep: ["footage", "audio"], change: ["layout"] },
}
export function LeverTags({ kind }: { kind: VariationKind }) {
  const t = useTranslations("variar.types")
  const l = LEVERS[kind]
  const tag = "inline-flex items-center rounded-full border px-[7px] py-px text-xs whitespace-nowrap"
  return (
    <div className="flex flex-wrap gap-1.5">
      {l.keep.map((k) => (
        <span key={k} className={cn(tag, "border-line text-fg-2")}>
          {t("keeps")} · {t(`lever.${k}` as never)}
        </span>
      ))}
      {l.change.map((k) => (
        <span key={k} className={cn(tag, "border-line-2 text-fg")}>
          {t("new")} · {t(`lever.${k}` as never)}
        </span>
      ))}
    </div>
  )
}
