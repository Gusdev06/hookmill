"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { ApiError, isApiError } from "@/lib/api/errors"
import type { BrandAsset, BrandAssetKind, BrandKit as BrandKitData, Offer } from "@/lib/api/types"
import { effectiveRole } from "@/lib/dev-role"
import { useSession } from "@/components/providers/session-provider"
import { useChampionConfig } from "@/hooks/use-variar"
import { useErrorMessage } from "@/hooks/use-error-message"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { mb } from "@/components/variar/upload"
import { cn } from "@/lib/utils"
import { Reveal } from "@/components/ui/reveal"
import { sampleFile } from "@/lib/skeleton-samples"

const sampleAsset = (id: string, kind: BrandAssetKind): BrandAsset => ({ id, kind, label: "Sample file name", file: sampleFile, offerId: null, colors: [], createdAt: "2026-11-01T12:00:00.000Z" })
const SAMPLE_BRAND_KIT: BrandKitData = { logo: sampleAsset("sample-logo", "LOGO"), files: [sampleAsset("sample-f1", "FILE"), sampleAsset("sample-f2", "FILE")], demoVideos: [] }

/*
 * Kit da marca v1 (docs/contratos/kit-marca-v1.md): logo + brand files + demo videos of the client (workspace).
 * Self-contained (reads GET /brand-kit and the offers itself), so it drops into the onboarding step 4 and the Brand screen.
 * Upload = the feature 2 flow (POST /uploads → PUT → complete) with purpose BRAND_*, then POST /brand-kit/assets.
 * CLIENT reads only (the API answers 403 to every write).
 */

export const BRAND_KIT_KEY = ["brand-kit"] as const

const MB = 1024 * 1024
const VIDEO_MAX_FALLBACK = 200 * MB
const LABEL_MAX = 80

interface KindRule {
  purpose: "BRAND_LOGO" | "BRAND_FILE" | "BRAND_VIDEO"
  mimes: string[]
  accept: string
  types: string
  max: number
}
const RULES: Record<BrandAssetKind, KindRule> = {
  LOGO: { purpose: "BRAND_LOGO", mimes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"], accept: "image/png,image/jpeg,image/webp,image/svg+xml,.svg", types: "PNG, JPG, WEBP, SVG", max: 1 },
  FILE: { purpose: "BRAND_FILE", mimes: ["image/png", "image/jpeg", "image/webp", "application/pdf"], accept: "image/png,image/jpeg,image/webp,application/pdf,.pdf", types: "PNG, JPG, WEBP, PDF", max: 30 },
  DEMO_VIDEO: { purpose: "BRAND_VIDEO", mimes: ["video/mp4", "video/quicktime"], accept: "video/mp4,video/quicktime,.mp4,.mov", types: "MP4, MOV", max: 5 },
}
const FIXED_MAX_BYTES: Partial<Record<BrandAssetKind, number>> = { LOGO: 5 * MB, FILE: 25 * MB }

const EXT_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4", mov: "video/quicktime" }
/** some browsers leave .mov (and sometimes .svg) without a type */
const mimeOf = (f: File) => f.type || EXT_MIME[f.name.split(".").pop()?.toLowerCase() ?? ""] || ""
const baseName = (name: string) => name.replace(/\.[^.]+$/, "").trim().slice(0, LABEL_MAX)
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
const isPdf = (a: BrandAsset) => a.file.mimeType === "application/pdf"

// ───────────── uploads ─────────────

type JobPhase = "uploading" | "checking" | "saving" | "error"
interface Job { id: string; kind: BrandAssetKind; file: File; phase: JobPhase; loaded: number; total: number; error: unknown; ctl: AbortController }

/** Local check failures use the same shape as the API's, so one message function covers both. */
const localError = (code: string, details: Record<string, unknown>) => new ApiError("http", code, 422, code, details)

function useBrandUploads(kit: BrandKitData | undefined, videoMaxBytes: number) {
  const qc = useQueryClient()
  const [jobs, setJobs] = useState<Job[]>([])
  const jobsRef = useRef(jobs)
  useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])
  useEffect(() => () => jobsRef.current.forEach((j) => j.ctl.abort()), [])

  const patchJob = (id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)))
  const maxBytesOf = useCallback((kind: BrandAssetKind) => FIXED_MAX_BYTES[kind] ?? videoMaxBytes, [videoMaxBytes])

  const run = useCallback(
    async (job: Job) => {
      const { kind, file, ctl } = job
      try {
        const target = await api.uploads.create({ purpose: RULES[kind].purpose, filename: file.name, mimeType: mimeOf(file), sizeBytes: file.size })
        await api.uploads.send(target, file, { signal: ctl.signal, onProgress: (loaded, total) => patchJob(job.id, { loaded, total }) })
        patchJob(job.id, { phase: "checking" })
        const done = await api.uploads.complete(target.uploadId)
        if (ctl.signal.aborted) return
        patchJob(job.id, { phase: "saving" })
        const asset = await api.brandKit.addAsset({ kind, uploadId: done.uploadId, label: kind === "LOGO" ? null : baseName(file.name) || null })
        qc.setQueryData<BrandKitData>(BRAND_KIT_KEY, (k) => (k ? withAsset(k, asset) : k))
        qc.invalidateQueries({ queryKey: BRAND_KIT_KEY })
        qc.invalidateQueries({ queryKey: ["brain"] })
        setJobs((js) => js.filter((j) => j.id !== job.id))
      } catch (e) {
        if (ctl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return
        patchJob(job.id, { phase: "error", error: e })
      }
    },
    [qc]
  )

  /** Checks type, size and the slots left, then sends what passed. Logo takes only the first file. */
  const add = useCallback(
    (kind: BrandAssetKind, list: File[]) => {
      if (!list.length) return
      const rule = RULES[kind]
      const files = kind === "LOGO" ? list.slice(0, 1) : list
      const have = kind === "LOGO" ? 0 : (kind === "FILE" ? kit?.files.length : kit?.demoVideos.length) ?? 0
      const busy = jobsRef.current.filter((j) => j.kind === kind && j.phase !== "error").length
      let free = rule.max - have - busy
      const next: Job[] = []
      for (const file of files) {
        const base = { id: crypto.randomUUID(), kind, file, loaded: 0, total: file.size, ctl: new AbortController() }
        let error: ApiError | null = null
        if (!rule.mimes.includes(mimeOf(file))) error = localError("MEDIA_INVALID", { reason: "mime" })
        else if (file.size > maxBytesOf(kind)) error = localError("MEDIA_TOO_LARGE", { maxBytes: maxBytesOf(kind) })
        else if (kind !== "LOGO" && free <= 0) error = localError("INVALID_STATE", { reason: "brand_kit_full", kind, max: rule.max })
        if (error) next.push({ ...base, phase: "error", error })
        else {
          if (kind !== "LOGO") free--
          next.push({ ...base, phase: "uploading", error: null })
        }
      }
      // a new logo replaces the one still uploading
      if (kind === "LOGO") jobsRef.current.filter((j) => j.kind === "LOGO").forEach((j) => j.ctl.abort())
      setJobs((js) => [...(kind === "LOGO" ? js.filter((j) => j.kind !== "LOGO") : js), ...next])
      next.filter((j) => j.phase === "uploading").forEach((j) => void run(j))
    },
    [kit, maxBytesOf, run]
  )

  const dismiss = useCallback((id: string) => {
    jobsRef.current.find((j) => j.id === id)?.ctl.abort()
    setJobs((js) => js.filter((j) => j.id !== id))
  }, [])

  return { jobs, add, dismiss, maxBytesOf }
}

function withAsset(k: BrandKitData, a: BrandAsset): BrandKitData {
  if (a.kind === "LOGO") return { ...k, logo: a }
  const key = a.kind === "FILE" ? "files" : "demoVideos"
  const list = k[key].some((x) => x.id === a.id) ? k[key].map((x) => (x.id === a.id ? a : x)) : [...k[key], a]
  return { ...k, [key]: list }
}
function withoutAsset(k: BrandKitData, id: string): BrandKitData {
  return { logo: k.logo?.id === id ? null : k.logo, files: k.files.filter((x) => x.id !== id), demoVideos: k.demoVideos.filter((x) => x.id !== id) }
}

/** Plain-language upload errors: type, size, length and the kit's limits. */
function useBrandError() {
  const t = useTranslations("brandKit.errors")
  const errorMessage = useErrorMessage()
  return (e: unknown, kind: BrandAssetKind, maxBytes: number) => {
    const d = (isApiError(e) ? e.details : null) ?? {}
    const code = isApiError(e) ? e.code : null
    switch (code) {
      case "MEDIA_INVALID":
        if (d.reason === "mime") return t("type", { types: RULES[kind].types })
        if (d.reason === "too_small") return t("tooSmall")
        return t(kind === "DEMO_VIDEO" ? "unreadableVideo" : "unreadable")
      case "MEDIA_TOO_LARGE":
        return t("size", { mb: Math.round(Number(d.maxBytes ?? maxBytes) / MB) })
      case "MEDIA_TOO_SHORT":
        return t("short")
      case "MEDIA_TOO_LONG":
        return t("long")
      case "INVALID_STATE":
        return d.reason === "brand_kit_full" ? t(kind === "FILE" ? "fullFiles" : "fullVideos", { max: Number(d.max ?? RULES[kind].max) }) : errorMessage(e)
      case "FORBIDDEN":
        return t("forbidden")
      default:
        return errorMessage(e)
    }
  }
}

// ───────────── the component ─────────────

export function BrandKit({ title, aside, className }: { title?: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  const t = useTranslations("brandKit")
  const tc = useTranslations("common")
  const tl = useTranslations("skeleton")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const { session } = useSession()
  const canEdit = effectiveRole(session.workspace.role) !== "CLIENT"
  const kit = useQuery({ queryKey: BRAND_KIT_KEY, queryFn: ({ signal }) => api.brandKit.get({ signal }) })
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list() })
  const config = useChampionConfig()
  const up = useBrandUploads(kit.data, config.data?.maxBytes ?? VIDEO_MAX_FALLBACK)
  const [confirm, setConfirm] = useState<BrandAsset | null>(null)

  const remove = useMutation({
    mutationFn: (a: BrandAsset) => api.brandKit.removeAsset(a.id),
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: BRAND_KIT_KEY })
      const prev = qc.getQueryData<BrandKitData>(BRAND_KIT_KEY)
      if (prev) qc.setQueryData(BRAND_KIT_KEY, withoutAsset(prev, a.id))
      return { prev }
    },
    onError: (_e, _a, ctx) => {
      if (ctx?.prev) qc.setQueryData(BRAND_KIT_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: BRAND_KIT_KEY })
      qc.invalidateQueries({ queryKey: ["brain"] })
    },
  })

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-bold">{title ?? t("title")}</h2>
      <span className="text-[13px] text-fg-3">{aside ?? t("aside")}</span>
    </div>
  )
  const shell = (body: React.ReactNode) => (
    <section aria-label={typeof title === "string" ? title : t("title")} className={cn("@container flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-card p-4 tablet:p-5", className)}>
      {header}
      {body}
    </section>
  )

  if (kit.isError && !kit.data) {
    return shell(
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("loadFailed")}</AlertTitle>
          <AlertDescription>{errorMessage(kit.error)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={() => kit.refetch()}>
            <Icon name="refresh" />
            {tc("retry")}
          </Button>
        </AlertActions>
      </Alert>
    )
  }
  const jobsOf = (kind: BrandAssetKind) => up.jobs.filter((j) => j.kind === kind)

  // skullet (04/11): logo + files measured from a sample kit (a logo and two files) while the kit loads
  return shell(
    <>
      <Reveal data={kit.data} sample={SAMPLE_BRAND_KIT} id="brand.kit" label={tl("brandKit")}>
        {(k) => {
          const empty = !k.logo && !k.files.length && !k.demoVideos.length
          return (
      <div className="flex min-w-0 flex-col gap-3.5">
      {!canEdit && empty ? <p className="m-0 text-[13px] text-fg-3">{t("emptyClient")}</p> : null}
      {remove.isError ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("removeFailed")}</AlertTitle>
            <AlertDescription>{errorMessage(remove.error)}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
      {!canEdit && empty ? null : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 @[760px]:grid-cols-[200px_minmax(0,1fr)]">
          <LogoBlock logo={k.logo} jobs={jobsOf("LOGO")} canEdit={canEdit} up={up} onRemove={setConfirm} />
          <div className="flex min-w-0 flex-col gap-5">
            <FilesBlock files={k.files} jobs={jobsOf("FILE")} canEdit={canEdit} up={up} onRemove={setConfirm} />
            <VideosBlock videos={k.demoVideos} jobs={jobsOf("DEMO_VIDEO")} canEdit={canEdit} up={up} offers={offers.data?.data ?? []} onRemove={setConfirm} />
          </div>
        </div>
      )}
      </div>
          )
        }}
      </Reveal>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`remove.title.${confirm?.kind ?? "FILE"}`)}</AlertDialogTitle>
            <AlertDialogDescription>{t("remove.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) remove.mutate(confirm)
                setConfirm(null)
              }}
            >
              {t("remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type Up = ReturnType<typeof useBrandUploads>

// ───────────── pieces ─────────────

function BlockTitle({ children, count }: { children: React.ReactNode; count?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="font-mono text-xs font-bold tracking-[0.06em] text-fg-3 uppercase">{children}</h3>
      {count ? <span className="font-mono text-xs text-fg-3">{count}</span> : null}
    </div>
  )
}

/** Hidden native input + drag-and-drop on whatever it wraps. `render` gets `pick` (opens the file dialog) and `over`. */
function DropTarget({ kind, multiple, disabled, onFiles, className, children }: {
  kind: BrandAssetKind; multiple?: boolean; disabled?: boolean; onFiles: (f: File[]) => void; className?: string
  children: (a: { pick: () => void; over: boolean }) => React.ReactNode
}) {
  // callback ref in state: `pick` goes to the render prop, and a ref can't be read during render
  const [input, setInput] = useState<HTMLInputElement | null>(null)
  const [over, setOver] = useState(false)
  const pick = useCallback(() => input?.click(), [input])
  if (disabled) return <div className={className}>{children({ pick: () => {}, over: false })}</div>
  return (
    <div
      className={cn("relative", className)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onFiles(Array.from(e.dataTransfer.files ?? []))
      }}
    >
      <input
        ref={setInput}
        type="file"
        accept={RULES[kind].accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
      {children({ pick, over })}
    </div>
  )
}

function DropArea({ pick, over, title, hint, button }: { pick: () => void; over: boolean; title: string; hint: string; button: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border-[1.5px] border-dashed p-3.5", over ? "border-fg-2 bg-surface-2" : "border-line-2")}>
      <span className="grid min-w-0 flex-1 basis-[220px] gap-0.5">
        <b className="text-[13px] font-semibold">{title}</b>
        <span className="text-xs text-fg-3">{hint}</span>
      </span>
      <Button size="sm" variant="outline" onClick={pick}>
        <Icon name="upload" />
        {button}
      </Button>
    </div>
  )
}

function JobRow({ job, up }: { job: Job; up: Up }) {
  const t = useTranslations("brandKit")
  const message = useBrandError()
  const pct = job.phase === "uploading" ? Math.round((job.loaded / Math.max(1, job.total)) * 100) : 100
  if (job.phase === "error") {
    return (
      <div role="alert" className="flex min-w-0 items-start gap-2.5 rounded-lg border border-status-failed-edge bg-status-failed-bg p-3">
        <Icon name="alert" className="mt-0.5 flex-none text-status-failed" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <b className="truncate text-[13px] font-semibold">{job.file.name}</b>
          <span className="text-[13px] text-fg-2">{message(job.error, job.kind, up.maxBytesOf(job.kind))}</span>
        </span>
        <Button size="icon-sm" variant="ghost" aria-label={t("dismiss")} onClick={() => up.dismiss(job.id)}>
          <Icon name="x" />
        </Button>
      </div>
    )
  }
  return (
    <div role="status" className="grid min-w-0 gap-2 rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon name={job.kind === "DEMO_VIDEO" ? "film" : "upload"} className="flex-none text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{job.file.name}</span>
        <Button size="sm" variant="ghost" onClick={() => up.dismiss(job.id)} disabled={job.phase === "saving"}>
          {t("cancel")}
        </Button>
      </div>
      <Progress value={pct} aria-label={t("uploading")} />
      <span className="font-mono text-xs text-fg-3">
        {job.phase === "uploading"
          ? t("progress", { pct, done: mb(job.loaded), total: mb(job.total) })
          : job.phase === "checking"
            ? t("checking")
            : t("saving")}
      </span>
    </div>
  )
}

/** Label edited in place: saves on blur or Enter (PATCH), Esc goes back. */
function LabelField({ asset, canEdit, placeholder, compact }: { asset: BrandAsset; canEdit: boolean; placeholder: string; compact?: boolean }) {
  const t = useTranslations("brandKit")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [value, setValue] = useState(asset.label ?? "")
  const save = useMutation({
    mutationFn: (label: string | null) => api.brandKit.updateAsset(asset.id, { label }),
    onSuccess: (a) => {
      qc.setQueryData<BrandKitData>(BRAND_KIT_KEY, (k) => (k ? withAsset(k, a) : k))
      setValue(a.label ?? "")
    },
  })
  if (!canEdit) return <span className="truncate text-[13px] font-medium">{asset.label || placeholder}</span>
  const commit = () => {
    const next = value.trim().slice(0, LABEL_MAX)
    if (next === (asset.label ?? "")) return setValue(next)
    save.mutate(next || null)
  }
  return (
    <div className="grid min-w-0 gap-1">
      <Input
        value={value}
        maxLength={LABEL_MAX}
        placeholder={placeholder}
        aria-label={t("label")}
        aria-invalid={save.isError || undefined}
        className={cn("h-10 text-[13px] tablet:h-9", compact && "h-9 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-line focus-visible:border-fg tablet:h-8")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") setValue(asset.label ?? "")
        }}
      />
      {save.isError ? <span className="text-xs text-status-failed">{errorMessage(save.error)}</span> : save.isPending ? <span className="text-xs text-fg-3">{t("saving")}</span> : null}
    </div>
  )
}

function RemoveButton({ onClick, label, compact }: { onClick: () => void; label: string; compact?: boolean }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={label} onClick={onClick} className={cn("flex-none hover:text-status-failed", compact && "size-8 tablet:size-7")}>
      <Icon name="trash" />
    </Button>
  )
}

function LogoBlock({ logo, jobs, canEdit, up, onRemove }: { logo: BrandAsset | null; jobs: Job[]; canEdit: boolean; up: Up; onRemove: (a: BrandAsset) => void }) {
  const t = useTranslations("brandKit")
  const running = jobs.find((j) => j.phase !== "error")
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <BlockTitle>{t("logo.title")}</BlockTitle>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @min-[420px]:grid-cols-[150px_minmax(0,1fr)] @[760px]:grid-cols-[minmax(0,1fr)]">
      <DropTarget kind="LOGO" disabled={!canEdit} onFiles={(f) => up.add("LOGO", f)} className="flex flex-col gap-2.5">
        {({ pick, over }) => (
          <>
            <div
              className={cn(
                "relative grid aspect-square w-full max-w-[200px] place-items-center overflow-hidden rounded-lg border bg-card-2",
                logo ? "border-line" : "border-[1.5px] border-dashed",
                over ? "border-fg-2 bg-surface-2" : logo ? "" : "border-line-2"
              )}
            >
              {logo ? (
                // SVG only through <img> (kit-marca-v1 §2): the signed URL is another origin
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo.file.url} alt={t("logo.alt")} className="max-h-[78%] max-w-[78%] object-contain" />
              ) : canEdit ? (
                <button type="button" onClick={pick} className="grid size-full place-items-center content-center gap-2 p-4 text-center focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="grid size-9 place-items-center rounded-full border border-line-2 text-fg-2">
                    <Icon name="upload" />
                  </span>
                  <b className="text-[13px] font-semibold">{t("logo.drop")}</b>
                  <span className="text-xs text-fg-3">{t("logo.hint")}</span>
                </button>
              ) : (
                <span className="p-4 text-center text-xs text-fg-3">{t("logo.none")}</span>
              )}
              {running ? (
                <span className="absolute inset-x-3 bottom-3 grid gap-1.5 rounded-md bg-card/95 p-2 shadow-sm">
                  <Progress value={running.phase === "uploading" ? Math.round((running.loaded / Math.max(1, running.total)) * 100) : 100} aria-label={t("uploading")} />
                  <span className="font-mono text-[11px] text-fg-3">{running.phase === "uploading" ? t("uploading") : running.phase === "checking" ? t("checking") : t("saving")}</span>
                </span>
              ) : null}
            </div>
            {logo && canEdit ? (
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={pick} disabled={!!running}>
                  {t("logo.replace")}
                </Button>
                <Button size="sm" variant="ghost" className="hover:text-status-failed" onClick={() => onRemove(logo)}>
                  {t("remove.action")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </DropTarget>
      {logo ? (
        <div className="grid content-start gap-1.5">
          <span className="text-xs font-semibold text-fg-2">{t("logo.colors")}</span>
          {logo.colors.length ? (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {logo.colors.map((c) => (
                <li key={c} className="flex items-center gap-1.5 rounded-full border border-line bg-card py-1 pr-2.5 pl-1">
                  <span className="size-4 rounded-full border border-line" style={{ background: c }} aria-hidden="true" />
                  <span className="font-mono text-[11px] uppercase">{c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-fg-3">{t("logo.noColors")}</span>
          )}
        </div>
      ) : null}
      </div>
      {jobs.filter((j) => j.phase === "error").map((j) => (
        <JobRow key={j.id} job={j} up={up} />
      ))}
    </div>
  )
}

function FilesBlock({ files, jobs, canEdit, up, onRemove }: { files: BrandAsset[]; jobs: Job[]; canEdit: boolean; up: Up; onRemove: (a: BrandAsset) => void }) {
  const t = useTranslations("brandKit")
  const max = RULES.FILE.max
  const full = files.length + jobs.filter((j) => j.phase !== "error").length >= max
  return (
    <DropTarget kind="FILE" multiple disabled={!canEdit} onFiles={(f) => up.add("FILE", f)} className="flex min-w-0 flex-col gap-2.5">
      {({ pick, over }) => (
        <>
          <BlockTitle count={canEdit && files.length ? t("count", { n: files.length, max }) : undefined}>{t("files.title")}</BlockTitle>
          {files.length ? (
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2 p-0">
              {files.map((f) => (
                <li key={f.id} className="group relative flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-card p-1.5">
                  <a href={f.file.url} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] overflow-hidden rounded-md border border-line bg-card-2" aria-label={t("files.open", { name: f.label || t("files.untitled") })}>
                    {isPdf(f) ? (
                      <span className="grid size-full place-items-center content-center gap-1 text-fg-3">
                        <span className="rounded-sm border border-line-strong bg-card px-2 py-1 font-mono text-[11px] font-semibold">PDF</span>
                        <Icon name="ext" />
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.file.url} alt="" loading="lazy" className="size-full object-cover" />
                    )}
                  </a>
                  {canEdit ? (
                    <span className="absolute top-2.5 right-2.5 rounded-md bg-card/90 shadow-sm">
                      <RemoveButton compact label={t("remove.file")} onClick={() => onRemove(f)} />
                    </span>
                  ) : null}
                  <LabelField compact asset={f} canEdit={canEdit} placeholder={t("files.untitled")} />
                </li>
              ))}
            </ul>
          ) : !canEdit ? (
            <p className="m-0 text-[13px] text-fg-3">{t("files.none")}</p>
          ) : null}
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} up={up} />
          ))}
          {canEdit ? (
            full ? (
              <p className="m-0 text-xs text-fg-3">{t("errors.fullFiles", { max })}</p>
            ) : (
              <DropArea pick={pick} over={over} title={files.length ? t("files.dropMore") : t("files.empty")} hint={t("files.hint", { types: RULES.FILE.types })} button={t("choose")} />
            )
          ) : null}
        </>
      )}
    </DropTarget>
  )
}

const ALL = "__brand"

function VideosBlock({ videos, jobs, canEdit, up, offers, onRemove }: {
  videos: BrandAsset[]; jobs: Job[]; canEdit: boolean; up: Up; offers: Offer[]; onRemove: (a: BrandAsset) => void
}) {
  const t = useTranslations("brandKit")
  const max = RULES.DEMO_VIDEO.max
  const full = videos.length + jobs.filter((j) => j.phase !== "error").length >= max
  return (
    <DropTarget kind="DEMO_VIDEO" multiple disabled={!canEdit} onFiles={(f) => up.add("DEMO_VIDEO", f)} className="flex min-w-0 flex-col gap-2.5">
      {({ pick, over }) => (
        <>
          <BlockTitle count={canEdit && videos.length ? t("count", { n: videos.length, max }) : undefined}>{t("videos.title")}</BlockTitle>
          {videos.length ? (
            <ul className="m-0 grid list-none gap-2.5 p-0">
              {videos.map((v) => (
                <VideoRow key={v.id} video={v} canEdit={canEdit} offers={offers} onRemove={() => onRemove(v)} />
              ))}
            </ul>
          ) : !canEdit ? (
            <p className="m-0 text-[13px] text-fg-3">{t("videos.none")}</p>
          ) : null}
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} up={up} />
          ))}
          {canEdit ? (
            full ? (
              <p className="m-0 text-xs text-fg-3">{t("errors.fullVideos", { max })}</p>
            ) : (
              <DropArea
                pick={pick}
                over={over}
                title={videos.length ? t("videos.dropMore") : t("videos.empty")}
                hint={t("videos.hint", { mb: Math.round(up.maxBytesOf("DEMO_VIDEO") / MB) })}
                button={t("choose")}
              />
            )
          ) : null}
        </>
      )}
    </DropTarget>
  )
}

function VideoRow({ video, canEdit, offers, onRemove }: { video: BrandAsset; canEdit: boolean; offers: Offer[]; onRemove: () => void }) {
  const t = useTranslations("brandKit")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const setOffer = useMutation({
    mutationFn: (offerId: string | null) => api.brandKit.updateAsset(video.id, { offerId }),
    onSuccess: (a) => qc.setQueryData<BrandKitData>(BRAND_KIT_KEY, (k) => (k ? withAsset(k, a) : k)),
  })
  const f = video.file
  const portrait = (f.height ?? 16) > (f.width ?? 9)
  const offerName = offers.find((o) => o.id === video.offerId)?.name
  const meta = [f.durationSec ? mmss(f.durationSec) : null, f.width && f.height ? `${f.width}×${f.height}` : null].filter(Boolean).join(" · ")
  return (
    <li className="flex min-w-0 gap-3 rounded-lg border border-line bg-card p-2.5">
      <video
        src={f.url}
        controls
        playsInline
        preload="metadata"
        aria-label={video.label || t("videos.untitled")}
        className={cn("flex-none rounded-md border border-line bg-stage object-contain", portrait ? "aspect-[9/16] w-[88px] tablet:w-[104px]" : "aspect-video w-[132px] tablet:w-[176px]")}
      />
      <div className="grid min-w-0 flex-1 content-start gap-2">
        <div className="flex min-w-0 items-start gap-1">
          <div className="min-w-0 flex-1">
            <LabelField asset={video} canEdit={canEdit} placeholder={t("videos.untitled")} />
          </div>
          {canEdit ? <RemoveButton label={t("remove.video")} onClick={onRemove} /> : null}
        </div>
        {canEdit ? (
          <div className="grid min-w-0 gap-1">
            <Select value={video.offerId ?? ALL} onValueChange={(v) => setOffer.mutate(v === ALL ? null : v)} disabled={setOffer.isPending}>
              <SelectTrigger aria-label={t("videos.offer")} className="h-10 min-w-0 text-[13px] tablet:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("videos.allOffers")}</SelectItem>
                {offers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {setOffer.isError ? <span className="text-xs text-status-failed">{errorMessage(setOffer.error)}</span> : null}
          </div>
        ) : (
          <span className="text-xs text-fg-2">{offerName ?? t("videos.allOffers")}</span>
        )}
        {meta ? <span className="font-mono text-xs text-fg-3">{meta}</span> : null}
      </div>
    </li>
  )
}
