import { Suspense } from "react"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { LogoMark } from "@/components/shell/logo"
import { MetaDone } from "./meta-done"

/**
 * /meta/done (meta-v1 §3.1, estrutura.md): the end of a Meta login done in ANOTHER browser or in a popup. Outside the
 * app shell and without a session (that browser is not signed in to HookMill; proxy.ts lets it through). Reads
 * `?meta=connected` or `?meta=error&code=<MetaOAuthErrorCode>[&missing=]`; with a `window.opener` it posts `meta:done`
 * to the origin tab and closes itself.
 */
export default async function MetaDonePage({ searchParams }: { searchParams: Promise<{ meta?: string; code?: string; missing?: string }> }) {
  const sp = await searchParams
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr]">
      <div className="flex items-center justify-between px-[var(--gut)] pt-3">
        <LogoMark />
        <LanguageToggle />
      </div>
      <main className="grid place-items-center px-[var(--gut)] pb-16">
        <Suspense>
          <MetaDone meta={sp.meta === "connected" ? "connected" : "error"} code={sp.code ?? null} missing={sp.missing?.split(",").filter(Boolean) ?? []} />
        </Suspense>
      </main>
    </div>
  )
}
