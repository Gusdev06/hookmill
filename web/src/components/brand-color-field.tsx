"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
/** `#RGB` / `#RRGGBB` → `#RRGGBB` uppercase (same rule as the API, estatico-montado D3); "" = not set; null = invalid. */
export function normalizeBrandColor(v: string): string | null | "" {
  const s = v.trim()
  if (!s) return ""
  const m = HEX.exec(s.startsWith("#") ? s : `#${s}`)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]
  return `#${h.toUpperCase()}`
}

/**
 * "Brand color" (Workspace.brandColor, estatico-montado-e-molduras-v1 D3/§A3.3): the accent of the assembled static.
 * Optional; empty = the backend derives it (page capture › champion palette › default). Swatch picker + hex field + Clear.
 * `onCommit` fires on blur / Enter / picker change with the normalized value (null clears), only when it is valid.
 */
export function BrandColorField({
  id, value, onChange, onCommit, disabled, className,
}: { id: string; value: string; onChange: (v: string) => void; onCommit?: (v: string | null) => void; disabled?: boolean; className?: string }) {
  const t = useTranslations("brandColor")
  const norm = normalizeBrandColor(value)
  const invalid = norm === null
  const commit = (v: string) => {
    const n = normalizeBrandColor(v)
    if (n === null) return
    if (n && n !== v) onChange(n)
    onCommit?.(n || null)
  }
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label htmlFor={id}>{t("label")}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            "relative inline-grid size-11 flex-none cursor-pointer place-items-center overflow-hidden rounded-md border border-line-strong focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
            disabled && "cursor-not-allowed opacity-45",
            !norm && "bg-[repeating-linear-gradient(45deg,var(--color-card-2)_0_5px,var(--color-card)_5px_10px)]"
          )}
          style={norm ? { background: norm } : undefined}
        >
          <span className="sr-only">{t("pick")}</span>
          <input
            type="color"
            disabled={disabled}
            value={norm || "#FF8A3D"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            onBlur={(e) => commit(e.target.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </label>
        <Input
          id={id}
          value={value}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          placeholder={t("none")}
          aria-label={t("hex")}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-32 font-mono uppercase"
        />
        {value ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onChange("")
              onCommit?.(null)
            }}
          >
            {t("clear")}
          </Button>
        ) : null}
      </div>
      <span id={`${id}-hint`} className={cn("text-xs", invalid ? "text-status-failed" : "text-fg-3")}>
        {invalid ? t("invalid") : t("hint")}
      </span>
    </div>
  )
}
