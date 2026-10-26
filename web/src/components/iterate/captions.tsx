"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { ChampionConfig, IterateBatch, IteratePiece } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { useChampionUpload } from "@/components/variar/upload"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ik, useIterateConfig } from "@/hooks/use-iterate"
import { iterateHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { FrameIcon, Tag, useTypeName } from "./parts"

/*
 * legenda-protegida-v1 (APROVADO 26/10), frontend line of §6:
 *  - templates the plan didn't offer because they'd cover the burned-in captions (`insight.captionBlocked`, `burned_captions`):
 *    "This format needs the video without captions" + "Send the version without captions";
 *  - the clean version: POST /champions/:id/clean-version { uploadId } (422 CLEAN_VERSION_MISMATCH { reason });
 *  - "Captions redone in the original style" on a piece with `captionNote: 'replaced'`.
 */

type Limits = Pick<ChampionConfig, "mimeTypes" | "maxBytes">

/** Error line of the clean version (mismatch by reason, else the generic translation). */
function useCleanError() {
  const t = useTranslations("captions.clean")
  const errorMessage = useErrorMessage()
  return (e: unknown) => {
    if (isApiError(e) && e.code === "CLEAN_VERSION_MISMATCH") {
      const r = (e.details as { reason?: string } | undefined)?.reason
      return r && ["duration", "resolution", "fps", "content"].includes(r) ? t(`mismatch.${r}` as never) : t("mismatch.content")
    }
    return errorMessage(e)
  }
}

/**
 * Pick → upload (same flow as the champion: POST /uploads → PUT → complete) → POST /champions/:id/clean-version.
 * `championId` null = only upload and hand back the uploadId (`onUploaded`, the optional field before the champion exists).
 */
export function CleanVersionUpload({
  championId, limits, onDone, onUploaded, onBusy, label, variant = "default",
}: { championId: string | null; limits: Limits | undefined; onDone?: () => void; onUploaded?: (uploadId: string | null) => void; onBusy?: (busy: boolean) => void; label?: string; variant?: "default" | "outline" }) {
  const t = useTranslations("captions.clean")
  const cleanError = useCleanError()
  const input = useRef<HTMLInputElement>(null)
  const upload = useChampionUpload(limits)
  const [saved, setSaved] = useState(false)
  const attach = useMutation({
    mutationFn: (uploadId: string) => api.champions.setCleanVersion(championId!, { uploadId }),
    onSuccess: () => {
      setSaved(true)
      toast(t("savedToast"))
      onDone?.()
    },
  })
  const st = upload.state
  const ready = st.phase === "ready" ? st.result.uploadId : null
  // the upload finished: attach it to the champion (or hand it back)
  const handled = useRef<string | null>(null)
  const attachMutate = attach.mutate
  useEffect(() => {
    if (!ready || handled.current === ready) return
    handled.current = ready
    if (championId) attachMutate(ready)
    else onUploaded?.(ready)
  }, [ready, championId, attachMutate, onUploaded])

  const busy = st.phase === "uploading" || st.phase === "checking" || attach.isPending
  // the upload screen waits for it before POST /iterate (it goes in the same call)
  useEffect(() => {
    onBusy?.(busy)
  }, [busy, onBusy])
  const pct = st.phase === "uploading" && st.total ? Math.round((st.loaded / st.total) * 100) : null
  const err = st.phase === "error" ? st.error : attach.isError ? attach.error : null
  const done = saved || (!championId && !!ready)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <input
        ref={input}
        type="file"
        accept={limits?.mimeTypes.join(",") ?? "video/mp4,video/quicktime"}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (!f) return
          setSaved(false)
          handled.current = null
          attach.reset()
          onUploaded?.(null)
          void upload.start(f)
        }}
      />
      {done ? (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-status-approved" role="status">
          <NavIcon name="check" size={14} strokeWidth={2.6} />
          {championId ? t("saved") : t("attached", { name: st.phase === "ready" ? st.file.name : "" })}
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-fg-2 underline underline-offset-2" onClick={() => input.current?.click()}>
            {t("change")}
          </button>
        </span>
      ) : (
        <Button size="sm" variant={variant} disabled={busy} onClick={() => input.current?.click()} className="w-full tablet:w-auto">
          {busy ? <span className="spin-ring size-3.5 border-current" aria-hidden="true" /> : <NavIcon name="upload" size={14} />}
          {st.phase === "uploading" ? t("uploading", { p: pct ?? 0 }) : st.phase === "checking" || attach.isPending ? t("checking") : (label ?? t("send"))}
        </Button>
      )}
      {err ? <span className="text-xs font-semibold text-status-failed" role="alert">{cleanError(err)}</span> : null}
      {!done && !err ? <span className="text-xs text-fg-3">{t("hint")}</span> : null}
    </div>
  )
}

/** The optional field of the champion upload ("I also have it without captions"). Hands back the uploadId. */
export function CleanVersionField({ limits, onUploaded, onBusy, idPrefix }: { limits: Limits | undefined; onUploaded: (uploadId: string | null) => void; onBusy?: (busy: boolean) => void; idPrefix: string }) {
  const t = useTranslations("captions.clean")
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-line-strong bg-card p-3" aria-labelledby={`${idPrefix}-clean`}>
      <b id={`${idPrefix}-clean`} className="text-[13px]">{t("fieldTitle")}</b>
      <span className="text-xs text-fg-3">{t("fieldBody")}</span>
      <CleanVersionUpload championId={null} limits={limits} onUploaded={onUploaded} onBusy={onBusy} label={t("fieldButton")} variant="outline" />
    </div>
  )
}

/** "Not offered" block of the plan / Generate: one line per template, one button for all (it's one video). */
export function CaptionBlocked({ batch, className }: { batch: IterateBatch; className?: string }) {
  const t = useTranslations("captions")
  const tf = useTranslations("iterate.frame.name")
  const typeName = useTypeName()
  const cfg = useIterateConfig()
  const [sent, setSent] = useState(false)
  const list = batch.insight?.captionBlocked ?? []
  if (!list.length) return null
  return (
    <section aria-labelledby="cap-blocked-h" className={cn("flex flex-col gap-2.5 rounded-lg border border-status-waiting-edge bg-status-waiting-bg p-3.5", className)}>
      <div className="flex flex-col gap-0.5">
        <b id="cap-blocked-h" className="text-sm">{t("blockedTitle", { n: list.length })}</b>
        <span className="text-[13px] text-fg-2">{t("blockedBody")}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {list.map((x, i) => (
          <li key={`${x.type}-${x.template ?? i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-card px-2.5 py-2 text-[13px]">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              {x.template ? <FrameIcon id={x.template} /> : null}
              {x.template ? t("frameNamed", { name: tf(x.template) }) : typeName(x.type)}
            </span>
            <span className="text-fg-3">· {t("needsClean")}</span>
          </li>
        ))}
      </ul>
      {sent ? (
        <Replan batch={batch} />
      ) : (
        <CleanVersionUpload championId={batch.source.championId} limits={cfg.data} onDone={() => setSent(true)} />
      )}
    </section>
  )
}

/**
 * D-LP5: after the clean version, "Replan" (POST /iterate/:id/replan, only PLAN_READY). A launched batch can't be replanned
 * (409 reason 'launched'): the pieces are creatives already, so the way is a new batch with the clean version.
 */
function Replan({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("captions")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const replan = useMutation({
    mutationFn: () => api.iterate.replan(batch.id),
    onSuccess: (b) => {
      qc.setQueryData(ik.batch(b.id), b)
      toast(t("replanned"))
    },
  })
  const launched =
    batch.status === "LAUNCHED" ||
    (isApiError(replan.error) && replan.error.code === "INVALID_STATE" && (replan.error.details as { reason?: string } | undefined)?.reason === "launched")
  if (launched)
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-fg-2">{t("launched")}</span>
        <NewBatchButton batch={batch} variant="brand" label={t("newBatch")} />
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] text-fg-2">{t("afterSendReplan")}</span>
      <Button size="sm" variant="brand" disabled={replan.isPending} onClick={() => replan.mutate()} className="w-full tablet:w-auto tablet:self-start">
        {replan.isPending ? <span className="spin-ring size-3.5 border-current" aria-hidden="true" /> : <NavIcon name="refresh" size={14} />}
        {t("replan")}
      </Button>
      {replan.isError && !launched ? <span className="text-xs font-semibold text-status-failed" role="alert">{errorMessage(replan.error)}</span> : null}
    </div>
  )
}

/** 26/10: POST /iterate { championId } — a new batch of the same champion, its analysis reused (no new upload). */
export function NewBatchButton({ batch, variant = "outline", label, className }: { batch: IterateBatch; variant?: "outline" | "brand"; label?: string; className?: string }) {
  const t = useTranslations("captions")
  const router = useRouter()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const make = useMutation({
    mutationFn: () => api.iterate.create({ championId: batch.source.championId }),
    onSuccess: (b) => {
      qc.setQueryData(ik.batch(b.id), b)
      router.push(iterateHref(b.id))
    },
    onError: (e) => toast(errorMessage(e)),
  })
  return (
    <Button size="sm" variant={variant} disabled={make.isPending} onClick={() => make.mutate()} className={cn("w-full tablet:w-auto tablet:self-start", className)}>
      {make.isPending ? <span className="spin-ring size-3.5 border-current" aria-hidden="true" /> : <NavIcon name="iter" size={14} />}
      {label ?? t("anotherBatch")}
    </Button>
  )
}

/** insight.cleanVersion (the clean version sent with POST /iterate): applied = one quiet line; mismatch = why + send again. */
export function CleanVersionStatus({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("captions.clean")
  const cfg = useIterateConfig()
  const [resent, setResent] = useState(false)
  const cv = batch.insight?.cleanVersion
  if (!cv) return null
  if (cv.status === "applied")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-status-approved" role="status">
        <NavIcon name="check" size={14} strokeWidth={2.6} />
        {t("applied")}
      </span>
    )
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-status-waiting-edge bg-status-waiting-bg p-3.5" aria-labelledby="clean-mm-h">
      <b id="clean-mm-h" className="text-sm">{t("mismatchTitle")}</b>
      <span className="text-[13px] text-fg-2">{t(`mismatch.${cv.reason ?? "content"}` as never)} {t("usedOriginal")}</span>
      {resent ? <Replan batch={batch} /> : <CleanVersionUpload championId={batch.source.championId} limits={cfg.data} onDone={() => setResent(true)} label={t("sendAgain")} />}
    </section>
  )
}

/** "Captions redone in the original style" (captionNote 'replaced'). */
export function CaptionNote({ p, className }: { p: IteratePiece; className?: string }) {
  const t = useTranslations("captions")
  if (p.captionNote !== "replaced") return null
  return (
    <Tag tone="info" className={className}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 12h3M12 12h5M7 15.5h6M15 15.5h2" />
      </svg>
      {t("replaced")}
    </Tag>
  )
}
