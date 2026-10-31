"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { MetaTemplateImportResult } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"

type Level = "campaign" | "adset" | "ad"
export interface ImportPicked { level: Level; id: string; name: string; result: MetaTemplateImportResult }

/*
 * "Import from a campaign" (meta-templates-v1 §3): campaign → ad set → ad from GET /meta/campaigns and /meta/campaigns/:id
 * (the snapshot of campanhas-v1). Any level can be the source; POST /meta/templates/import maps it WITHOUT saving and the
 * caller opens the template window prefilled.
 */
export function ImportPicker({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked: (p: ImportPicked) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100%-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        {open ? <Picker onPicked={onPicked} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function Picker({ onPicked }: { onPicked: (p: ImportPicked) => void }) {
  const t = useTranslations("metaTemplates.import")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const [q, setQ] = useState("")
  const [campaign, setCampaign] = useState<{ id: string; name: string } | null>(null)
  const [adsetId, setAdsetId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ["meta", "templates", "import", "campaigns", q.trim()],
    queryFn: ({ signal }) => api.meta.campaigns({ q: q.trim() || undefined, limit: 50, sort: "spend", dir: "desc" }, { signal }),
    enabled: !campaign,
    staleTime: 60_000,
  })
  const detail = useQuery({
    queryKey: ["meta", "templates", "import", "campaign", campaign?.id],
    queryFn: ({ signal }) => api.meta.campaign(campaign!.id, {}, { signal }),
    enabled: !!campaign,
    staleTime: 60_000,
  })
  const imp = useMutation({
    mutationFn: (x: { level: Level; id: string; name: string }) => api.meta.templates.import({ level: x.level, id: x.id }).then((result) => ({ ...x, result })),
    onSuccess: onPicked,
  })
  const adset = detail.data?.adsets.find((a) => a.id === adsetId) ?? null

  const crumb = (
    <div className="flex flex-wrap items-center gap-1 text-[13px] text-fg-2">
      <button type="button" className={cn("rounded px-1 hover:text-fg", !campaign && "font-semibold text-fg")} onClick={() => { setCampaign(null); setAdsetId(null) }}>{t("campaigns")}</button>
      {campaign ? (
        <>
          <Icon name="chev" className="text-fg-3" />
          <button type="button" className={cn("max-w-[200px] truncate rounded px-1 hover:text-fg", !adsetId && "font-semibold text-fg")} onClick={() => setAdsetId(null)}>{campaign.name}</button>
        </>
      ) : null}
      {adset ? (
        <>
          <Icon name="chev" className="text-fg-3" />
          <span className="max-w-[200px] truncate px-1 font-semibold text-fg">{adset.name}</span>
        </>
      ) : null}
    </div>
  )

  const row = (key: string, name: string, sub: string, onOpen: (() => void) | null, use: () => void) => (
    <li key={key} className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
      <button type="button" disabled={!onOpen} onClick={onOpen ?? undefined} className="grid min-w-0 flex-1 gap-px rounded-md px-1 py-1 text-left enabled:hover:bg-card-2">
        <span className="truncate font-semibold">{name}</span>
        <span className="truncate text-xs text-fg-3">{sub}</span>
      </button>
      <Button size="sm" onClick={use} disabled={imp.isPending}>
        {imp.isPending && imp.variables?.id === key ? <span className="spin-ring size-3.5 border-current" aria-hidden="true" /> : null}
        {t("use")}
      </Button>
      {onOpen ? (
        <Button size="sm" variant="ghost" onClick={onOpen} aria-label={t("open", { name })}>
          <Icon name="chev" />
        </Button>
      ) : null}
    </li>
  )

  const failed = list.error ?? detail.error
  let body: React.ReactNode
  if (failed) {
    body = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("loadFailed")}</AlertTitle>
          <AlertDescription>{errorMessage(failed)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={() => (campaign ? detail.refetch() : list.refetch())}>{tc("retry")}</Button>
        </AlertActions>
      </Alert>
    )
  } else if ((!campaign && list.isPending) || (campaign && detail.isPending)) {
    body = (
      <div className="grid gap-2" role="status" aria-label={tc("loading")}>
        {Array.from({ length: 4 }, (_, i) => <span key={i} className="sk h-11" />)}
      </div>
    )
  } else if (!campaign) {
    const rows = list.data?.data ?? []
    body = rows.length ? (
      <ul className="m-0 list-none p-0">
        {rows.map((c) => row(c.id, c.name, t("campaignSub", { adsets: c.counts.adsets, ads: c.counts.ads, mode: c.isCbo ? "CBO" : "ABO" }), () => setCampaign({ id: c.id, name: c.name }), () => imp.mutate({ level: "campaign", id: c.id, name: c.name })))}
      </ul>
    ) : (
      <p className="m-0 py-6 text-center text-fg-3">{q.trim() ? t("noMatch") : t("empty")}</p>
    )
  } else if (!adset) {
    const sets = detail.data?.adsets ?? []
    body = sets.length ? (
      <ul className="m-0 list-none p-0">
        {sets.map((a) => row(a.id, a.name, t("adsetSub", { ads: a.counts.ads }), a.ads.length ? () => setAdsetId(a.id) : null, () => imp.mutate({ level: "adset", id: a.id, name: a.name })))}
      </ul>
    ) : (
      <p className="m-0 py-6 text-center text-fg-3">{t("noAdsets")}</p>
    )
  } else {
    body = (
      <ul className="m-0 list-none p-0">
        {adset.ads.map((ad) => row(ad.metaAdId, ad.name, ad.effectiveStatus, null, () => imp.mutate({ level: "ad", id: ad.metaAdId, name: ad.name })))}
      </ul>
    )
  }

  return (
    <>
      <div className="grid gap-2 border-b border-line px-4 py-3.5 tablet:px-5">
        <DialogTitle className="pr-8 text-base font-bold">{t("title")}</DialogTitle>
        <DialogDescription className="text-[13px] text-fg-2">{t("lead")}</DialogDescription>
        {crumb}
        {!campaign ? <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} /> : null}
      </div>
      <div className="grid min-h-0 content-start gap-3 overflow-y-auto px-4 py-3 tablet:px-5">
        {imp.isError ? (
          <Alert variant="destructive">
            <Icon name="alert" />
            <AlertBody>
              <AlertTitle>{errorMessage(imp.error)}</AlertTitle>
            </AlertBody>
          </Alert>
        ) : null}
        {body}
      </div>
    </>
  )
}
