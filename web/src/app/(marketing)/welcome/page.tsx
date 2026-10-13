import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { Landing } from "@/components/landing/landing"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing")
  return { title: t("metaTitle"), description: t("metaDescription") }
}

/**
 * fase2-cadastro §4.1: public landing. Served at "/" by a rewrite in the proxy when there's no session;
 * with a session the proxy sends /welcome to "/". No AppShell, no /api/session call.
 */
export default function WelcomePage() {
  return <Landing />
}
