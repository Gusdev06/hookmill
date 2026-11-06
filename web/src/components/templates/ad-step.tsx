"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { CreditsSummary, MetaAdRow, MetaOfferFit, TemplateCard, TemplateFit, TemplateSourceRef } from "@/lib/api/types"
import { useActiveOffer } from "@/lib/active-offer"
import { pickedFromParams, templateAdHref, templateSelectionHref, templatesHref, RADAR_HREF } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { Reveal } from "@/components/ui/reveal"
import { BLANK_IMG } from "@/lib/skeleton-samples"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { FlowBar } from "@/components/flow-bar"
import { MetaLockCard, metaGateOf } from "@/components/meta/meta-gate"
import { OfferFitMenu, useOtherOfferGuard, type OfferRef } from "@/components/meta/offer-fit-menu"
import { NotSureChip, OfferNotices, OfferPicker, OfferSections } from "@/components/meta/offer-sections"
import { Bar, Card, IterActionBar, IterWrap, mmss } from "@/components/iterate/parts"
import { UnlockDialog } from "@/components/iterate/sample"
import { useSession } from "@/components/providers/session-provider"
import { mb, useChampionUpload } from "@/components/variar/upload"
import { useUploadMessage } from "@/components/variar/winner-step"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useIterateConfig } from "@/hooks/use-iterate"
import { metaReady, mk, useMetaConnection, useMoney } from "@/hooks/use-meta"
import { tk, useTemplateList } from "@/hooks/use-templates"
import { Segmented } from "./gallery"
import { TourTip } from "@/components/tour/tip"
import { useCompetitorAdGuard } from "@/components/research/competitor-ad-warning"
import { useResearchAds } from "@/hooks/use-research"
import { AdStill, FitPill, Pill, PricePill, isSelectable, useCreditLabel, useFitText, useUseTemplate } from "./parts"

/*
 * /templates/:slug (mockup-templates screen 3, "Which ad do we use?"): Meta winners · Upload · Library. Each row says if the
 * template fits (POST /ad-templates/fits, no paid call); a hard misfit is disabled with its reason. Continue = POST use
 * (reading + plan are free) → /templates/run/:id.
 * templates-multi-v1 §5.2: with 2+ `slugs` (/templates/selection?t=…) the top lists the checked ones, each row gets the fit of the
 * selection, and a row where one of them doesn't fit offers "Remove X and continue" (POST /ad-templates/use).
 */
type SrcTab = "meta" | "upload" | "lib" | "saved"
type Row = { key: string; source: TemplateSourceRef; name: string; line: string; thumbUrl?: string | null; thumb?: import("@/lib/api/types").FileRef | null; dur?: number | null; ad?: MetaAdRow }

const keyOf = (s: TemplateSourceRef) => Object.entries(s).find(([, v]) => v)?.join(":") ?? ""

/** /templates/selection?t=a,b,c: drops repeated / unknown / not-checkable slugs; 1 left = /templates/:slug, 0 = /templates. */
export function TemplateSelectionStep() {
  const ta = useTranslations("adTemplates.ad")
  const errorMessage = useErrorMessage()
  const sp = useSearchParams()
  const router = useRouter()
  const raw = useMemo(() => pickedFromParams(sp), [sp])
  const list = useTemplateList(null)
  const items = list.data?.items
  const slugs = useMemo(() => (items ? raw.filter((s) => items.some((c) => c.slug === s && isSelectable(c))) : null), [raw, items])
  const target = slugs && slugs.length < 2 ? (slugs.length === 1 ? templateAdHref(slugs[0]) : templatesHref()) : null
  useEffect(() => {
    if (target) router.replace(target)
  }, [target, router])
  if (list.isError)
    return (
      <IterWrap>
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{errorMessage(list.error)}</AlertTitle>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => list.refetch()}>
              {ta("retry")}
            </Button>
          </AlertActions>
        </Alert>
      </IterWrap>
    )
  if (!slugs || target)
    return (
      <IterWrap>
        <RowsSkeleton />
      </IterWrap>
    )
  return <TemplateAdStep slugs={slugs} />
}

export function TemplateAdStep({ slugs }: { slugs: string[] }) {
  const t = useTranslations("adTemplates")
  const ta = useTranslations("adTemplates.ad")
  const tr = useTranslations("radar.adStep")
  const tt = useTranslations("tip")
  const errorMessage = useErrorMessage()
  const label = useCreditLabel()
  const { session } = useSession()
  const router = useRouter()
  const multi = slugs.length > 1
  const slug = slugs[0]
  const card = useQuery({ queryKey: ["ad-templates", "card", slug], queryFn: ({ signal }) => api.adTemplates.get(slug, {}, { signal }), staleTime: 60_000, enabled: !multi })
  // the selection's cards come from the gallery list (already cached when coming from /templates)
  const list = useTemplateList(null, { enabled: multi })
  const conn = useMetaConnection()
  const metaOn = metaReady(conn.data) && metaGateOf(conn.data) === "ready"
  const [tab, setTab] = useState<SrcTab | null>(null)
  // 02/11: sem Meta e com anúncio já lido, abre na Biblioteca (lá ele reaproveita a leitura em vez de subir de novo)
  const champs = useQuery({ queryKey: ["champions", { limit: 30 }], queryFn: () => api.champions.list({ limit: 30 }), staleTime: 30_000 })
  const hasRead = (champs.data?.data ?? []).some((c) => c.status === "READY")
  const current: SrcTab = tab ?? (conn.isPending || metaOn ? "meta" : hasRead ? "lib" : "upload")
  const [selected, setSelected] = useState<Row | null>(null)
  const galleryHref = multi ? templatesHref(null, slugs) : templatesHref()
  const use = useUseTemplate({ onInvalid: () => router.push(galleryHref) })
  // meta-oferta-v1 §8: the offer selector sits on top (2+ offers), filled with the active offer; no more waiting for the 422
  const offersQ = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list(), staleTime: 60_000 })
  const offerList: OfferRef[] = useMemo(() => offersQ.data?.data.map((o) => ({ id: o.id, name: o.name })) ?? use.state.offers ?? [], [offersQ.data, use.state.offers])
  const active = useActiveOffer(session.workspace.id, offerList)
  const offerId = active.offerId
  // the row the last "Continue" was for: a 422 TEMPLATE_DOESNT_FIT `items` only counts for that row
  const [triedKey, setTriedKey] = useState<string | null>(null)

  const cards = useMemo(
    () => (multi ? slugs.map((s) => list.data?.items.find((c) => c.slug === s)).filter((c): c is TemplateCard => !!c) : card.data ? [card.data] : []),
    [multi, slugs, list.data, card.data]
  )
  const tpl = multi ? (list.data ? cards[0] : undefined) : card.data
  const names = useMemo(() => new Map(cards.map((c) => [c.slug, c.name])), [cards])
  const loadError = multi ? list.error : card.error
  // R1 (ads-research-v1 §6.1): a saved competitor ad going into a template that reuses its footage asks first
  const r1 = useCompetitorAdGuard()
  const go = (r: Row, which: string[]) => {
    const footage = !!r.source.researchAdId && cards.filter((c) => which.includes(c.slug)).some((c) => c.tier !== "AI")
    r1.guard(footage, () => {
      setTriedKey(r.key)
      use.mutate({ slugs: which, source: r.source, offerId: offerId ?? undefined, ...(tpl?.autoGenerate && { expectedCredits: tpl.credits ?? 0 }) })
    })
  }
  const removeAndGo = (r: Row, out: string[]) => {
    const rest = slugs.filter((s) => !out.includes(s))
    if (!rest.length) return
    // 2+ left: the URL follows (Back keeps the new selection); 1 left goes straight to the single-template route
    if (rest.length > 1) router.replace(templateSelectionHref(rest), { scroll: false })
    go(r, rest)
  }

  const head = multi ? <SelectionHead cards={cards} credits={list.data?.credits} slugs={slugs} /> : (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">{tpl ? `${tpl.name} · ${tpl.pack ? t("pack.capLine", { cap: tpl.credits ?? 10 }) : tpl.autoGenerate && tpl.credits == null ? t("unlimited") : label(tpl.credits)}` : "…"}</span>
      <h1>{ta("title")}</h1>
      <p className="m-0 max-w-[680px] text-fg-2">{ta("lede")}</p>
    </div>
  )
  const flow = <FlowBar flow="templates" current="ad" client={session.workspace.name} hrefs={{ template: galleryHref }} exitHref="/templates" />

  if (loadError) {
    return (
      <IterWrap>
        {flow}
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{errorMessage(loadError)}</AlertTitle>
          </AlertBody>
          <AlertActions>
            <Link href={galleryHref} className={buttonVariants({ size: "sm" })}>
              {ta("backToTemplates")}
            </Link>
          </AlertActions>
        </Alert>
      </IterWrap>
    )
  }

  return (
    <IterWrap>
      {flow}
      {head}
      {offerList.length > 1 || use.state.offers ? (
        <div
          ref={use.state.offers && !offerId ? (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" }) : undefined}
          className={cn("max-w-[480px]", use.state.offers && !offerId && "rounded-lg border border-status-waiting-edge bg-status-waiting-bg p-3.5")}
        >
          <OfferPicker id="tpl-ad-offer" offers={offerList} value={offerId} onChange={active.setOfferId} />
        </div>
      ) : null}
      {/* tour-v2 §4: the tabs + the list are the adSource tip's anchor. Without Meta the "Upload a video" copy only when the
          Upload tab is the one open (02/11: an account with an ad already read opens on the Library) */}
      <div id="t-ad-source" className="flex flex-col gap-5">
        <Segmented
          label={ta("sourceAria")}
          value={current}
          onChange={(v) => setTab(v)}
          options={[["meta", ta("tabMeta")], ["upload", ta("tabUpload")], ["lib", ta("tabLibrary")], ["saved", tr("tab")]]}
          className="self-start"
        />
        {current === "meta" ? (
          conn.isPending ? (
            <RowsSkeleton />
          ) : metaOn ? (
            <MetaRows slugs={slugs} selected={selected} onSelect={setSelected} currency={conn.data?.adAccount?.currency} offer={active.offer} offers={offerList} />
          ) : (
            <MetaLockCard state={metaGateOf(conn.data)} compact />
          )
        ) : current === "upload" ? (
          <UploadSource slugs={slugs} selected={selected} onSelect={setSelected} />
        ) : current === "saved" ? (
          <SavedAdRows slugs={slugs} selected={selected} onSelect={setSelected} />
        ) : (
          <LibraryRows slugs={slugs} selected={selected} onSelect={setSelected} onGoMeta={() => setTab("meta")} />
        )}
      </div>
      <TourTip
        tip="adSource"
        when={!conn.isPending}
        variant={!metaOn && current === "upload" ? "noMeta" : "default"}
        target="#t-ad-source"
        title={!metaOn && current === "upload" ? tt("adSource.titleNoMeta") : tt("adSource.title")}
        body={!metaOn && current === "upload" ? tt("adSource.bodyNoMeta") : tt("adSource.body")}
      />
      <SelectedBar
        row={selected}
        slugs={slugs}
        names={names}
        tpl={tpl}
        busy={use.isPending}
        blocked={!!use.state.offers && !offerId}
        hintOverride={use.state.offers && !offerId ? t("offerLabel") : null}
        misfit={selected && triedKey === selected.key ? use.state.misfit : null}
        backHref={galleryHref}
        onContinue={(r) => go(r, slugs)}
        onRemoveAndContinue={removeAndGo}
      />
      <UnlockDialog open={use.state.unlock} onOpenChange={use.setUnlock} />
      {r1.dialog}
    </IterWrap>
  )
}

/** §5.2: the checked templates as chips (each with its price), the total, and "Edit selection" back to the gallery. */
function SelectionHead({ cards, credits, slugs }: { cards: TemplateCard[]; credits: CreditsSummary | undefined; slugs: string[] }) {
  const t = useTranslations("adTemplates")
  const ta = useTranslations("adTemplates.ad")
  const tp = useTranslations("adTemplates.plan")
  const sum = cards.reduce((a, c) => ({ credits: a.credits + (c.credits ?? 0), videos: a.videos + c.outputs }), { credits: 0, videos: 0 })
  const sample = credits?.access === "SAMPLE" ? credits.sample : null
  const total = [
    t("selection.templatesN", { n: slugs.length }),
    sample ? t("selection.usesOf", { n: sum.credits, left: sample.left }) : credits?.unlimited ? null : t("credits", { n: sum.credits }),
    tp("videosN", { n: sum.videos }),
  ].filter(Boolean).join(" · ")
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">{cards.length ? total : "…"}</span>
      <h1>{ta("title")}</h1>
      <p className="m-0 max-w-[680px] text-fg-2">{ta("lede")}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {cards.length
          ? cards.map((c) => (
              <span key={c.slug} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-card py-1 pr-1 pl-3 text-[13px]">
                <span className="min-w-0 truncate font-semibold">{c.name}</span>
                <PricePill card={c} credits={credits} />
              </span>
            ))
          : slugs.map((s) => <span key={s} className="sk h-[30px] w-28 rounded-full" />)}
        <Link href={templatesHref(null, slugs)} className={buttonVariants({ size: "sm", variant: "ghost" })}>
          {t("selection.edit")}
        </Link>
      </div>
    </div>
  )
}

type FitOf = { fit: TemplateFit; read: boolean; bySlug: { slug: string; fit: TemplateFit }[] }
/** the checked ones that don't fit this row (1 slug: itself when hard) */
const hardOf = (f: FitOf | undefined, slugs: string[]) =>
  !f ? [] : slugs.length > 1 ? f.bySlug.filter((x) => x.fit.level === "hard") : f.fit.level === "hard" ? [{ slug: slugs[0], fit: f.fit }] : []

/** fits of the template (1 slug) or of the selection (2+, with `bySlug`) on the visible rows (POST /ad-templates/fits, ≤ 50) */
function useFits(slugs: string[], sources: TemplateSourceRef[]) {
  const q = useQuery({
    queryKey: tk.fits(slugs, sources),
    queryFn: ({ signal }) => api.adTemplates.fits(slugs.length > 1 ? { slugs, sources } : { slug: slugs[0], sources }, { signal }),
    enabled: sources.length > 0 && slugs.length > 0,
    staleTime: 60_000,
  })
  const map = useMemo(() => {
    const m = new Map<string, FitOf>()
    q.data?.items.forEach((it) => m.set(keyOf(it.source), { fit: it.fit, read: it.read, bySlug: it.bySlug ?? [] }))
    return m
  }, [q.data])
  return { ...q, map }
}

function MetaRows({
  slugs, selected, onSelect, currency, offer, offers,
}: { slugs: string[]; selected: Row | null; onSelect: (r: Row) => void; currency?: string | null; offer: OfferRef | null; offers: OfferRef[] }) {
  const ta = useTranslations("adTemplates.ad")
  const tm = useTranslations("metaOffer")
  const errorMessage = useErrorMessage()
  const money = useMoney(currency)
  // meta-oferta-v1 §8: the list asks with the active offer (grouped this → unknown → other by the API)
  const q = { limit: 20, offerId: offer?.id }
  const ads = useQuery({ queryKey: mk.ads({ ...q, tpl: true }), queryFn: ({ signal }) => api.meta.ads(q, { signal }), staleTime: 30_000, placeholderData: keepPreviousData })
  // "Other products" opened with more of them than the first page brought: read them alone (offerScope=other)
  const [wantOther, setWantOther] = useState(false)
  const oq = { limit: 50, offerId: offer?.id, offerScope: "other" as const }
  const otherQ = useQuery({ queryKey: mk.ads({ ...oq, tpl: true }), queryFn: ({ signal }) => api.meta.ads(oq, { signal }), staleTime: 30_000, enabled: wantOther && !!offer })
  const guard = useOtherOfferGuard(offer)
  const toRow = useMemo(
    () => (a: MetaAdRow): Row => ({
      key: `metaAdId:${a.metaAdId}`,
      source: { metaAdId: a.metaAdId },
      name: a.name,
      thumbUrl: a.thumbnailUrl,
      ad: a,
      line: [
        ta(a.effectiveStatus === "ACTIVE" ? "active" : "paused"),
        ta("spent", { v: money(a.metrics.spend, 0) }),
        a.verdict === "LOW_DATA" ? ta("lowData") : a.metrics.cpa != null ? ta("cpa", { v: money(a.metrics.cpa) }) : null,
      ].filter(Boolean).join(" · "),
    }),
    [money, ta]
  )
  const iterable = (a: MetaAdRow) => a.canIterate !== false && a.videoId !== null
  const ads0 = useMemo(() => {
    const first = ads.data?.data ?? []
    const seen = new Set(first.map((a) => a.metaAdId))
    return [...first, ...(otherQ.data?.data ?? []).filter((a) => !seen.has(a.metaAdId))].filter(iterable)
  }, [ads.data, otherQ.data])
  const rows: Row[] = useMemo(() => ads0.map(toRow), [ads0, toRow])
  const byId = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])
  const fits = useFits(slugs, rows.map((r) => r.source))
  if (ads.isPending) return <RowsSkeleton />
  if (ads.isError)
    return (
      <Alert variant="destructive">
        <NavIcon name="alert" size={20} />
        <AlertBody>
          <AlertTitle>{errorMessage(ads.error)}</AlertTitle>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={() => ads.refetch()}>
            {ta("retry")}
          </Button>
        </AlertActions>
      </Alert>
    )
  const offerMeta = ads.data?.meta?.offer
  if (!rows.length && !(offer && offerMeta && offerMeta.counts.other)) return <EmptyBox title={ta("noMetaTitle")} body={ta("noMetaBody")} />
  const pick = (r: Row) => (r.ad ? guard.check(r.ad, () => onSelect(r)) : onSelect(r))
  const group = (ads: MetaAdRow[], g: MetaOfferFit | "flat") => {
    const list = ads.map((a) => byId.get(`metaAdId:${a.metaAdId}`)).filter((r): r is Row => !!r)
    return (
      <RowList
        rows={list}
        slugs={slugs}
        fits={fits.map}
        fitsPending={fits.isPending}
        selected={selected}
        onSelect={pick}
        label={g === "flat" || !offer ? undefined : g === "this" ? offer.name : g === "unknown" ? tm("sectionUnknown") : tm("sectionOther")}
        chip={g === "unknown" ? () => <NotSureChip /> : undefined}
        aside={(r) => (r.ad ? <OfferFitMenu ad={r.ad} active={offer} offers={offers} /> : null)}
      />
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {offer ? <OfferNotices offer={offer} meta={offerMeta} /> : null}
      <OfferSections
        offer={offer}
        rows={ads0}
        meta={offerMeta}
        renderGroup={group}
        onOpenOther={() => setWantOther(true)}
        moreOther={otherQ.isFetching ? <span className="sk h-[74px] rounded-md" /> : null}
      />
      {guard.dialog}
    </div>
  )
}

function LibraryRows({ slugs, selected, onSelect, onGoMeta }: { slugs: string[]; selected: Row | null; onSelect: (r: Row) => void; onGoMeta: () => void }) {
  const ta = useTranslations("adTemplates.ad")
  const tl = useTranslations("skeleton")
  const errorMessage = useErrorMessage()
  const lib = useQuery({ queryKey: ["library", { media: "video", limit: 20 }], queryFn: () => api.library.list({ media: "video", limit: 20 }), staleTime: 30_000 })
  // 02/11 (Gusta): o anúncio enviado uma vez fica aqui já lido; escolher de novo reaproveita a leitura (nada é lido outra vez)
  const champs = useQuery({ queryKey: ["champions", { limit: 30 }], queryFn: () => api.champions.list({ limit: 30 }), staleTime: 30_000 })
  const rows: Row[] = useMemo(
    () => [
      ...(champs.data?.data ?? [])
        .filter((c) => c.status === "READY")
        .map((c) => ({ key: `championId:${c.id}`, source: { championId: c.id }, name: c.name, thumb: c.thumbnail, dur: c.durationSec, line: [c.offer.name, ta("alreadyRead")].join(" · ") })),
      ...(lib.data?.data ?? [])
        .filter((l) => l.media !== "image")
        .map((l) => ({ key: `creativeId:${l.id}`, source: { creativeId: l.id }, name: l.name, thumb: l.thumbnail, dur: l.durationSec, line: [l.offer.name, l.isWinner ? ta("winner") : null].filter(Boolean).join(" · ") })),
    ],
    [champs.data, lib.data, ta]
  )
  const fits = useFits(slugs, rows.map((r) => r.source))
  return (
    <Reveal
      data={lib.isPending || champs.isPending ? null : rows}
      sample={SAMPLE_ROWS}
      id="templates.ad.library"
      label={tl("ads")}
      error={lib.isError ? (
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{errorMessage(lib.error)}</AlertTitle>
          </AlertBody>
        </Alert>
      ) : undefined}
    >
      {(rows) =>
        rows.length ? (
          <RowList rows={rows} slugs={slugs} fits={fits.map} fitsPending={fits.isPending} selected={selected} onSelect={onSelect} />
        ) : (
          <EmptyBox
            title={ta("libEmptyTitle")}
            body={ta("libEmptyBody")}
            action={
              <Button size="sm" onClick={onGoMeta}>
                {ta("seeMeta")}
              </Button>
            }
          />
        )
      }
    </Reveal>
  )
}

/** ads-research-v1 C.1: "Saved ads" = the competitor ads saved in the Ad Radar (GET /research/ads?saved=true), with video. */
function SavedAdRows({ slugs, selected, onSelect }: { slugs: string[]; selected: Row | null; onSelect: (r: Row) => void }) {
  const tr = useTranslations("radar.adStep")
  const tl = useTranslations("skeleton")
  const errorMessage = useErrorMessage()
  const q = useResearchAds({ saved: true, status: "all", hasVideo: true, limit: 30 })
  const rows: Row[] | null = useMemo(
    () =>
      q.data
        ? q.data.pages.flatMap((p) => p.items).map((a) => ({
            key: `researchAdId:${a.id}`,
            source: { researchAdId: a.id },
            name: [a.competitors[0]?.name ?? a.page.name, a.headline].filter(Boolean).join(" · "),
            thumbUrl: a.media.poster?.url ?? null,
            dur: a.media.durationSec,
            line: a.isActive ? tr("line", { days: a.daysRunning ?? 0 }) : tr("ended"),
          }))
        : null,
    [q.data, tr]
  )
  const fits = useFits(slugs, (rows ?? []).map((r) => r.source))
  return (
    <Reveal
      data={rows}
      sample={SAMPLE_ROWS}
      id="templates.ad.saved"
      label={tl("ads")}
      error={q.isError ? (
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{errorMessage(q.error)}</AlertTitle>
          </AlertBody>
        </Alert>
      ) : undefined}
    >
      {(rows) =>
        rows.length ? (
          <RowList rows={rows} slugs={slugs} fits={fits.map} fitsPending={fits.isPending} selected={selected} onSelect={onSelect} />
        ) : (
          <EmptyBox
            title={tr("emptyTitle")}
            body={tr("emptyBody")}
            action={
              <Link href={RADAR_HREF} className={buttonVariants({ size: "sm" })}>
                {tr("open")}
              </Link>
            }
          />
        )
      }
    </Reveal>
  )
}

function UploadSource({ slugs, selected, onSelect }: { slugs: string[]; selected: Row | null; onSelect: (r: Row | null) => void }) {
  const ta = useTranslations("adTemplates.ad")
  const tn = useTranslations("iterate.new")
  const uploadMessage = useUploadMessage()
  const cfg = useIterateConfig()
  const upload = useChampionUpload(cfg.data)
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const st = upload.state
  const ready = st.phase === "ready" ? st.result.uploadId : null
  const row: Row | null = useMemo(
    () => (ready && st.phase === "ready" ? { key: `uploadId:${ready}`, source: { uploadId: ready }, name: st.file.name, line: ta("uploaded"), thumb: null } : null),
    [ready, st, ta]
  )
  const fits = useFits(slugs, row ? [row.source] : [])
  // the finished upload becomes the picked ad
  useEffect(() => {
    if (row && selected?.key !== row.key) onSelect(row)
  }, [row, selected, onSelect])

  if (row) return <RowList rows={[row]} slugs={slugs} fits={fits.map} fitsPending={fits.isPending} selected={selected} onSelect={onSelect} />
  if (st.phase === "uploading" || st.phase === "checking") {
    const pct = st.phase === "uploading" ? Math.round((st.loaded / Math.max(1, st.total)) * 100) : 100
    return (
      <Card role="status">
        <div className="flex items-center gap-3">
          <div className="aspect-[9/16] w-11 flex-none rounded-sm border border-dashed border-control bg-card-2" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex justify-between gap-2">
              <b className="min-w-0 text-[13px] [overflow-wrap:anywhere]">{st.file.name}</b>
              <span className="font-mono text-[13px] tabular-nums">{pct}%</span>
            </div>
            <Bar value={pct} label={st.file.name} />
            <span className="font-mono text-xs text-fg-3 tabular-nums">
              {st.phase === "uploading" ? tn("ofMb", { done: mb(st.loaded), total: mb(st.total) }) : tn("checking")}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => upload.cancel()}>
            {tn("cancel")}
          </Button>
        </div>
      </Card>
    )
  }
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
          if (f) void upload.start(f)
        }}
        className={cn("grid justify-items-center gap-2 rounded-lg border-[1.5px] border-dashed bg-card px-4 py-7 text-center text-fg-2", over ? "border-fg-2 bg-card-2" : "border-line-strong")}
      >
        <b className="text-fg">{ta("drop")}</b>
        <span className="text-[13px]">
          {cfg.data ? ta("limits", { mb: Math.round(cfg.data.maxBytes / 1024 / 1024), min: Math.round(cfg.data.maxSec / 60) }) : "…"}
        </span>
        <Button size="sm" onClick={() => input.current?.click()} disabled={!cfg.data}>
          {ta("choose")}
        </Button>
        <input
          ref={input}
          type="file"
          accept={(cfg.data?.mimeTypes ?? ["video/mp4", "video/quicktime"]).join(",") + ",.mp4,.mov"}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) void upload.start(f)
          }}
        />
      </div>
      {st.phase === "error" ? (
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{st.file?.name ?? tn("uploadFailed")}</AlertTitle>
            <AlertDescription>{uploadMessage(st.error)}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
      <p className="m-0 text-[13px] text-fg-3">{ta("cleanHint")}</p>
    </div>
  )
}

/** mockup .srcrow list (radiogroup). A hard misfit is disabled and says why; with a selection, only when none of them fits. */
function RowList({
  rows, slugs, fits, fitsPending, selected, onSelect, label, chip, aside,
}: {
  rows: Row[]; slugs: string[]; fits: Map<string, FitOf>; fitsPending: boolean; selected: Row | null; onSelect: (r: Row) => void
  /** meta-oferta-v1: the group's name (one radiogroup per offer section) */
  label?: string
  /** a chip after the fit (e.g. "Not sure") */
  chip?: (r: Row) => React.ReactNode
  /** next to the row, outside the radio (the offer correction menu) */
  aside?: (r: Row) => React.ReactNode
}) {
  const ta = useTranslations("adTemplates.ad")
  const ts = useTranslations("adTemplates.selection")
  const fitText = useFitText()
  return (
    <div role="radiogroup" aria-label={label ?? ta("adsAria")} className="grid gap-2">
      {rows.map((r) => {
        const f = fits.get(r.key)
        const bad = hardOf(f, slugs)
        const hard = bad.length > 0 && bad.length >= slugs.length
        const some = bad.length > 0 && !hard
        const on = selected?.key === r.key
        const side = aside?.(r)
        const btn = (
          <button
            key={r.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={hard}
            aria-describedby={hard ? `why-${r.key}` : undefined}
            onClick={() => onSelect(r)}
            className={cn(
              "grid w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 rounded-md border border-line bg-card px-3 py-2.5 text-left tablet:grid-cols-[54px_minmax(0,1fr)_auto]",
              "hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60",
              on && "border-fg shadow-[inset_0_0_0_1px_var(--fg)]"
            )}
          >
            <AdStill url={r.thumbUrl} file={r.thumb} />
            <div className="grid min-w-0 gap-[3px]">
              <b className="truncate">{r.name}</b>
              <span className="truncate text-xs text-fg-3 tabular-nums">{r.line}</span>
            </div>
            <div className="col-start-2 flex flex-wrap items-center gap-1.5 text-xs tablet:col-start-3 tablet:grid tablet:justify-items-end">
              {r.dur ? <span className="font-mono text-fg-3 tabular-nums">{mmss(r.dur)}</span> : null}
              {some ? <Pill tone="warn">{ts("someDontFit", { n: bad.length, total: slugs.length })}</Pill> : f ? <FitPill fit={f.fit} /> : fitsPending ? <span className="sk h-5 w-16 rounded-[6px]" /> : null}
              {chip?.(r)}
              {hard ? <span id={`why-${r.key}`} className="sr-only">{fitText(f!.fit)}</span> : null}
            </div>
          </button>
        )
        return side ? (
          <div key={r.key} className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">{btn}</div>
            {side}
          </div>
        ) : (
          btn
        )
      })}
    </div>
  )
}

function SelectedBar({
  row, slugs, names, tpl, busy, blocked, hintOverride, misfit, backHref, onContinue, onRemoveAndContinue,
}: {
  row: Row | null; slugs: string[]; names: Map<string, string>; tpl: TemplateCard | undefined; busy: boolean; blocked: boolean; hintOverride: string | null
  misfit: { slug: string; reason: string }[] | null; backHref: string; onContinue: (r: Row) => void; onRemoveAndContinue: (r: Row, out: string[]) => void
}) {
  const ta = useTranslations("adTemplates.ad")
  const ts = useTranslations("adTemplates.selection")
  const fitText = useFitText()
  const { session } = useSession()
  const fits = useFits(slugs, row ? [row.source] : [])
  const f = row ? fits.map.get(row.key) : undefined
  const multi = slugs.length > 1
  // the checked ones that don't fit this ad: from the fits, or from the 422 `items` of the last Continue
  const fromFits = hardOf(f, slugs).map((x) => ({ slug: x.slug, reason: x.fit.reason ?? "" }))
  const bad = multi ? (fromFits.length ? fromFits : (misfit ?? [])).filter((x) => slugs.includes(x.slug)) : []
  const canRemove = bad.length > 0 && bad.length < slugs.length
  const nameOf = (s: string) => names.get(s) ?? s
  const hint = hintOverride ? (
    <b className="text-status-waiting">{hintOverride}</b>
  ) : row && bad.length ? (
    <b className="text-status-waiting">
      {bad.length === 1
        ? ts("doesntFitOne", { name: nameOf(bad[0].slug), reason: fitText({ level: "hard", reason: bad[0].reason }) ?? "" })
        : ts("doesntFitMany", { names: bad.map((x) => nameOf(x.slug)).join(", ") })}
    </b>
  ) : row ? (
    <>
      <b className="text-fg">{row.name}</b> · {f?.read ? ta("alreadyRead") : ta("readFirst")}
    </>
  ) : multi ? (
    ts("hintPick")
  ) : (
    ta("hintPick")
  )
  const off = !row || !tpl || busy || blocked || session.workspace.role === "CLIENT"
  return (
    <IterActionBar hint={hint}>
      <Link href={backHref} className={buttonVariants({ variant: "ghost", className: "max-tablet:hidden" })}>
        {ta("back")}
      </Link>
      {multi && canRemove ? (
        <Button variant="brand" disabled={off} aria-busy={busy} className="max-tablet:col-span-2" onClick={() => row && onRemoveAndContinue(row, bad.map((x) => x.slug))}>
          {busy ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
          {bad.length === 1 ? ts("removeOne", { name: nameOf(bad[0].slug) }) : ts("removeMany", { n: bad.length })}
          <NavIcon name="right" size={16} />
        </Button>
      ) : (
        <Button
          variant="brand"
          disabled={off || f?.fit.level === "hard" || bad.length > 0}
          aria-busy={busy}
          className="max-tablet:col-span-2"
          onClick={() => row && onContinue(row)}
        >
          {busy ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
          {tpl?.autoGenerate ? ta("generateAi") : ta("continue")}
          <NavIcon name="right" size={16} />
        </Button>
      )}
    </IterActionBar>
  )
}

const NO_FITS = new Map<string, FitOf>()
const noop = () => {}
const SAMPLE_ROWS: Row[] = Array.from({ length: 4 }, (_, i) => ({
  key: `sample-row-${i}`,
  source: {},
  name: "Sample ad name",
  line: "Active · Spent $120 · CPA $14.20",
  thumbUrl: BLANK_IMG, // a still (not the type illustration) so the skeleton draws one block
  dur: 24,
}))

/** skullet (04/11): rows measured from the real RowList with sample ads (same height as the list that replaces it). */
function RowsSkeleton() {
  const tl = useTranslations("skeleton")
  return (
    <Reveal data={null} sample={SAMPLE_ROWS} id="templates.ad.rows" label={tl("ads")}>
      {(rows) => <RowList rows={rows} slugs={[]} fits={NO_FITS} fitsPending={false} selected={null} onSelect={noop} />}
    </Reveal>
  )
}

function EmptyBox({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-9 text-center text-fg-2">
      <b className="text-fg">{title}</b>
      <span>{body}</span>
      {action}
    </div>
  )
}
