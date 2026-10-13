import { Suspense } from "react"
import { LoginForm } from "./login-form"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { LogoMark } from "@/components/shell/logo"

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr]">
      <div className="flex items-center justify-between px-[var(--gut)] pt-3">
        <LogoMark />
        <LanguageToggle />
      </div>
      <main className="grid place-items-center px-[var(--gut)] pb-16">
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  )
}
