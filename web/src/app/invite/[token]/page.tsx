import { Suspense } from "react"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { LogoMark } from "@/components/shell/logo"
import { InviteForm } from "./invite-form"

/** /invite/:token — inviteUrl from POST /workspace/invites (contract §2, Mudanças 05/10 item 4). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr]">
      <div className="flex items-center justify-between px-[var(--gut)] pt-3">
        <LogoMark />
        <LanguageToggle />
      </div>
      <main className="grid place-items-center px-[var(--gut)] pb-16">
        <Suspense>
          <InviteForm token={token} />
        </Suspense>
      </main>
    </div>
  )
}
