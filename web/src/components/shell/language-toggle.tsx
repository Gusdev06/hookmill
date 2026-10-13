"use client"

import { useTransition } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { setLocaleCookie } from "@/i18n/actions"
import { toUiLocale, type Locale } from "@/i18n/config"
import { api } from "@/lib/api/client"
import { cn } from "@/lib/utils"

/** EN/PT selector (header + Settings). Saves the user's preference when signed in. */
export function LanguageToggle({ long, persist, className }: { long?: boolean; persist?: boolean; className?: string }) {
  const t = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()
  const [pending, start] = useTransition()

  const change = (v: string) => {
    if (!v || v === locale) return
    start(async () => {
      await setLocaleCookie(v)
      if (persist) api.auth.updateMe({ uiLocale: toUiLocale(v as Locale) }).catch(() => undefined)
      router.refresh()
    })
  }

  return (
    <ToggleGroup
      type="single"
      value={locale}
      onValueChange={change}
      aria-label={t("interfaceLanguage")}
      aria-busy={pending}
      className={cn("flex-none", className)}
    >
      <ToggleGroupItem value="en" className={long ? undefined : "px-[7px] py-[3px] tablet:px-2.5 tablet:py-1"}>
        {long ? "English" : "EN"}
      </ToggleGroupItem>
      <ToggleGroupItem value="pt-BR" className={long ? undefined : "px-[7px] py-[3px] tablet:px-2.5 tablet:py-1"}>
        {long ? "Português (BR)" : "PT"}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
