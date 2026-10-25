"use client"

import { useTranslations } from "next-intl"
import type { FieldOrigin, FieldOrigins, Offer, OfferExtractOutput } from "@/lib/api/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tag } from "@/components/page"
import { useLanguageName } from "@/hooks/use-language-name"
import { cn } from "@/lib/utils"

export type DraftKey = "name" | "language" | "what" | "audience" | "promise" | "pains" | "proof" | "offerAndPrice" | "cta"
export type Draft = Record<DraftKey, string>
/* Field order and widths from the mockup's brief form (long ones span both columns). */
export const FIELDS: { key: DraftKey; long: boolean }[] = [
  { key: "name", long: false },
  { key: "language", long: false },
  { key: "what", long: true },
  { key: "audience", long: true },
  { key: "promise", long: true },
  { key: "pains", long: true },
  { key: "proof", long: true },
  { key: "offerAndPrice", long: false },
  { key: "cta", long: false },
]
const CONTENT_LANGUAGES = ["en", "pt-BR", "es"]
export const EMPTY_DRAFT: Draft = { name: "", language: "en", what: "", audience: "", promise: "", pains: "", proof: "", offerAndPrice: "", cta: "" }

export function toDraft(o: Pick<Offer, "name" | "language"> & Partial<Offer>): Draft {
  return {
    name: o.name, language: o.language, what: o.what ?? "", audience: o.audience ?? "", promise: o.promise ?? "",
    pains: o.pains ?? "", proof: o.proof ?? "", offerAndPrice: o.offerAndPrice ?? "", cta: o.cta ?? "",
  }
}

export function fromExtract(out: OfferExtractOutput): { draft: Draft; fromPage: Set<DraftKey> } {
  return {
    draft: toDraft({ name: out.name, language: out.language, ...out.brief }),
    fromPage: new Set(Object.entries(out.fieldSources).filter(([, v]) => v === "page").map(([k]) => k as DraftKey).filter((k) => k !== "language")),
  }
}

/** briefing-leitura-v2: "From checkout, image 3" on the field's tag, with the page URLs in the title. */
function OriginTag({ origins }: { origins: FieldOrigin[] }) {
  const t = useTranslations("offers")
  const parts = [...new Set(origins.map((o) => (o.imageIndex !== undefined ? t("image", { n: o.imageIndex }) : t(`role.${o.role}`))))]
  return (
    <Tag dashed>
      <span title={[...new Set(origins.map((o) => o.url))].join("\n") || undefined}>{t("fromOrigin", { list: parts.join(", ") })}</span>
    </Tag>
  )
}

/** Brief fields (Offers page + wizard Offer step). `loading` = skeletons while the page is read. */
export function BriefFields({
  draft, onChange, fromPage, origins, loading, only, labels, disabled,
}: {
  draft: Draft; onChange: (k: DraftKey, v: string) => void; fromPage?: Set<DraftKey>
  /** v2 `fieldOrigins`: where each page-filled field came from (page role, image) */
  origins?: FieldOrigins
  loading?: boolean
  /** a subset of the fields, in this order (client onboarding splits the brief across steps 3 and 4) */
  only?: readonly DraftKey[]
  /** label overrides per field */
  labels?: Partial<Record<DraftKey, React.ReactNode>>
  disabled?: boolean
}) {
  const t = useTranslations("offers")
  const lang = useLanguageName()
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 tablet:grid-cols-2">
      {(only ? only.map((k) => FIELDS.find((f) => f.key === k)!) : FIELDS).map(({ key, long }) => (
        <div key={key} className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5", long && "tablet:col-span-2")}>
          <Label htmlFor={`f-${key}`}>
            {labels?.[key] ?? t(`fields.${key}`)}
            {fromPage?.has(key) && !loading ? (origins?.[key as keyof FieldOrigins]?.length ? <OriginTag origins={origins[key as keyof FieldOrigins]!} /> : <Tag dashed>{t("fromPage")}</Tag>) : null}
          </Label>
          {loading ? (
            <span className={cn("sk", long ? "h-16" : "h-[34px]")} />
          ) : key === "language" ? (
            <Select value={draft.language} onValueChange={(v) => onChange("language", v)} disabled={disabled}>
              <SelectTrigger id={`f-${key}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([...CONTENT_LANGUAGES, draft.language])].map((code) => (
                  <SelectItem key={code} value={code}>
                    {lang(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : long ? (
            <Textarea id={`f-${key}`} rows={2} value={draft[key]} disabled={disabled} onChange={(e) => onChange(key, e.target.value)} />
          ) : (
            <Input id={`f-${key}`} value={draft[key]} disabled={disabled} onChange={(e) => onChange(key, e.target.value)} />
          )}
        </div>
      ))}
    </div>
  )
}
