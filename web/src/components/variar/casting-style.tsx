"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import type { CastingStyle } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Panel } from "@/components/page"
import { Banner, Memo } from "@/components/wizard/common"

const STYLES: CastingStyle[] = ["DIVERSE", "MATCH_ORIGINAL"]

/** §13.13: who the new people are. Diverse by default; "like the original" keeps the winner's profile. */
export function CastingStyleChoice({ value, onChange, disabled, genderFollowsVoice, after }: {
  value: CastingStyle
  onChange: (v: CastingStyle) => void
  disabled?: boolean
  /** SWAP_AVATAR on the winner's own audio: the apparent gender follows the voice in both styles. */
  genderFollowsVoice?: boolean
  after?: React.ReactNode
}) {
  const t = useTranslations("variar.cast")
  return (
    <Panel>
      <div className="grid gap-1.5">
        <span id="cast-style" className="font-semibold">{t("title")}</span>
        <ToggleGroup
          type="single"
          value={value}
          disabled={disabled}
          onValueChange={(v) => v && onChange(v as CastingStyle)}
          aria-labelledby="cast-style"
          aria-describedby="cast-style-desc"
          className="justify-self-start"
        >
          {STYLES.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {t(`style.${s}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span id="cast-style-desc" className="max-w-[62ch] text-[13px] text-fg-2">
          {t(`desc.${value}`)}
          {genderFollowsVoice ? ` ${t("genderNote")}` : ""}
        </span>
      </div>
      {after}
    </Panel>
  )
}

/** After the plan: switching the cast rewrites it (POST …/replan), so it asks first. */
export function CastingStyleReplan({ value, hasHooks, genderFollowsVoice, disabled, pending, onReplan }: {
  value: CastingStyle
  hasHooks: boolean
  genderFollowsVoice: boolean
  disabled: boolean
  pending: boolean
  onReplan: (v: CastingStyle) => void
}) {
  const t = useTranslations("variar.cast")
  const [next, setNext] = useState<CastingStyle | null>(null)
  const ask = next !== null && next !== value
  return (
    <CastingStyleChoice
      value={ask ? next : value}
      onChange={setNext}
      disabled={disabled || pending}
      genderFollowsVoice={genderFollowsVoice}
      after={
        ask ? (
          <Banner
            title={t("replanTitle")}
            body={hasHooks ? t("replanBodyHooks") : t("replanBody")}
            actions={
              <>
                <Button size="sm" disabled={pending} onClick={() => onReplan(next)}>
                  {t("replanConfirm")}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setNext(null)}>
                  {t("keepCurrent")}
                </Button>
              </>
            }
          />
        ) : (
          <Memo icon="info">{t("replanNote")}</Memo>
        )
      }
    />
  )
}
