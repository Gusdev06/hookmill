export const LOCALES = ["en", "pt-BR"] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE === "pt-BR" ? "pt-BR" : "en"
export const LOCALE_COOKIE = "NEXT_LOCALE"

export function toLocale(v: string | null | undefined): Locale {
  return v === "pt-BR" ? "pt-BR" : v === "en" ? "en" : DEFAULT_LOCALE
}
export const fromUiLocale = (v: "EN" | "PT_BR"): Locale => (v === "PT_BR" ? "pt-BR" : "en")
export const toUiLocale = (v: Locale): "EN" | "PT_BR" => (v === "pt-BR" ? "PT_BR" : "EN")
