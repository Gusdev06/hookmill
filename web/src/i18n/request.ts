import { getRequestConfig } from "next-intl/server"
import { cookies } from "next/headers"
import { LOCALE_COOKIE, toLocale } from "./config"

/** No locale in the URL: the interface language is a cookie (EN default, spec §7). */
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
