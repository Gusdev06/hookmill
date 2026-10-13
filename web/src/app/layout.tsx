import type { Metadata, Viewport } from "next"
import { Archivo, IBM_Plex_Mono } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getLocale } from "next-intl/server"
import { Providers } from "@/components/providers/providers"
import "./globals.css"

// fase2-telas-novas §3: Archivo (UI, wide titles via the wdth axis) + IBM Plex Mono (numbers, labels)
const archivo = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--font-archivo", display: "swap" })
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" })

export const metadata: Metadata = {
  title: "HookMill",
  description: "Video ad creatives from a brief.",
}

export const viewport: Viewport = {
  themeColor: "#eeeeea",
  colorScheme: "light",
  viewportFit: "cover",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
