import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { SignupForm } from "./signup-form"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { LogoMark } from "@/components/shell/logo"
import Link from "next/link"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signup")
  return { title: `${t("title")} · HookMill` }
}

/** fase2-cadastro §4.4: same frame as /login (logo + language toggle). */
export default function SignupPage() {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr]">
      <div className="flex items-center justify-between px-[var(--gut)] pt-3">
        <Link href="/" aria-label="HookMill" className="rounded-sm">
          <LogoMark />
        </Link>
        <LanguageToggle />
      </div>
      <main className="grid place-items-center px-[var(--gut)] pt-8 pb-16">
        <SignupForm />
      </main>
    </div>
  )
}
