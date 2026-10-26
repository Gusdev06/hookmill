"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { ChampionConfig, ChampionDetail, CompleteUploadResponse } from "@/lib/api/types"
import { variarHref } from "@/lib/routes"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checklist } from "@/components/fx"
import { Icon } from "@/components/icon"
import { EmptyState, Panel } from "@/components/page"
import { ActionBar, WzHead } from "@/components/wizard/shell"
import { Banner, mmss, useMoney } from "@/components/wizard/common"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useLanguageName } from "@/hooks/use-language-name"
import { useChampionConfig, vk } from "@/hooks/use-variar"
import { cn } from "@/lib/utils"
import { VariarFrame } from "./frame"
import { aspect, mb, uploadErrorDetails, useChampionUpload, type UploadState } from "./upload"
import { CleanVersionField } from "@/components/iterate/captions"

const AD_URL = /facebook\.com\/ads\/library\/?\?(?:[^#]*&)?id=\d+/

/** Translates upload / champion errors with their details (limits come from the API answer). */
export function useUploadMessage() {
  const t = useTranslations("variar.uploadErrors")
  const errorMessage = useErrorMessage()
  const format = useFormatter()
  return (e: unknown) => {
    if (!isApiError(e)) return errorMessage(e)
    const d = uploadErrorDetails(e) as Record<string, unknown>
    switch (e.code) {
      case "MEDIA_TOO_LARGE":
        return t("MEDIA_TOO_LARGE", { max: Math.round(Number(d.maxBytes ?? 0) / 1024 / 1024) })
      case "MEDIA_TOO_SHORT":
        return t("MEDIA_TOO_SHORT", { dur: Math.round(Number(d.durationSec ?? 0)), min: Number(d.minSec ?? 5) })
      case "MEDIA_TOO_LONG":
        return t("MEDIA_TOO_LONG", { dur: mmss(Number(d.durationSec ?? 0)), max: mmss(Number(d.maxSec ?? 120)) })
      case "MEDIA_INVALID":
        return t(`MEDIA_INVALID_${String(d.reason ?? "undecodable")}` as never)
      case "UPLOAD_EXPIRED":
      case "UPLOAD_INCOMPLETE":
        return t(e.code)
      case "AD_LIBRARY_UNAVAILABLE":
        return d.retryAfter
          ? t("AD_LIBRARY_UNAVAILABLE_until", { date: format.dateTime(new Date(`${d.retryAfter}T12:00:00`), { month: "short", day: "numeric" }) })
          : t("AD_LIBRARY_UNAVAILABLE")
      case "VALIDATION_ERROR":
        return (d.fields as { field: string }[] | undefined)?.some((f) => f.field === "adLibraryUrl") ? t("badLink") : errorMessage(e)
      default:
        return errorMessage(e)
    }
  }
}

function limitsLine(t: ReturnType<typeof useTranslations<"variar">>, c: ChampionConfig | undefined) {
  if (!c) return t("winner.formats", { mb: 200, min: "0:05", max: "2:00" })
  return t("winner.formats", { mb: Math.round(c.maxBytes / 1024 / 1024), min: mmss(c.minSec), max: mmss(c.maxSec) })
}

/** VideoDropzone (spec §4): native file input + drag-and-drop, upload progress, ready file card. */
function VideoDropzone({ config, state, onFile, onCancel, emphasize }: {
  config: ChampionConfig | undefined; state: UploadState; onFile: (f: File) => void; onCancel: () => void; emphasize?: boolean
}) {
  const t = useTranslations("variar")
  const uploadMessage = useUploadMessage()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pick = () => input.current?.click()
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={(config?.mimeTypes ?? ["video/mp4", "video/quicktime"]).join(",") + ",.mp4,.mov"}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) onFile(f)
        e.target.value = ""
      }}
    />
  )

  if (state.phase === "uploading" || state.phase === "checking") {
    const pct = state.phase === "uploading" ? Math.round((state.loaded / Math.max(1, state.total)) * 100) : 100
    const left = state.phase === "uploading" ? state.etaSec : null
    return (
      <div className="grid gap-2.5 rounded-lg border border-line bg-surface-2 p-3.5" role="status">
        <div className="flex min-w-0 items-center gap-3">
          <Icon name="film" className="text-fg-3" />
          <span className="min-w-0 flex-1 truncate font-medium">{state.file.name}</span>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
        <Progress value={pct} aria-label={t("winner.uploading")} />
        <span className="row-sub font-mono">
          {state.phase === "checking"
            ? t("winner.checking")
            : `${pct}% · ${t("winner.ofMb", { done: mb(state.loaded), total: mb(state.total) })}${left !== null ? ` · ${t("winner.secLeft", { s: left })}` : ""}`}
        </span>
      </div>
    )
  }

  if (state.phase === "ready") {
    const f = state.result.file
    return (
      <div className="grid gap-2.5">
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <div className="relative aspect-[9/16] w-12 flex-none overflow-hidden rounded-sm border border-line bg-stage">
            <video src={f.url} muted playsInline preload="metadata" className="size-full object-cover" aria-hidden="true" />
            <span className="absolute inset-0 grid place-items-center text-white opacity-85">
              <Icon name="play" />
            </span>
          </div>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate font-medium">{state.file.name}</span>
            <span className="row-sub font-mono">
              {[f.durationSec ? mmss(f.durationSec) : null, aspect(f.width, f.height), f.width && f.height ? `${f.width}×${f.height}` : null, `${mb(state.file.size)} MB`].filter(Boolean).join(" · ")}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={pick}>
            {t("winner.replace")}
          </Button>
          {fileInput}
        </div>
        {state.result.warnings.map((w) => (
          <Banner key={w} icon="info" title={t(`winner.warning.${w}`)} />
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-2.5">
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
          "grid justify-items-center gap-2 rounded-lg border border-dashed px-4 py-7 text-center",
          over || emphasize ? "border-fg-2 bg-surface-2" : "border-line-2"
        )}
      >
        <span className="grid size-9 place-items-center rounded-full border border-line-2 text-fg-2">
          <Icon name="upload" />
        </span>
        <b className="font-semibold">{t("winner.drop")}</b>
        <span className="text-[13px] text-fg-2">{limitsLine(t, config)}</span>
        <Button size="sm" variant={emphasize ? "default" : "outline"} onClick={pick}>
          {t("winner.choose")}
        </Button>
        {fileInput}
      </div>
      {state.phase === "error" ? <Banner kind="error" title={state.file?.name ?? t("winner.uploadFailed")} body={uploadMessage(state.error)} /> : null}
    </div>
  )
}

function WhatNext() {
  const t = useTranslations("variar.winner")
  const rows: [Parameters<typeof Icon>[0]["name"], string][] = [["film", t("next1")], ["pencil", t("next2")], ["branch", t("next3")]]
  return (
    <Panel className="content-start">
      <h2>{t("nextTitle")}</h2>
      <ul className="m-0 grid list-none gap-3 p-0 text-[13px] text-fg-2">
        {rows.map(([icon, text]) => (
          <li key={icon} className="flex items-start gap-2.5">
            <Icon name={icon} className="mt-0.5 text-fg-3" />
            {text}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** Step 1 · Winner (spec §5.1). New: offer + upload or link + owner checkbox, "Analyze · $x". Existing: link reading / failed link + attach the file. */
export function WinnerStep({ champion }: { champion: ChampionDetail | null }) {
  const t = useTranslations("variar")
  const tc = useTranslations("common")
  const money = useMoney()
  const lang = useLanguageName()
  const router = useRouter()
  const qc = useQueryClient()
  const uploadMessage = useUploadMessage()
  const params = useSearchParams()
  const config = useChampionConfig()
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list() })
  const upload = useChampionUpload(config.data)
  const [cleanUploadId, setCleanUploadId] = useState<string | null>(null)
  const [offerId, setOfferId] = useState<string | null>(champion?.offer.id ?? params.get("offer"))
  const [link, setLink] = useState(champion?.adLibraryUrl ?? "")
  const [mine, setMine] = useState(champion ? champion.rights === "OWN" : true)
  const [linkError, setLinkError] = useState<unknown>(null)
  const offerList = offers.data?.data ?? []
  const offer = offerList.find((o) => o.id === offerId) ?? (champion ? null : offerList[0] ?? null)
  const ready = upload.state.phase === "ready" ? (upload.state.result as CompleteUploadResponse) : null
  const adlib = config.data?.adLibrary
  const linkOff = adlib ? !adlib.available : false
  const busy = champion?.status === "RESOLVING"
  const linkFailed = champion?.status === "FAILED" && champion.action === "upload_video"
  const format = useFormatter()

  // RESOLVING turned into ANALYZING while this page was open: the link worked, go read the teardown
  const wasBusy = useRef(false)
  useEffect(() => {
    if (busy) wasBusy.current = true
    else if (wasBusy.current && champion && (champion.status === "ANALYZING" || champion.status === "READY")) router.replace(variarHref(champion.id, "teardown"))
  }, [busy, champion, router])

  const create = useMutation({
    mutationFn: (mode: "upload" | "link") =>
      api.champions.create({
        offerId: offer!.id,
        uploadId: mode === "upload" ? ready?.uploadId : undefined,
        // legenda-protegida §2.3: optional version without the burned-in captions
        cleanUploadId: mode === "upload" && cleanUploadId ? cleanUploadId : undefined,
        adLibraryUrl: link.trim() && AD_URL.test(link.trim()) ? link.trim() : mode === "link" ? link.trim() : undefined,
        rights: mine ? "OWN" : "THIRD_PARTY",
      }),
    onSuccess: (c, mode) => {
      qc.setQueryData(vk.champion(c.id), c)
      qc.invalidateQueries({ queryKey: ["champions"] })
      router.push(variarHref(c.id, mode === "upload" ? "teardown" : "winner"))
    },
    onError: (e, mode) => (mode === "link" ? setLinkError(e) : toast(uploadMessage(e))),
  })
  const attach = useMutation({
    mutationFn: () => api.champions.attachVideo(champion!.id, { uploadId: ready!.uploadId }),
    onSuccess: (c) => {
      qc.setQueryData(vk.champion(c.id), c)
      router.push(variarHref(c.id, "teardown"))
    },
    onError: (e) => toast(uploadMessage(e)),
  })
  const rights = useMutation({
    mutationFn: (own: boolean) => api.champions.update(champion!.id, { rights: own ? "OWN" : "THIRD_PARTY" }),
    onSuccess: (c) => qc.setQueryData(vk.champion(c.id), c),
  })

  const price = ready ? ready.analysisEstimateUsd : null
  const canAnalyze = !!ready && (!!offer || !!champion) && !create.isPending && !attach.isPending
  const primary = champion && !linkFailed ? (
    <Button data-primary variant="default" disabled={busy} onClick={() => router.push(variarHref(champion.id, "teardown"))}>
      {t("continueTo", { step: t("steps.teardown") })}
    </Button>
  ) : (
    <Button
      data-primary
      variant="default"
      disabled={!canAnalyze}
      onClick={() => (champion ? attach.mutate() : create.mutate("upload"))}
    >
      {t("winner.analyze")}
      {price !== null ? (
        <>
          {" · "}
          <span className="font-mono">{money(price)}</span>
        </>
      ) : null}
    </Button>
  )

  if (offers.isSuccess && !offerList.length && !champion) {
    return (
      <VariarFrame champion={null} viewing="winner">
        <WzHead title={t("title")} sub={t("winner.sub")} />
        <EmptyState>
          <h2>{t("winner.noOfferTitle")}</h2>
          <p className="text-fg-2">{t("winner.noOfferBody")}</p>
          <div>
            <Link href="/offers" className={buttonVariants({ variant: "default" })}>
              <Icon name="plus" />
              {t("winner.newOffer")}
            </Link>
          </div>
        </EmptyState>
      </VariarFrame>
    )
  }

  const linkBlock = (
    <div className="grid gap-2">
      <label htmlFor="adlink" className="flex items-center gap-2 text-[13px] text-fg-2">
        <Icon name="link" />
        {t("winner.linkLabel")}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 tablet:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          id="adlink"
          value={link}
          inputMode="url"
          placeholder="https://www.facebook.com/ads/library/?id=…"
          disabled={!!champion || (linkOff && !link)}
          onChange={(e) => {
            setLink(e.target.value)
            setLinkError(null)
          }}
        />
        {!champion ? (
          <Button
            disabled={!link.trim() || !offer || create.isPending || linkOff || upload.state.phase === "ready"}
            onClick={() => (AD_URL.test(link.trim()) || link.includes("mock-ad-") ? create.mutate("link") : setLinkError("badLink"))}
          >
            {t("winner.fetch")}
          </Button>
        ) : null}
      </div>
      {linkOff && !champion ? (
        <span className="text-[13px] text-fg-2">
          {adlib?.retryAfter
            ? t("winner.linkOffUntil", { date: format.dateTime(new Date(`${adlib.retryAfter}T12:00:00`), { month: "short", day: "numeric" }) })
            : t("winner.linkOff")}
        </span>
      ) : upload.state.phase === "ready" && link.trim() ? (
        <span className="text-[13px] text-fg-2">{t("winner.linkWithUpload")}</span>
      ) : null}
      {linkError ? (
        <Banner
          kind="error"
          title={t("winner.linkFailedTitle")}
          body={linkError === "badLink" ? t("uploadErrors.badLink") : uploadMessage(linkError)}
        />
      ) : null}
    </div>
  )

  return (
    <VariarFrame
      champion={champion}
      viewing="winner"
      offer={offer ? { name: offer.name, language: offer.language } : null}
      actionbar={<ActionBar hint={busy ? t("winner.hintReading") : ready ? t("winner.hintReady") : champion && !linkFailed ? null : t("winner.hintEmpty")} primary={primary} />}
    >
      <WzHead title={t("title")} sub={t("winner.sub")} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desktop:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-4">
          <Panel>
            <div className="grid gap-1.5">
              <span className="text-[13px] text-fg-2">{t("winner.offerLabel")}</span>
              {offers.isPending ? (
                <span className="sk h-9 rounded-sm" />
              ) : (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Select value={offer?.id ?? champion?.offer.id ?? ""} onValueChange={setOfferId} disabled={!!champion}>
                    <SelectTrigger className="w-full min-w-0" aria-label={t("winner.offerLabel")}>
                      <SelectValue placeholder={champion?.offer.name} />
                    </SelectTrigger>
                    <SelectContent>
                      {offerList.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name} · {lang(o.language)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!champion ? (
                    <Link href="/offers" className={buttonVariants()}>
                      <Icon name="plus" />
                      <span className="hidden tablet:inline">{t("winner.newOffer")}</span>
                    </Link>
                  ) : null}
                </div>
              )}
              <span className="text-[13px] text-fg-2">{t("winner.offerHelp")}</span>
            </div>
          </Panel>

          <Panel>
            <h2>{t("winner.theWinner")}</h2>
            {busy && champion ? (
              <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-3.5" role="status">
                <span className="truncate font-mono text-xs text-fg-2">{champion.adLibraryUrl}</span>
                <Checklist
                  items={(champion.job?.checklist ?? []).map((c, i, all) => ({
                    label: t(`job.${c.key}` as never),
                    state: c.done ? "done" : all.findIndex((x) => !x.done) === i ? "now" : "todo",
                  }))}
                />
              </div>
            ) : champion && !linkFailed ? (
              <ChampionFileCard champion={champion} />
            ) : (
              <>
                {linkFailed && champion ? (
                  <Banner
                    kind="error"
                    title={t("winner.linkFailedTitle")}
                    body={champion.failReason ?? uploadMessage(champion.errorCode)}
                  />
                ) : null}
                <VideoDropzone config={config.data} state={upload.state} onFile={upload.start} onCancel={upload.cancel} emphasize={linkFailed} />
                {!champion ? <CleanVersionField limits={config.data} onUploaded={setCleanUploadId} idPrefix="win" /> : null}
                {!linkFailed ? (
                  <>
                    <div className="flex items-center gap-3 font-mono text-xs text-fg-3 uppercase" aria-hidden="true">
                      <i className="h-px flex-1 bg-line" />
                      {t("or")}
                      <i className="h-px flex-1 bg-line" />
                    </div>
                    {linkBlock}
                  </>
                ) : (
                  <span className="truncate font-mono text-xs text-fg-3">
                    {t("winner.linkSaved")} {champion?.adLibraryUrl}
                  </span>
                )}
              </>
            )}
          </Panel>

          <Panel>
            <label className="flex items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={mine}
                onCheckedChange={(v) => {
                  setMine(v === true)
                  if (champion) rights.mutate(v === true)
                }}
              />
              <span className="grid gap-0.5">
                <b className="font-semibold">{t("winner.mine")}</b>
                <span className="max-w-[60ch] text-[13px] text-fg-2">{t("winner.mineHelp")}</span>
              </span>
            </label>
          </Panel>
        </div>
        <WhatNext />
      </div>
      {config.isError ? <Banner kind="error" title={tc("retry")} body={uploadMessage(config.error)} /> : null}
    </VariarFrame>
  )
}

function ChampionFileCard({ champion }: { champion: ChampionDetail }) {
  const t = useTranslations("variar")
  const v = champion.video
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
      <div className="relative aspect-[9/16] w-12 flex-none overflow-hidden rounded-sm border border-line bg-stage">
        {champion.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={champion.thumbnail.url} alt="" className="size-full object-cover" />
        ) : null}
      </div>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium">{champion.name}</span>
        <span className="row-sub font-mono">
          {[v?.durationSec ? mmss(v.durationSec) : null, aspect(v?.width, v?.height), v?.width && v?.height ? `${v.width}×${v.height}` : null].filter(Boolean).join(" · ")}
        </span>
        {champion.adLibraryUrl ? <span className="row-sub font-mono text-fg-3">{champion.adLibraryUrl}</span> : null}
      </div>
      <span className="text-[13px] text-fg-3">{champion.sources.includes("UPLOAD") ? t("rail.upload") : t("rail.adLibrary")}</span>
    </div>
  )
}
