import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { buttonVariants } from "@/components/ui/button"

export default async function NotFound() {
  const t = await getTranslations()
  return (
    <div className="mx-auto grid max-w-[760px] gap-4 px-[var(--gut)] py-16">
      <h1>404</h1>
      <p className="text-fg-2">{t("errors.NOT_FOUND")}</p>
      <div>
        <Link href="/" className={buttonVariants()}>
          {t("wizard.backHome")}
        </Link>
      </div>
    </div>
  )
}
