"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { ClientAvatar, LogoMark } from "@/components/shell/logo"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { cn } from "@/lib/utils"

/*
 * Minimal shell (onboarding-v2 spec §4): the layout of /start, /onboarding/* and the resume / waiting screens.
 * Top bar: logo HM · (client avatar + eyebrow + name) · spacer · right actions. No sidebar, no app nav.
 * Sticky with the safe area on top; the body leaves room for a fixed action bar on the phone.
 */
export function MinimalShell({
  client,
  eyebrow,
  right,
  children,
  narrow,
  className,
}: {
  /** client / workspace name shown next to the logo */
  client?: string | null
  /** "Setup" · "Edit setup" · "Saved" */
  eyebrow?: React.ReactNode
  /** right slot; defaults to the language toggle */
  right?: React.ReactNode
  children: React.ReactNode
  /** 640 px column (resume / waiting) instead of 800 px */
  narrow?: boolean
  className?: string
}) {
  const t = useTranslations("common")
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-line bg-card px-[var(--gut)] py-2 pt-[calc(8px+env(safe-area-inset-top,0px))] tablet:gap-3">
        <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-sm px-1.5 text-fg no-underline" aria-label={t("home")}>
          <LogoMark />
          <span className="wide hidden text-[15px] tablet:inline">HookMill</span>
        </Link>
        {client ? (
          <div className="flex min-w-0 items-center gap-2.5 border-l border-line pl-3">
            <ClientAvatar name={client} className="size-7 rounded-sm text-xs" />
            <span className="flex min-w-0 flex-col">
              {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
              <b className="truncate">{client}</b>
            </span>
          </div>
        ) : null}
        <span className="flex-1" />
        {right === undefined ? <LanguageToggle persist /> : right}
      </header>
      <main className={cn("flex-1 px-[var(--gut)] pt-5 pb-[140px] tablet:pt-8", className)}>
        <div className={cn("mx-auto flex flex-col gap-5", narrow ? "max-w-[640px]" : "max-w-[800px]")}>{children}</div>
      </main>
    </div>
  )
}
