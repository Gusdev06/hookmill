"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { IterateBatch, IterateConfig, IterateRunningRef, OfferRequiredDetails } from "@/lib/api/types"
import { iterateHref } from "@/lib/routes"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { NavIcon } from "@/components/shell/nav-icon"
import { AdRow } from "@/components/meta/ad-row"
import { metaReady, mk, useMetaConnection, useRelativeTime } from "@/hooks/use-meta"
import { CleanVersionField } from "./captions"
import { MetaLockCard, metaGateOf } from "@/components/meta/meta-gate"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ik, useIterateConfig } from "@/hooks/use-iterate"
import { useUploadMessage } from "@/components/variar/winner-step"
import { mb, useChampionUpload, type UploadState } from "@/components/variar/upload"
import { cn } from "@/lib/utils"
import { Bar, Card, Head, IterActionBar, IterFlow, IterWrap, mmss, Tag, TypeThumb, useIterFormat } from "./parts"
import { ME_KEY, useMe } from "@/hooks/use-me"
import { SAMPLE_MAX_PIECES, SampleUsedScreen } from "./sample"

/**
 * /iterate/new · Analyze, empty + uploading (spec §4.1). The analysis starts by itself when the upload finishes
 * (POST /iterate right after complete); the cost is said before, in one line. Library winners start it with "Use this".
 */
export function IterateNew() {
  const t = useTranslations("iterate.new")
  const ta = useTranslations("iterate.analyze")
  const config = useIterateConfig()
  const errorMessage = useErrorMessage()
  const me = useMe()
  // review 29/10 L1: no dead "Generate" in the bar; while there is nothing to choose yet, the bar is only the hint
  const bar = <IterActionBar hint={t("hintEmpty")} />
  const head = <Head title={t("h1")} lede={t("lede")} />

  // amostra-gratis-v1 §2: one sample per account; once spent, the unlock panel takes the place of the upload
  if (me.data?.user.access === "SAMPLE" && me.data.user.sampleUsed) return <SampleUsedScreen />
  if (config.isPending) {
    return (
      <IterWrap>
        <IterFlow current="analyze" />
        {head}
        {/* QA layout 29/10 #7: the Meta card takes its place already while the config loads, so nothing jumps down later */}
        <MetaPick busy running={null} onPick={() => {}} needsOffer={false} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-4" role="status" aria-label="…">
          <span className="sk h-[210px] rounded-lg" />
          <span className="sk h-[260px] rounded-lg" />
        </div>
        {bar}
      </IterWrap>
    )
  }
  // QA 21/10 (bug 7, onboarding-v2 §3.4): a CLIENT can't start a batch (403 on the config) but reads the Meta card, so the
  // tour stop "This ad is already working" (#t-winner) renders for them too, with "Iterate it" disabled.
  if (config.isError && isApiError(config.error) && config.error.status === 403) {
    return (
      <IterWrap>
        <IterFlow current="analyze" />
        {head}
        <MetaPick busy running={null} onPick={() => {}} needsOffer={false} readOnly />
        <Alert>
          <NavIcon name="info" size={20} />
          <AlertBody>
            <AlertTitle>{t("readOnlyTitle")}</AlertTitle>
            <AlertDescription>{t("readOnlyBody")}</AlertDescription>
          </AlertBody>
        </Alert>
        {bar}
      </IterWrap>
    )
  }
  if (config.isError) {
    return (
      <IterWrap>
        <IterFlow current="analyze" />
        {head}
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{t("loadError")}</AlertTitle>
            <AlertDescription>{errorMessage(config.error)}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => config.refetch()}>
              <NavIcon name="refresh" size={14} />
              {ta("tryAgain")}
            </Button>
          </AlertActions>
        </Alert>
        {bar}
      </IterWrap>
    )
  }
  if (!config.data.offers.length) {
    return (
      <IterWrap>
        <IterFlow current="analyze" />
        {head}
        <Card className="max-w-[640px] gap-2">
          <h2>{t("noOfferTitle")}</h2>
          <p className="m-0 text-fg-2">{t("noOfferBody")}</p>
          <div>
            <Link href="/brain" className={buttonVariants({ variant: "default", size: "sm" })}>
              {t("openBrain")}
            </Link>
          </div>
        </Card>
        {bar}
      </IterWrap>
    )
  }
  return <Ready config={config.data} />
}

function Ready({ config }: { config: IterateConfig }) {
  const t = useTranslations("iterate.new")
  const ta = useTranslations("iterate.analyze")
  const router = useRouter()
  const qc = useQueryClient()
  const fmt = useIterFormat()
  const errorMessage = useErrorMessage()
  const upload = useChampionUpload(config)
  // L1: the bar's lime opens the same file picker as the dropzone
  const fileInput = useRef<HTMLInputElement>(null)
  const metaConn = useMetaConnection()
  const metaOn = metaReady(metaConn.data) && metaGateOf(metaConn.data) === "ready"
  const [offers, setOffers] = useState(config.offers)
  const [offerId, setOfferId] = useState<string | null>(config.defaultOfferId ?? (config.offers.length === 1 ? config.offers[0].id : null))
  const [offerAsked, setOfferAsked] = useState(false)
  const needsOffer = offers.length > 1 || offerAsked

  // legenda-protegida §2.3: optional clean version picked here; POST /iterate has no cleanUploadId, so it waits for the batch
  // 26/10: it goes in POST /iterate { cleanUploadId } (checked before the plan, result in insight.cleanVersion)
  const [cleanUploadId, setCleanUploadId] = useState<string | null>(null)
  const [cleanBusy, setCleanBusy] = useState(false)
  const go = (b: IterateBatch) => {
    qc.setQueryData(ik.batch(b.id), b)
    qc.invalidateQueries({ queryKey: ["creatives"] })
    qc.invalidateQueries({ queryKey: ik.config }) // 29/10: the new batch shows in "Still working" when the person comes back
    qc.invalidateQueries({ queryKey: ME_KEY }) // amostra-gratis-v1: the sample batch spends the account's sample (sampleUsed)
    router.replace(iterateHref(b.id))
  }
  const create = useMutation({
    mutationFn: (b: { uploadId?: string; creativeId?: string; metaAdId?: string; offerId?: string }) =>
      api.iterate.create(b.uploadId && cleanUploadId ? { ...b, cleanUploadId } : b),
    onSuccess: go,
    onError: (e) => {
      // 422 OFFER_REQUIRED: the selector shows with the offers the API sent (spec D3)
      if (isApiError(e) && e.code === "OFFER_REQUIRED") {
        const d = e.details as unknown as OfferRequiredDetails | undefined
        if (d?.offers?.length) setOffers(d.offers.map((o) => ({ ...o, language: offers.find((x) => x.id === o.id)?.language ?? "" })))
        setOfferAsked(true)
        setOfferId(null)
      }
    },
  })

  // the analysis starts by itself as soon as the upload is complete (§5.1 note 1)
  const ready = upload.state.phase === "ready" ? upload.state.result : null
  const tried = useRef<string | null>(null)
  const start = create.mutate
  useEffect(() => {
    // the clean version still uploading: wait so it goes in the same call
    if (!ready || (needsOffer && !offerId) || cleanBusy) return
    const key = `${ready.uploadId}:${offerId ?? ""}`
    if (tried.current === key) return
    tried.current = key
    start({ uploadId: ready.uploadId, offerId: needsOffer ? offerId! : undefined })
  }, [ready, offerId, needsOffer, start, cleanBusy])

  const busy = upload.state.phase === "uploading" || upload.state.phase === "checking" || !!ready
  const cancelUpload = () => {
    tried.current = null
    create.reset()
    upload.cancel()
  }
  const fromLibrary = create.isPending && !!create.variables?.creativeId ? create.variables.creativeId : null
  const fromMeta = create.isPending && !!create.variables?.metaAdId ? create.variables.metaAdId : null
  const createError = create.isError && !(isApiError(create.error) && create.error.code === "OFFER_REQUIRED") ? create.error : null
  const waitingOffer = !!ready && needsOffer && !offerId
  const stillWorking = config.running ?? []
  const me = useMe()
  const ts = useTranslations("sample")
  const freshSample = me.data?.user.access === "SAMPLE" && !me.data.user.sampleUsed

  // 402 PAYMENT_REQUIRED (sample spent in another tab, or a locked champion): the unlock panel, never the raw error
  if (isApiError(create.error) && create.error.code === "PAYMENT_REQUIRED") return <SampleUsedScreen />

  return (
    <IterWrap>
      <IterFlow current="analyze" />
      <Head eyebrow={freshSample ? ts("badge", { n: SAMPLE_MAX_PIECES }) : undefined} title={t("h1")} lede={freshSample ? ts("newLede", { n: SAMPLE_MAX_PIECES }) : t("lede")} />
      {stillWorking.length ? <StillWorking items={stillWorking} /> : null}
      <MetaPick
        busy={busy || create.isPending}
        running={fromMeta}
        openBatchOf={(metaAdId) => stillWorking.find((r) => r.metaAdId === metaAdId)?.id ?? null}
        onPick={(metaAdId) => create.mutate({ metaAdId, offerId: needsOffer ? offerId ?? undefined : undefined })}
        needsOffer={needsOffer && !offerId}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-4">
        <div id="t-upload" className="flex min-w-0 flex-col gap-3">
          {needsOffer ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="iter-offer" className="text-[13px] font-semibold">
                {t("offerLabel")}
              </label>
              <Select value={offerId ?? ""} onValueChange={(v) => setOfferId(v)}>
                <SelectTrigger id="iter-offer" className={cn("w-full min-w-0", waitingOffer && "border-status-waiting")}>
                  <SelectValue placeholder={t("offerLabel")} />
                </SelectTrigger>
                <SelectContent>
                  {offers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-fg-3">{t("offerHelp")}</span>
            </div>
          ) : null}
          <Source state={upload.state} config={config} inputRef={fileInput} onFile={upload.start} onCancel={cancelUpload} creating={create.isPending && !fromLibrary} />
          <CleanVersionField limits={config} onUploaded={setCleanUploadId} onBusy={setCleanBusy} idPrefix="iter" />
          {createError ? (
            <Alert variant="destructive">
              <NavIcon name="alert" size={20} />
              <AlertBody>
                <AlertTitle>{errorMessage(createError)}</AlertTitle>
              </AlertBody>
              {ready ? (
                <AlertActions>
                  <Button size="sm" onClick={() => create.mutate({ uploadId: ready.uploadId, offerId: needsOffer ? offerId ?? undefined : undefined })}>
                    <NavIcon name="refresh" size={14} />
                    {ta("tryAgain")}
                  </Button>
                </AlertActions>
              ) : null}
            </Alert>
          ) : null}
          <span className="flex items-center gap-1.5 text-xs text-fg-3">
            <NavIcon name="info" size={14} />
            {freshSample ? ts("noCostLine") : t("costLine", { usd: fmt.usd(ready?.analysisEstimateUsd ?? config.analysisTypicalUsd) })}
          </span>
        </div>

        <Card>
          <b>{t("libTitle")}</b>
          {config.recentWinners.length ? (
            config.recentWinners.map((w) => (
              <div key={w.id} className="flex items-center gap-3 rounded-btn border border-line bg-card p-2.5">
                <TypeThumb type="orig" poster={w.thumbnail} className="w-10 flex-none rounded-sm" />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13px]">{w.name}</b>
                  <span className="block truncate text-xs text-fg-3">{t("libWinner", { dur: mmss(w.durationSec), offer: w.offer.name })}</span>
                </span>
                <Button size="sm" disabled={busy || create.isPending} aria-busy={fromLibrary === w.id} onClick={() => create.mutate({ creativeId: w.id })}>
                  {fromLibrary === w.id ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
                  {t("useThis")}
                </Button>
              </div>
            ))
          ) : (
            <p className="m-0 text-[13px] text-fg-3">{t("libEmpty")}</p>
          )}
        </Card>
      </div>
      {/* L1: one lime that exists — "Choose a video" (same picker as the dropzone); while uploading, only Cancel */}
      <IterActionBar hint={waitingOffer ? t("offerLabel") : busy ? t("hintUploading") : metaOn ? t("hintEmptyMeta") : t("hintEmpty")}>
        {busy ? (
          <Button variant="outline" onClick={cancelUpload} disabled={create.isPending && !fromLibrary}>
            {t("cancel")}
          </Button>
        ) : (
          <Button variant="brand" disabled={create.isPending} onClick={() => fileInput.current?.click()}>
            <NavIcon name="up" size={16} />
            {t("chooseVideo")}
          </Button>
        )}
      </IterActionBar>
    </IterWrap>
  )
}

/** Dropzone (mockup .drop) → file row with %, MB and time left, Cancel (mockup "uploading"). */
function Source({ state, config, inputRef: input, onFile, onCancel, creating }: {
  state: UploadState; config: IterateConfig; inputRef: React.RefObject<HTMLInputElement | null>; onFile: (f: File) => void; onCancel: () => void; creating: boolean
}) {
  const t = useTranslations("iterate.new")
  const uploadMessage = useUploadMessage()
  const [over, setOver] = useState(false)

  if (state.phase === "uploading" || state.phase === "checking" || state.phase === "ready") {
    const pct = state.phase === "uploading" ? Math.round((state.loaded / Math.max(1, state.total)) * 100) : 100
    const line =
      state.phase === "uploading"
        ? [t("ofMb", { done: mb(state.loaded), total: mb(state.total) }), state.etaSec !== null ? t("secLeft", { s: state.etaSec }) : null].filter(Boolean).join(" · ")
        : state.phase === "checking" ? t("checking") : t("starting")
    return (
      <div className="flex flex-col gap-2">
        <Card className="gap-0" role="status">
          <div className="flex items-center gap-3">
            <div className={cn("aspect-[9/16] w-11 flex-none rounded-sm border", state.phase === "uploading" ? "border-dashed border-control bg-card-2" : "imggen border-line")} aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex justify-between gap-2">
                <b className="min-w-0 text-[13px] [overflow-wrap:anywhere]">{state.file.name}</b>
                <span className="font-mono text-[13px] tabular-nums">{pct}%</span>
              </div>
              <Bar value={pct} label={state.file.name} />
              <span className="font-mono text-xs text-fg-3 tabular-nums">{line}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={creating}>
              {t("cancel")}
            </Button>
          </div>
        </Card>
        <span className="text-xs text-fg-3">{t("uploadingNote")}</span>
      </div>
    )
  }

  const maxMin = Math.round(config.maxSec / 60)
  return (
    <div className="flex flex-col gap-2.5">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed bg-card px-5 py-7 text-center",
          over ? "border-fg-2 bg-card-2" : "border-control"
        )}
      >
        <NavIcon name="up" size={26} strokeWidth={1.9} />
        <b>{t("drop")}</b>
        <span className="text-[13px] text-fg-3">{t("limits", { mb: Math.round(config.maxBytes / 1024 / 1024), max: t("minutes", { n: maxMin }) })}</span>
        <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
          {t("choose")}
        </Button>
        <input
          ref={input}
          type="file"
          accept={config.mimeTypes.join(",") + ",.mp4,.mov"}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ""
          }}
        />
      </div>
      {state.phase === "error" ? (
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{state.file?.name ?? t("uploadFailed")}</AlertTitle>
            <AlertDescription>{uploadMessage(state.error)}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
    </div>
  )
}

/**
 * "From {client}'s Meta account" (meta-v1 §3.2, spec decision 9 stop 2): the ads already running with their verdict and
 * trend, the winner first and marked. "Iterate it" = POST /iterate { metaAdId } (D13, the only path of Pick from Meta).
 * `?metaAdId=` (from Home) pre-selects the row. Without a ready connection: the neutral alert with "Connect Meta".
 */
function MetaPick({ busy, running, onPick, needsOffer, readOnly, openBatchOf }: { busy: boolean; running: string | null; onPick: (metaAdId: string) => void; needsOffer: boolean; readOnly?: boolean; openBatchOf?: (metaAdId: string) => string | null }) {
  const t = useTranslations("iterate.meta")
  const errorMessage = useErrorMessage()
  const rel = useRelativeTime()
  const conn = useMetaConnection()
  // Gusta 25/10: the ads (with spend / verdict) only with the ad account usable; expired / permission missing = the lock
  const gate = metaGateOf(conn.data)
  const ready = metaReady(conn.data) && gate === "ready"
  const preselected = useSearchParams().get("metaAdId")
  const [all, setAll] = useState(false)
  const ads = useQuery({
    queryKey: mk.ads({ limit: all ? 20 : 3 }),
    queryFn: ({ signal }) => api.meta.ads({ limit: all ? 20 : 3 }, { signal }),
    enabled: ready,
    staleTime: 30_000,
  })
  // ?metaAdId= (Campaigns, Home, Brain): the chosen ad may sit outside the top rows, so fetch it and pin it first
  const picked = useQuery({
    queryKey: mk.ads({ q: preselected ?? "", limit: 1, format: "all" }),
    queryFn: ({ signal }) => api.meta.ads({ q: preselected!, limit: 1, format: "all" }, { signal }),
    enabled: ready && !!preselected,
    staleTime: 30_000,
  })
  const pinned = picked.data?.data.find((a) => a.metaAdId === preselected) ?? null
  const rows = ads.data ? (pinned ? [pinned, ...ads.data.data.filter((a) => a.metaAdId !== pinned.metaAdId)] : ads.data.data) : []
  // QA layout 29/10 #7: a placeholder of the card's size while the connection loads (it used to pop in and push the page down)
  if (conn.isPending)
    return (
      <Card className="gap-3" aria-busy="true">
        <span className="sk h-5 w-48" />
        <AdRowsSkeleton />
      </Card>
    )
  if (conn.isError && !ready) return null
  if (!ready) return <MetaLockCard state={gate} compact />
  const summary = ads.data?.meta.summary
  const first = summary?.sync.state === "first_sync" || summary?.sync.state === "never"
  return (
    <Card id="t-winner" className={cn("gap-3", ads.data?.data[0]?.verdict === "WINNER" && "border-brand-edge")} aria-busy={ads.isPending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>{t("title", { name: conn.data?.adAccount?.name ?? "" })}</h2>
        {summary?.sync.syncedAt ? <Tag tone="ok">{t("synced", { ago: rel(summary.sync.syncedAt) })}</Tag> : null}
      </div>
      {ads.isPending ? (
        <AdRowsSkeleton />
      ) : ads.isError ? (
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{errorMessage(ads.error)}</AlertTitle>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => ads.refetch()}>
              {t("retry")}
            </Button>
          </AlertActions>
        </Alert>
      ) : first ? (
        <p className="m-0 text-[13px] text-fg-3">{t("firstSync")}</p>
      ) : rows.length ? (
        <>
          <div className="flex flex-col gap-2">
            {rows.map((ad, i) => (
              <AdRow
                key={ad.metaAdId}
                ad={ad}
                currency={summary?.currency}
                stats="account"
                selected={preselected === ad.metaAdId}
                winner={i === 0 && ad.verdict === "WINNER"}
                action={
                  openBatchOf?.(ad.metaAdId) ? (
                    // 29/10: this ad already has a batch working; open it instead of paying the analysis again
                    <Link href={iterateHref(openBatchOf(ad.metaAdId))} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      <span className="spin-ring size-3.5" aria-hidden="true" />
                      {t("openRunning")}
                    </Link>
                  ) : (
                  <Button size="sm" variant={i === 0 && ad.verdict === "WINNER" ? "default" : "outline"} disabled={busy || needsOffer || readOnly} title={readOnly ? t("readOnly") : undefined} aria-busy={running === ad.metaAdId} onClick={() => onPick(ad.metaAdId)}>
                    {running === ad.metaAdId ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
                    {ad.championId ? t("iterateAgain") : t("iterateIt")}
                  </Button>
                  )
                }
              />
            ))}
          </div>
          {needsOffer ? <span className="text-xs text-status-waiting">{t("pickOffer")}</span> : null}
          {summary && summary.activeAds > 3 && !all ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(true)}>
              {t("seeAll", { n: summary.activeAds })}
              <NavIcon name="right" size={16} />
            </Button>
          ) : null}
          {summary?.rule ? <span className="text-xs text-fg-3">{t("rule", { spend: summary.rule.minSpendUsd, results: summary.rule.minResults })}</span> : null}
        </>
      ) : (
        <p className="m-0 text-[13px] text-fg-3">{t("noAds")}</p>
      )}
    </Card>
  )
}

/**
 * 29/10 (Tordan's Loom): leaving the screen never cancels a batch — the API keeps working — but /iterate/new had no way
 * back, so it looked cancelled and a second pick paid the analysis again. Batches still working, newest first.
 */
function StillWorking({ items }: { items: IterateRunningRef[] }) {
  const t = useTranslations("iterate.new")
  return (
    <Card className="gap-2.5" role="status">
      <b>{t("runningTitle")}</b>
      {items.map((r) => (
        <Link key={r.id} href={iterateHref(r.id)} className="flex items-center gap-3 rounded-btn border border-line bg-card p-2.5 transition-colors hover:border-fg">
          <span className="spin-ring size-4 flex-none" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[13px]">{r.championName}</b>
            <span className="block truncate text-xs text-fg-3">{t(`running.${r.status}`)}</span>
          </span>
          <span className={buttonVariants({ size: "sm" })}>{t("runningOpen")}</span>
        </Link>
      ))}
    </Card>
  )
}

/** QA layout 29/10 #7: the 3 ad rows at their real height (stacked below 1100 px, one line above), so the card doesn't grow. */
function AdRowsSkeleton() {
  return (
    <div className="grid gap-2 pb-[88px] min-[1100px]:pb-[70px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="sk h-[169px] rounded-md min-[1100px]:h-[72px]" />
      ))}
    </div>
  )
}
