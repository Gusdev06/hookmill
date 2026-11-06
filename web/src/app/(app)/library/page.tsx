"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api, type ApiResult } from "@/lib/api/client"
import type { ChampionRow, LibraryItem as LibraryItem, LibraryMeta, PieceEditorView } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { EmptyState, Page, PageHead } from "@/components/page"
import { Thumb } from "@/components/thumb"
import { VideoPlayer } from "@/components/video-player"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { VariationLine } from "@/components/variar/variation-line"
import { EditedBadge } from "@/components/editor/entry"
import { DownloadEditFooter } from "@/components/editor/universal/entry"
import { ik } from "@/hooks/use-iterate"
import { iterateHref, templatesHref } from "@/lib/routes"
import { isMetaOff, useMetaConnection } from "@/hooks/use-meta"
import { useSession } from "@/components/providers/session-provider"
import { TourTip } from "@/components/tour/tip"
import { Reveal } from "@/components/ui/reveal"
import { SAMPLE_LIBRARY } from "@/lib/skeleton-samples"
import { saveFile } from "@/lib/save-file"

const ALL = "all"
const GRID = "grid grid-cols-2 gap-3 tablet:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] tablet:gap-4"
const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`

export default function LibraryPage() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  )
}

/**
 * What the card's Edit shows. The Library item has no `editor` view: an AUTO piece opens, except a HEADLINE `replace` (§15.3.1), and
 * only the plan knows its mode, so a HEADLINE asks its batch (one GET per batch, cached). Off while that answers; if it fails, the
 * link stays on and the editor's gate explains.
 */
function useLibraryEditor(item: LibraryItem): PieceEditorView {
  const v = item.variation
  const auto = v?.kind === "AUTO_EDIT"
  const batchId = auto && v.code?.startsWith("HEADLINE-") ? v.batchId : null
  const batch = useQuery({ queryKey: ik.batch(batchId ?? ""), queryFn: ({ signal }) => api.iterate.get(batchId!, { signal }), enabled: !!batchId, staleTime: 60_000 })
  const view = { edited: item.editedInEditor, pendingExport: false, export: null }
  if (!auto) return { ...view, available: false, reason: "auto_type_not_editable" }
  if (!batchId || batch.isError) return { ...view, available: true, reason: null }
  if (batch.isPending) return { ...view, available: false, reason: null }
  const piece = batch.data.pieces.find((p) => p.creativeId === item.id)
  return { ...view, available: piece?.editor?.available ?? true, reason: piece?.editor?.reason ?? null }
}

function Library() {
  const t = useTranslations()
  const { session } = useSession()
  const readOnly = session.workspace.role === "CLIENT"
  const errorMessage = useErrorMessage()
  const newId = useSearchParams().get("new")
  const [offerId, setOfferId] = useState<string>(ALL)
  const [winners, setWinners] = useState(false)
  // feature 2: Originals / Variations. The API filters by championId/variationKind, not by origin, so this one is on the loaded page.
  const [origin, setOrigin] = useState<"all" | "original" | "variation">("all")
  const key = ["library", { offerId, winners }] as const

  const lib = useQuery({
    queryKey: key,
    queryFn: () => api.library.list({ offerId: offerId === ALL ? undefined : offerId, winners }),
    placeholderData: keepPreviousData,
  })
  // 04/11 (Gusta): the videos you uploaded (and the Meta ads you read) are champions, not creatives: list them in Originals
  const champs = useQuery({
    queryKey: ["champions", "library", { offerId }],
    queryFn: () => api.champions.list({ offerId: offerId === ALL ? undefined : offerId, limit: 60 }),
    placeholderData: keepPreviousData,
  })

  const head = <PageHead title={t("library.title")} sub={t("library.subtitle")} />

  if (lib.isError && !lib.data) {
    return (
      <Page>
        {head}
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("library.errorTitle")}</AlertTitle>
            <AlertDescription>{errorMessage(lib.error)}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => lib.refetch()}>
              <Icon name="refresh" />
              {t("common.retry")}
            </Button>
          </AlertActions>
        </Alert>
      </Page>
    )
  }

  // 04/11 (Gusta): an ad that couldn't be read (FAILED) doesn't belong in the Library
  const uploaded = !winners && origin !== "variation" ? (champs.data?.data ?? []).filter((c) => c.status !== "FAILED") : []
  const hasItems = (lib.data?.data ?? []).some((i) => origin === "all" || (origin === "variation") === !!i.variation)

  // skullet (04/11): while the first page loads, the same body is measured from a sample (toolbar + cards)
  return (
    <Page>
      {head}
      <Reveal data={lib.data} sample={SAMPLE_LIBRARY} id="library" label={t("skeleton.library")}>
        {(data) => {
  const all = data.data
  const items = all.filter((i) => origin === "all" || (origin === "variation") === !!i.variation)
  const offers = data.meta.offers
  const sampling = data === SAMPLE_LIBRARY

  if (!offers.length && !all.length && !uploaded.length) {
    return (
        <EmptyState>
          <h2>{t("library.emptyTitle")}</h2>
          <p className="text-fg-2">{t("library.emptyBody")}</p>
          {!readOnly ? <div>
            <Link href="/creatives/new" className={buttonVariants({ variant: "default" })}>
              <Icon name="plus" />
              {t("common.newCreative")}
            </Link>
          </div> : null}
        </EmptyState>
    )
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-[22px] tablet:gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" value={origin} onValueChange={(v) => v && setOrigin(v as typeof origin)} aria-label={t("variar.lib.all")}>
          <ToggleGroupItem value="all">{t("variar.lib.all")}</ToggleGroupItem>
          <ToggleGroupItem value="original">{t("variar.lib.originals")}</ToggleGroupItem>
          <ToggleGroupItem value="variation">{t("variar.lib.variations")}</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={offerId} onValueChange={(v) => v && setOfferId(v)} aria-label={t("library.allOffers")} className="max-tablet:flex-wrap max-tablet:overflow-visible">
          <ToggleGroupItem value={ALL}>{t("library.allOffers")}</ToggleGroupItem>
          {offers.map((o) => (
            <ToggleGroupItem key={o.id} value={o.id}>
              {o.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-2">
          <Label htmlFor="winonly">{t("library.winnersOnly")}</Label>
          <Switch id="winonly" checked={winners} onCheckedChange={setWinners} />
        </div>
      </div>
      {uploaded.length ? (
        <section className="grid gap-3" aria-label={t("library.uploadedTitle")}>
          <div className="grid gap-0.5">
            <h2 className="text-base font-bold">{t("library.uploadedTitle")}</h2>
            <p className="m-0 text-[13px] text-fg-3">{t("library.uploadedSub")}</p>
          </div>
          <div className={GRID} aria-busy={champs.isFetching}>
            {uploaded.map((c) => (
              <ChampionCard key={c.id} champ={c} readOnly={readOnly} />
            ))}
          </div>
        </section>
      ) : null}
      {items.length ? (
        <>
          {uploaded.length ? <h2 className="text-base font-bold">{t("library.creativesTitle")}</h2> : null}
          <div id={sampling ? undefined : "t-library"} className={GRID} aria-busy={lib.isFetching}>
            {items.map((i) => (
              <LibraryCard key={i.id} item={i} isNew={i.id === newId} queryKey={key} readOnly={readOnly} />
            ))}
          </div>
        </>
      ) : uploaded.length ? null : (
        <p className="text-fg-2">{winners ? t("library.noWinners") : t("library.noneInFilter")}</p>
      )}
    </div>
  )
        }}
      </Reveal>
      {/* tour-v2, 5th tip (Gusta 04/11): the first time an approved piece is in the Library (real data only, never the skeleton) */}
      <TourTip tip="library" when={!readOnly && hasItems} variant="default" target="#t-library" title={t("tip.library.title")} body={t("tip.library.body")} />
    </Page>
  )
}

/** An uploaded / read ad (champion): thumbnail, where it came from, status, and "Use in a template" when it's read. */
function ChampionCard({ champ, readOnly }: { champ: ChampionRow; readOnly: boolean }) {
  const t = useTranslations("library")
  const ready = champ.status === "READY"
  const source = champ.sources.includes("META") ? t("srcMeta") : champ.sources.includes("AD_LIBRARY") ? t("srcAdLibrary") : t("srcUpload")
  const status = ready ? null : champ.status === "FAILED" ? t("stFailed") : t("stReading")
  return (
    <article className="grid content-start gap-2">
      <Thumb file={champ.thumbnail} play={ready} />
      <div className="grid min-w-0 gap-0.5">
        <b className="truncate text-[13px] font-semibold" title={champ.name}>{champ.name}</b>
        <span className="truncate text-xs text-fg-3">
          {[source, champ.durationSec ? duration(champ.durationSec) : null, champ.offer.name].filter(Boolean).join(" · ")}
        </span>
        {status ? <span className={cn("text-xs font-semibold", champ.status === "FAILED" ? "text-status-failed" : "text-status-waiting")}>{status}</span> : null}
      </div>
      {!readOnly ? <span className="flex flex-wrap items-center gap-1.5">
        {ready ? (
          <Link href={templatesHref({ championId: champ.id })} className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("useInTemplate")}
          </Link>
        ) : null}
        <DeleteButton kind="champion" id={champ.id} name={champ.name} />
      </span> : null}
    </article>
  )
}

function LibraryCard({ item, isNew, queryKey, readOnly }: { item: LibraryItem; isNew: boolean; queryKey: readonly unknown[]; readOnly: boolean }) {
  const t = useTranslations("library")
  const tv = useTranslations("variar")
  const format = useFormatter()
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()

  // optimistic toggle; the filtered lists refetch afterwards
  const winner = useMutation({
    mutationFn: (isWinner: boolean) => api.library.setWinner(item.id, isWinner),
    onMutate: async (isWinner) => {
      await qc.cancelQueries({ queryKey })
      const prev = qc.getQueryData<ApiResult<LibraryItem[], LibraryMeta>>(queryKey)
      qc.setQueryData<ApiResult<LibraryItem[], LibraryMeta>>(queryKey, (d) =>
        d ? { ...d, data: d.data.map((x) => (x.id === item.id ? { ...x, isWinner } : x)) } : d
      )
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev)
      toast(errorMessage(e))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["library"] }),
  })

  const editor = useLibraryEditor(item)
  // `video.url` only plays (no attachment; another origin ignores the `download` attribute): ask for the signed download, in a format that's ready
  const download = useMutation({
    mutationFn: () => api.creatives.download(item.id, item.formats?.[0]?.format),
    onSuccess: (d) => saveFile(d.url, d.fileName),
    onError: (e) => toast(errorMessage(e)),
  })

  // variacao-auto-v1: "Vary" on every video card opens the single screen already analyzing (POST /iterate { creativeId })
  const router = useRouter()
  const ti = useTranslations("iterate.lib")
  const image = item.media === "image"
  // meta-v1 §3.3: Send → "Publish to Meta" (hidden when the server has no Meta)
  const metaConn = useMetaConnection()
  const metaOff = metaConn.isError && isMetaOff(metaConn.error)
  const vary = useMutation({
    mutationFn: () => api.iterate.create({ creativeId: item.id }),
    onSuccess: (b) => {
      qc.setQueryData(ik.batch(b.id), b)
      router.push(iterateHref(b.id))
    },
    onError: (e) => toast(errorMessage(e)),
  })

  return (
    // QA layout 29/10 #10 + 3rd round: a column that fills the row; the actions sit at the card's foot (mt-auto), so a
    // 2-line name doesn't push one card's buttons below its siblings'
    <div className="flex min-w-0 flex-col gap-2">
      <Dialog>
      <DialogTrigger asChild>
      <button type="button" aria-label={item.name} className="block w-full cursor-pointer rounded-lg text-left focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2">
      <Thumb file={item.thumbnail} play={!image} className={cn("rounded-lg", isNew && "shadow-[0_0_0_2px_var(--green)]")}>
        {item.isWinner ? (
          <span className="absolute top-2 left-2 rounded-[4px] bg-status-waiting-bg px-1.5 py-px text-[11px] font-semibold text-status-waiting">{t("winner")}</span>
        ) : null}
        {item.variation ? (
          <span className="on-ink absolute bottom-2 left-2 rounded-[4px] border border-line-2 bg-black/75 px-1.5 py-px text-[11px] font-medium text-fg">{tv("badge")}</span>
        ) : null}
        {image ? (
          <span className="absolute top-2 right-2 rounded-[4px] bg-black/75 px-1.5 py-px font-mono text-[10px] font-semibold text-white">{ti("image")}</span>
        ) : null}
        {isNew ? (
          <span className="absolute top-2 right-2 rounded-[4px] bg-status-approved-bg px-1.5 py-px text-[11px] font-semibold text-status-approved">{t("new")}</span>
        ) : null}
      </Thumb>
      </button>
      </DialogTrigger>
      <DialogContent className="w-[min(calc(100vw-32px),calc(78vh*3/4+24px))] max-w-none border-line bg-surface p-3 sm:max-w-none">
        <DialogTitle className="sr-only">{item.name}</DialogTitle>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- STATIC piece: `video` carries the PNG (variacao-auto-v1 §4)
          <img src={item.video.url} alt={item.name} className="mx-auto block max-h-[78vh] w-auto max-w-full rounded-[10px]" />
        ) : (
          <VideoPlayer video={item.video} poster={item.thumbnail?.url ?? null} />
        )}
      </DialogContent>
      </Dialog>
      <div className="flex flex-1 items-start justify-between gap-2">
        <div className="flex h-full min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 font-medium [overflow-wrap:anywhere]">{item.name}</span>
          <span className="row-sub">
            {item.offer.name} · {item.engineLabel}{image ? null : <> · <span className="num">{duration(item.durationSec)}</span></>}
          </span>
          <span className="row-sub">{format.dateTime(new Date(item.approvedAt), { month: "short", day: "numeric" })}</span>
          {item.variation ? <VariationLine v={item.variation} /> : null}
          {item.editedInEditor ? <span><EditedBadge variation={!!item.variation} /></span> : null}
          {image || readOnly ? null : (
            <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
              <Button size="sm" disabled={vary.isPending} onClick={() => vary.mutate()}>
                {vary.isPending ? <span className="spin-ring size-3.5" aria-hidden="true" /> : <Icon name="branch" />}
                {vary.isPending ? ti("starting") : ti("vary")}
              </Button>
              {metaOff ? null : (
                <Link href={`/creatives/${encodeURIComponent(item.id)}/send`} className={buttonVariants({ size: "sm" })}>
                  <Icon name="upload" />
                  {t("sendMeta")}
                </Link>
              )}
            </span>
          )}
        </div>
        {!readOnly ? <button
          type="button"
          aria-pressed={item.isWinner}
          aria-label={item.isWinner ? t("unmarkWinner") : t("markWinner")}
          title={item.isWinner ? t("unmarkWinner") : t("markWinner")}
          onClick={() => winner.mutate(!item.isWinner)}
          className="grid min-h-10 min-w-10 flex-none place-items-center rounded-sm border border-line p-1 text-fg-3 tablet:min-h-0 tablet:min-w-0 aria-pressed:border-transparent aria-pressed:bg-status-waiting-bg aria-pressed:text-status-waiting aria-pressed:[&_svg]:fill-current"
        >
          <Icon name="star" />
        </button> : null}
      </div>
      {/* editor-universal-v1 §2 + rule of 04/11: "Download | Edit" in two equal columns at the card's foot. The Library item
          has no editor view: an AUTO piece (variation AUTO_EDIT, video) opens; the GET answers if its type doesn't yet */}
      {image ? null : (
        <DownloadEditFooter
          from="library"
          file={{ url: item.video.url, name: `${item.adName ?? item.name}.mp4` }}
          onDownload={() => download.mutate()}
          downloading={download.isPending}
          creativeId={item.id}
          editor={editor}
        />
      )}
      {!readOnly ? <span className="flex justify-end">
        <DeleteButton kind="creative" id={item.id} name={item.name} />
      </span> : null}
    </div>
  )
}

/**
 * 04/11 (Gusta): delete a video from the Library. The API archives (DELETE /champions/:id, DELETE /creatives/:id):
 * it leaves every list; variations already made from an uploaded ad stay. A creative can't go while it renders (409).
 */
function DeleteButton({ kind, id, name }: { kind: "champion" | "creative"; id: string; name: string }) {
  const t = useTranslations("library.delete")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () => (kind === "champion" ? api.champions.remove(id) : api.creatives.remove(id)),
    onSuccess: () => {
      toast(t("done", { name }))
      void qc.invalidateQueries({ queryKey: ["library"] })
      void qc.invalidateQueries({ queryKey: ["champions"] })
      void qc.invalidateQueries({ queryKey: ["brain"] })
    },
    onError: (e) => toast(errorMessage(e)),
  })
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-fg-3 hover:text-status-failed" disabled={del.isPending} aria-busy={del.isPending} aria-label={t("action", { name })} title={t("action", { name })}>
          {del.isPending ? <span className="spin-ring size-3.5" aria-hidden="true" /> : <Icon name="trash" />}
          {t("label")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{kind === "champion" ? t("bodyChampion") : t("bodyCreative")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => del.mutate()}>{t("confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
