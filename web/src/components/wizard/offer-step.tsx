"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { api } from "@/lib/api/client"
import type { CreativeDetail, Offer } from "@/lib/api/types"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BriefFields, EMPTY_DRAFT, fromExtract, type Draft, type DraftKey } from "@/components/brief-form"
import { AlsoRead, ExtractChecklist, useOfferExtract } from "@/components/offer-extract"
import { Icon } from "@/components/icon"
import { Panel, PanelHead, Tag } from "@/components/page"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useLanguageName } from "@/hooks/use-language-name"
import { qk } from "@/hooks/use-creative"
import { cn } from "@/lib/utils"
import { ActionBar, WizardFrame, WzHead } from "./shell"
import { Banner, RadioDot } from "./common"

type Mode = "link" | "reading" | "filled" | "manual" | "error"

function OfferOptions({ offers, value, onChange, lockedId }: { offers: Offer[]; value: string | null; onChange?: (id: string) => void; lockedId?: string }) {
  const t = useTranslations("wizard.offer")
  const lang = useLanguageName()
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  return (
    <RadioGroupPrimitive.Root value={value ?? ""} onValueChange={onChange} aria-label={t("choose")} className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {offers.map((o) => {
        const disabled = !!lockedId && o.id !== lockedId
        return (
          <RadioGroupPrimitive.Item
            key={o.id}
            value={o.id}
            disabled={disabled}
            className="flex w-full items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-left hover:border-line-2 disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-fg"
          >
            <RadioDot on={o.id === value} />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <b className="font-semibold">{o.name}</b>
              <span className="row-sub">{[o.kind, o.offerAndPrice].filter(Boolean).join(" · ")}</span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                <Tag>
                  <Icon name="globe" />
                  {lang(o.language)}
                </Tag>
                {o.winnersCount ? <Tag tone="amber">{t("winnersInLibrary", { count: o.winnersCount })}</Tag> : <Tag>{t("noWinners")}</Tag>}
              </span>
            </span>
            <span className="row-sub hidden flex-none tablet:inline">{format.relativeTime(new Date(o.updatedAt), now)}</span>
          </RadioGroupPrimitive.Item>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}

/** Locked offer (design validation F2 §4): only the chosen offer, read-only, with a lock. */
function LockedOffer({ offerId }: { offerId: string }) {
  const t = useTranslations("wizard.offer")
  const lang = useLanguageName()
  const q = useQuery({ queryKey: ["offer", offerId], queryFn: () => api.offers.get(offerId) })
  const o = q.data
  return (
    <div className="grid gap-3">
      {o ? (
        <div className="flex items-start gap-3 rounded-lg border border-fg bg-surface px-3.5 py-3">
          <Icon name="lock" className="mt-0.5 text-fg-2" />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <b className="font-semibold">{o.name}</b>
            <span className="row-sub">{[o.kind, o.offerAndPrice].filter(Boolean).join(" · ")}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              <Tag>
                <Icon name="globe" />
                {lang(o.language)}
              </Tag>
              {o.winnersCount ? <Tag tone="amber">{t("winnersInLibrary", { count: o.winnersCount })}</Tag> : <Tag>{t("noWinners")}</Tag>}
            </span>
          </span>
        </div>
      ) : (
        <span className="sk h-[86px] rounded-lg" />
      )}
      <p className="text-[13px] text-fg-2">{t("locked")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/offers" className={buttonVariants({ size: "sm" })}>
          <Icon name="pencil" />
          {t("editBrief")}
        </Link>
        <Link href="/creatives/new" className={buttonVariants({ size: "sm", variant: "ghost" })}>
          <Icon name="plus" />
          {t("otherCreative")}
        </Link>
      </div>
      <p className="text-xs text-fg-3">{t("editBriefNote")}</p>
    </div>
  )
}

/** Step 1 · Offer (spec §5.1). Without a creative: pick or create an offer, then POST /creatives. */
export function OfferStep({ creative }: { creative: CreativeDetail | null }) {
  const t = useTranslations("wizard")
  const tOffers = useTranslations("offers")
  const tSteps = useTranslations("steps")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list() })
  const list = offers.data?.data ?? []

  const [tab, setTab] = useState<"existing" | "new">(params.get("offer") === "new" ? "new" : "existing")
  const [picked, setPicked] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("link")
  const [url, setUrl] = useState(params.get("url") ?? "")
  const [pageText, setPageText] = useState("")
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [fromPage, setFromPage] = useState<Set<DraftKey>>(new Set())
  const [createError, setCreateError] = useState<unknown>(null)
  const autoRead = useRef(false)

  const selected = creative ? creative.offer.id : (picked ?? list[0]?.id ?? null)
  // no offers yet: open the "new" tab, once per list result (adjusted during render, not in an effect)
  const [seenOffers, setSeenOffers] = useState<unknown>(null)
  if (!creative && offers.data && !list.length && seenOffers !== offers.data) {
    setSeenOffers(offers.data)
    setTab("new")
  }

  const ex = useOfferExtract({
    onStart: () => {
      setMode("reading")
      setCreateError(null)
    },
    onError: (e) => {
      setMode("error")
      setCreateError(e)
    },
  })
  // apply each reading once, during render (no effect)
  const [seenJob, setSeenJob] = useState<unknown>(null)
  if (ex.job && ex.job !== seenJob && !ex.reading) {
    setSeenJob(ex.job)
    if (ex.failedJob) setMode("error")
    else if (ex.result) {
      const r = fromExtract(ex.result)
      setDraft(r.draft)
      setFromPage(r.fromPage)
      setMode("filled")
    }
  }

  const read = () => url.trim() && ex.start({ url: url.trim() })
  useEffect(() => {
    if (!autoRead.current && params.get("url") && tab === "new") {
      autoRead.current = true
      read()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useMutation({
    mutationFn: async () => {
      if (creative) return creative
      let offerId = selected
      if (tab === "new") {
        const o = await api.offers.create({
          name: draft.name.trim(), language: draft.language, sourceUrl: url.trim() || undefined,
          what: draft.what || null, audience: draft.audience || null, promise: draft.promise || null, pains: draft.pains || null,
          proof: draft.proof || null, offerAndPrice: draft.offerAndPrice || null, cta: draft.cta || null,
          fieldSources: Object.fromEntries([...fromPage].map((k) => [k, "page" as const])),
        })
        offerId = o.id
        qc.invalidateQueries({ queryKey: ["offers"] })
      }
      return api.creatives.create({ offerId: offerId! })
    },
    onSuccess: (c) => {
      qc.setQueryData(qk.creative(c.id), c)
      qc.invalidateQueries({ queryKey: ["creatives"] })
      router.push(`/creatives/${encodeURIComponent(c.id)}/scripts`)
    },
    onError: setCreateError,
  })

  const jobFailed = ex.failedJob
  const ready = creative ? true : tab === "existing" ? !!selected : (mode === "filled" || mode === "manual") && !!draft.name.trim() && !!draft.what.trim() && !!draft.promise.trim()
  const changeField = (k: DraftKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setFromPage((s) => {
      if (!s.has(k)) return s
      const n = new Set(s)
      n.delete(k)
      return n
    })
  }
  const reset = () => {
    ex.reset()
    setCreateError(null)
  }

  let body: React.ReactNode
  if (creative) {
    body = <LockedOffer offerId={creative.offer.id} />
  } else if (tab === "existing") {
    body = offers.isPending ? (
      <div className="grid gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="sk h-[86px] rounded-lg" />
        ))}
      </div>
    ) : (
      <>
        <OfferOptions offers={list} value={selected} onChange={setPicked} />
      </>
    )
  } else {
    body = (
      <>
        <Panel>
          <div className="grid gap-1.5">
            <Label htmlFor="url">{t("offer.link")}</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                reset()
                read()
              }}
            >
              <Input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={tOffers("urlPlaceholder")} className="min-w-0 flex-1" />
              <Button type="submit" variant="default" disabled={mode === "reading" || !url.trim()}>
                {mode === "filled" ? t("offer.readAgain") : t("offer.readPage")}
              </Button>
            </form>
          </div>
          {mode === "link" ? (
            <p className="text-[13px] text-fg-2">
              {t("offer.linkHint")}{" "}
              <Button variant="ghost" size="sm" onClick={() => setMode("manual")}>
                {t("offer.fillByHandLink")}
              </Button>
            </p>
          ) : null}
          {mode === "reading" ? <ExtractChecklist job={ex.job} url={url} /> : null}
          {mode === "error" ? (
            <>
              <Banner
                kind="error"
                title={t("offer.errorTitle")}
                body={jobFailed ? (jobFailed.failReason ?? errorMessage({ code: jobFailed.errorCode })) : errorMessage(createError)}
                actions={
                  <Button size="sm" onClick={() => setMode("manual")}>
                    {t("offer.fillByHand")}
                  </Button>
                }
              />
              {jobFailed?.action === "paste_page_text" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="paste">{t("offer.pageText")}</Label>
                  <Textarea id="paste" rows={3} value={pageText} onChange={(e) => setPageText(e.target.value)} placeholder={t("offer.pageTextPlaceholder")} />
                  <div>
                    <Button
                      disabled={!pageText.trim()}
                      onClick={() => {
                        reset()
                        ex.start({ pageText: pageText.trim(), url: url.trim() || undefined })
                      }}
                    >
                      {t("offer.readText")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </Panel>
        {mode === "reading" || mode === "filled" || mode === "manual" ? (
          <Panel>
            <PanelHead>
              <h2>{tOffers("brief")}</h2>
              <span className="row-sub whitespace-normal">
                {mode === "reading" ? t("offer.reading") : mode === "filled" ? t("offer.filled") : t("offer.manual")}
              </span>
              {mode === "filled" ? <AlsoRead urls={ex.result?.relatedUrls} /> : null}
            </PanelHead>
            <BriefFields draft={draft} onChange={changeField} fromPage={fromPage} loading={mode === "reading"} />
          </Panel>
        ) : null}
      </>
    )
  }

  return (
    <WizardFrame
      creative={creative}
      viewing="offer"
      actionbar={
        <ActionBar
          hint={!creative && tab === "new" && (mode === "filled" || mode === "manual") ? t("offer.savedOnContinue") : null}
          primary={
            <Button
              data-primary
              variant="default"
              disabled={!ready || start.isPending}
              onClick={() => (creative ? router.push(`/creatives/${encodeURIComponent(creative.id)}/scripts`) : start.mutate())}
            >
              {t("continueTo", { step: tSteps("scripts") })}
            </Button>
          }
        />
      }
    >
      <WzHead
        title={t("offer.title")}
        sub={t("offer.sub")}
        aside={
          creative ? null : (
            <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v as "existing" | "new")} aria-label={t("offer.title")}>
              <ToggleGroupItem value="existing">{t("offer.existing")}</ToggleGroupItem>
              <ToggleGroupItem value="new">{t("offer.newFromLink")}</ToggleGroupItem>
            </ToggleGroup>
          )
        }
      />
      {createError && !(mode === "error" && tab === "new") ? (
        <Banner kind="error" title={errorMessage(createError)} />
      ) : null}
      <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-5")}>{body}</div>
    </WizardFrame>
  )
}
