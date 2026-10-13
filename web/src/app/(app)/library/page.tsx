"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api, type ApiResult } from "@/lib/api/client"
import type { LibraryItemV as LibraryItem, LibraryMeta } from "@/lib/api/types"
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
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { VariationLine } from "@/components/variar/variation-line"
import { EditedBadge } from "@/components/editor/entry"
import { ik } from "@/hooks/use-iterate"
import { iterateHref } from "@/lib/routes"

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

function Library() {
  const t = useTranslations()
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

  const head = <PageHead title={t("library.title")} sub={t("library.subtitle")} />

  if (lib.isPending) {
    return (
      <Page>
        {head}
        <div className={GRID} role="status" aria-label={t("common.loading")}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="grid gap-2">
              <span className="sk aspect-[9/16] rounded-lg" />
              <span className="sk h-3 w-3/4" />
              <span className="sk h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      </Page>
    )
  }

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

  const all = lib.data?.data ?? []
  const items = all.filter((i) => origin === "all" || (origin === "variation") === !!i.variation)
  const offers = lib.data?.meta.offers ?? []

  if (!offers.length && !all.length) {
    return (
      <Page>
        {head}
        <EmptyState>
          <h2>{t("library.emptyTitle")}</h2>
          <p className="text-fg-2">{t("library.emptyBody")}</p>
          <div>
            <Link href="/creatives/new" className={buttonVariants({ variant: "default" })}>
              <Icon name="plus" />
              {t("common.newCreative")}
            </Link>
          </div>
        </EmptyState>
      </Page>
    )
  }

  return (
    <Page>
      {head}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" value={origin} onValueChange={(v) => v && setOrigin(v as typeof origin)} aria-label={t("variar.lib.all")}>
          <ToggleGroupItem value="all">{t("variar.lib.all")}</ToggleGroupItem>
          <ToggleGroupItem value="original">{t("variar.lib.originals")}</ToggleGroupItem>
          <ToggleGroupItem value="variation">{t("variar.lib.variations")}</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={offerId} onValueChange={(v) => v && setOfferId(v)} aria-label={t("library.allOffers")}>
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
      {items.length ? (
        <div className={GRID} aria-busy={lib.isFetching}>
          {items.map((i) => (
            <LibraryCard key={i.id} item={i} isNew={i.id === newId} queryKey={key} />
          ))}
        </div>
      ) : (
        <p className="text-fg-2">{t("library.noWinners")}</p>
      )}
    </Page>
  )
}

function LibraryCard({ item, isNew, queryKey }: { item: LibraryItem; isNew: boolean; queryKey: readonly unknown[] }) {
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

  // variacao-auto-v1: "Vary" on every video card opens the single screen already analyzing (POST /iterate { creativeId })
  const router = useRouter()
  const ti = useTranslations("iterate.lib")
  const image = item.media === "image"
  const vary = useMutation({
    mutationFn: () => api.iterate.create({ creativeId: item.id }),
    onSuccess: (b) => {
      qc.setQueryData(ik.batch(b.id), b)
      router.push(iterateHref(b.id))
    },
    onError: (e) => toast(errorMessage(e)),
  })

  return (
    <div className="grid min-w-0 gap-2">
      <Dialog>
      <DialogTrigger asChild>
      <button type="button" aria-label={item.name} className="block w-full cursor-pointer rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2">
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
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate font-medium">{item.name}</span>
          <span className="row-sub">
            {item.offer.name} · {item.engineLabel}{image ? null : <> · <span className="num">{duration(item.durationSec)}</span></>}
          </span>
          <span className="row-sub">{format.dateTime(new Date(item.approvedAt), { month: "short", day: "numeric" })}</span>
          {item.variation ? <VariationLine v={item.variation} /> : null}
          {item.editedInEditor ? <span><EditedBadge variation={!!item.variation} /></span> : null}
          {image ? null : (
            <span className="pt-1">
              <Button size="sm" disabled={vary.isPending} onClick={() => vary.mutate()}>
                {vary.isPending ? <span className="spin-ring size-3.5" aria-hidden="true" /> : <Icon name="branch" />}
                {vary.isPending ? ti("starting") : ti("vary")}
              </Button>
            </span>
          )}
        </div>
        <button
          type="button"
          aria-pressed={item.isWinner}
          aria-label={item.isWinner ? t("unmarkWinner") : t("markWinner")}
          title={item.isWinner ? t("unmarkWinner") : t("markWinner")}
          onClick={() => winner.mutate(!item.isWinner)}
          className="grid flex-none place-items-center rounded-sm border border-line p-1 text-fg-3 aria-pressed:border-transparent aria-pressed:bg-status-waiting-bg aria-pressed:text-status-waiting aria-pressed:[&_svg]:fill-current"
        >
          <Icon name="star" />
        </button>
      </div>
    </div>
  )
}
