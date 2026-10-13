"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { Offer, Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BriefFields, EMPTY_DRAFT, toDraft, type Draft, type DraftKey } from "@/components/brief-form"
import { Icon } from "@/components/icon"
import { SoonBlock } from "@/components/soon"
import { BackLink, Card, OnboardingFrame, onboardingHref, type useOnboarding } from "./shared"

type Ctx = ReturnType<typeof useOnboarding>
const BRIEF: DraftKey[] = ["what", "audience", "promise", "pains", "proof", "offerAndPrice", "cta"]
const STEP3: readonly DraftKey[] = ["name", "language", "what", "promise", "offerAndPrice", "cta"]
const STEP4: readonly DraftKey[] = ["audience", "pains"]

/**
 * The client's offer, edited across steps 3 and 4 with the same brief fields as Offers and the wizard (BriefFields).
 * Saved on Continue / Save and exit: PATCH /offers/:id with what changed, or POST /offers when the site wasn't read.
 */
function useOfferDraft(ws: Workspace, offer: Offer | null) {
  const qc = useQueryClient()
  const base: Draft = offer ? toDraft(offer) : { ...EMPTY_DRAFT, name: ws.name, language: ws.uiLocale === "PT_BR" ? "pt-BR" : "en" }
  const [draft, setDraft] = useState<Draft>(base)
  const [lp, setLp] = useState(offer?.sourceUrl ?? ws.websiteUrl ?? "")
  const [notes, setNotes] = useState(offer?.notes ?? "")
  const [fromPage, setFromPage] = useState<Set<DraftKey>>(
    () => new Set(Object.entries(offer?.fieldSources ?? {}).filter(([k, v]) => v === "page" && k !== "language").map(([k]) => k as DraftKey))
  )

  const change = (k: DraftKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setFromPage((s) => {
      if (!s.has(k)) return s
      const n = new Set(s)
      n.delete(k)
      return n
    })
  }

  const hasContent = BRIEF.some((k) => draft[k].trim()) || !!notes.trim()
  const needsName = !offer && hasContent && !draft.name.trim()

  const save = async (): Promise<Offer | null> => {
    const url = lp.trim() ? (/^https?:\/\//i.test(lp.trim()) ? lp.trim() : `https://${lp.trim()}`) : null
    if (offer) {
      const changed: Record<string, string | null> = {}
      for (const k of Object.keys(draft) as DraftKey[]) {
        if (draft[k] !== base[k]) changed[k] = k === "name" || k === "language" ? draft[k] : draft[k].trim() || null
      }
      if ((notes.trim() || null) !== (offer.notes ?? null)) changed.notes = notes.trim() || null
      if (url !== offer.sourceUrl) changed.sourceUrl = url
      if (changed.name === "") delete changed.name
      if (!Object.keys(changed).length) return offer
      const o = await api.offers.update(offer.id, changed)
      qc.invalidateQueries({ queryKey: ["offers"] })
      return o
    }
    if (!hasContent) return null
    const o = await api.offers.create({
      name: draft.name.trim(), language: draft.language, sourceUrl: url,
      what: draft.what.trim() || null, audience: draft.audience.trim() || null, promise: draft.promise.trim() || null,
      pains: draft.pains.trim() || null, proof: draft.proof.trim() || null, offerAndPrice: draft.offerAndPrice.trim() || null,
      cta: draft.cta.trim() || null, notes: notes.trim() || null,
    })
    qc.invalidateQueries({ queryKey: ["offers"] })
    return o
  }

  return { draft, change, fromPage, lp, setLp, notes, setNotes, save, needsName }
}

/** Save the offer, then PATCH the step and move. */
function useSaveAndMove(ctx: Ctx, save: () => Promise<unknown>) {
  const run = useMutation({
    mutationFn: async (v: { step: number; to: string }) => {
      await save()
      return v
    },
    onSuccess: (v) => ctx.move.mutate(v),
  })
  return { go: (step: number, to: string) => (ctx.canEdit ? run.mutate({ step, to }) : ctx.move.mutate({ step, to })), pending: run.isPending || ctx.move.isPending, error: run.error ?? ctx.move.error }
}

function OtherOffers({ count }: { count: number }) {
  const t = useTranslations("onboarding")
  if (count < 2) return null
  return (
    <Alert>
      <Icon name="info" />
      <AlertBody>
        <AlertDescription>{t("offer.many", { count })}</AlertDescription>
      </AlertBody>
      <AlertActions>
        <Link href="/offers" className={buttonVariants({ size: "sm" })}>
          {t("offer.openOffers")}
        </Link>
      </AlertActions>
    </Alert>
  )
}

export function ProductStep({ ws, ctx }: { ws: Workspace; ctx: Ctx }) {
  const t = useTranslations("onboarding")
  const tf = useTranslations("offers.fields")
  const d = useOfferDraft(ws, ctx.offer)
  const { go, pending, error } = useSaveAndMove(ctx, d.save)
  const site = ws.websiteUrl ? ws.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : null

  return (
    <OnboardingFrame
      slug="offer"
      ws={ws}
      title={t("offer.title")}
      sub={ctx.offer?.sourceUrl && site ? t("offer.subRead", { site, name: ws.name }) : t("offer.sub", { name: ws.name })}
      error={error}
      saving={pending}
      onSaveExit={() => !d.needsName && go(3, "/clients")}
      hintWarn={d.needsName}
      hint={d.needsName ? t("offer.needsName") : t("savedAsYouGo")}
      back={<BackLink href={onboardingHref(2)}>{t("back")}</BackLink>}
      primary={
        <Button variant="brand" size="lg" disabled={pending || d.needsName} onClick={() => go(4, onboardingHref(4))}>
          {t("offer.continue")}
          <Icon name="arrowr" />
        </Button>
      }
    >
      <OtherOffers count={ctx.list.length} />
      {!ctx.offer ? (
        <Alert>
          <Icon name="info" />
          <AlertBody>
            <AlertDescription>{t("offer.noOffer")}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Link href={onboardingHref(1)} className={buttonVariants({ size: "sm" })}>
              {t("offer.readSite")}
            </Link>
          </AlertActions>
        </Alert>
      ) : null}

      <SoonBlock what={t.rich("offer.soonProducts", { b: (c) => <b>{c}</b> })} example>
        <ul className="m-0 grid list-none gap-2 p-0">
          {[
            ["Silk sleep mask", "$49"],
            ["Travel kit", "$69"],
          ].map(([n, p]) => (
            <li key={n} className="flex items-center justify-between gap-3 rounded-md border border-line bg-card px-3 py-2.5">
              <strong>{n}</strong>
              <span className="font-mono">{p}</span>
            </li>
          ))}
        </ul>
      </SoonBlock>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-[18px] desktop:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title={t("offer.theOffer")}>
          <BriefFields draft={d.draft} onChange={d.change} fromPage={d.fromPage} only={STEP3} disabled={!ctx.canEdit} labels={{ name: t("offer.nameLabel") }} />
          <div className="grid gap-1.5">
            <Label htmlFor="ob-lp">{t("offer.lp")}</Label>
            <Input id="ob-lp" type="text" inputMode="url" value={d.lp} disabled={!ctx.canEdit} onChange={(e) => d.setLp(e.target.value)} placeholder="example.com/offer" />
          </div>
          <SoonBlock what={t.rich("offer.soonWhy", { b: (c) => <b>{c}</b> })} />
        </Card>
        <Card title={t("offer.proofTitle")}>
          <BriefFields draft={d.draft} onChange={d.change} fromPage={d.fromPage} only={["proof"]} disabled={!ctx.canEdit} labels={{ proof: tf("proof") }} />
          <p className="m-0 text-xs text-fg-3">{t("offer.proofHint")}</p>
        </Card>
      </div>

      <SoonBlock what={t.rich("offer.soonObjections", { b: (c) => <b>{c}</b> })} example>
        <div className="grid gap-2 tablet:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-md border border-line bg-card p-3">
            <strong>&ldquo;Is it hot to sleep in?&rdquo;</strong>
            <span className="text-[13px] text-fg-2">Mulberry silk breathes and stays cool.</span>
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-line bg-card p-3">
            <strong>&ldquo;$49 for a sleep mask?&rdquo;</strong>
            <span className="text-[13px] text-fg-2">It lasts for years, and the trial costs nothing.</span>
          </div>
        </div>
      </SoonBlock>
    </OnboardingFrame>
  )
}

export function AudienceStep({ ws, ctx }: { ws: Workspace; ctx: Ctx }) {
  const t = useTranslations("onboarding")
  const d = useOfferDraft(ws, ctx.offer)
  const { go, pending, error } = useSaveAndMove(ctx, d.save)
  const disabled = !ctx.canEdit || !ctx.offer

  return (
    <OnboardingFrame
      slug="audience"
      ws={ws}
      title={t("audience.title", { name: ws.name })}
      sub={t("audience.sub")}
      error={error}
      saving={pending}
      onSaveExit={() => go(4, "/clients")}
      hint={t("savedAsYouGo")}
      back={<BackLink href={onboardingHref(3)}>{t("back")}</BackLink>}
      primary={
        <Button variant="brand" size="lg" disabled={pending} onClick={() => go(5, onboardingHref(5))}>
          {t("audience.continue")}
          <Icon name="arrowr" />
        </Button>
      }
    >
      {!ctx.offer ? (
        <Alert variant="warning">
          <Icon name="info" />
          <AlertBody>
            <AlertDescription>{t("audience.noOffer")}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Link href={onboardingHref(3)} className={buttonVariants({ size: "sm" })}>
              {t("audience.toOffer")}
            </Link>
          </AlertActions>
        </Alert>
      ) : null}

      <Card title={t("audience.who")}>
        <BriefFields draft={d.draft} onChange={d.change} fromPage={d.fromPage} only={STEP4} disabled={disabled} />
        <SoonBlock what={t.rich("audience.soonGroups", { b: (c) => <b>{c}</b> })} />
      </Card>

      <Card title={t("audience.instructions")}>
        <div className="grid gap-1.5">
          <Label htmlFor="ob-notes">{t("audience.notes")}</Label>
          <Textarea id="ob-notes" rows={3} value={d.notes} disabled={disabled} onChange={(e) => d.setNotes(e.target.value)} placeholder={t("audience.notesPh")} />
          <span className="text-xs text-fg-3">{t("audience.notesHint")}</span>
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-[18px] desktop:grid-cols-2">
        <SoonBlock what={t.rich("audience.soonVoice", { b: (c) => <b>{c}</b> })} example>
          <div className="grid gap-3">
            {[
              ["Calm", "Energetic", 30],
              ["Playful", "Serious", 55],
              ["Casual", "Polished", 40],
            ].map(([a, b, v]) => (
              <div key={a as string} className="grid gap-1">
                <span className="flex justify-between text-xs text-fg-2">
                  <span>{a}</span>
                  <span>{b}</span>
                </span>
                <span className="h-1.5 rounded-full bg-line">
                  <span className="block h-full rounded-full bg-fg" style={{ width: `${v}%` }} />
                </span>
              </div>
            ))}
          </div>
        </SoonBlock>
        <SoonBlock what={t.rich("audience.soonWords", { b: (c) => <b>{c}</b> })} example>
          <div className="flex flex-wrap gap-1.5">
            {["sleep in", "real dark", "60 nights"].map((w) => (
              <span key={w} className="rounded-full border border-line bg-card px-2.5 py-1 text-xs font-semibold">
                {w}
              </span>
            ))}
            {["cure", "guaranteed"].map((w) => (
              <span key={w} className="rounded-full border border-status-failed-edge bg-status-failed-bg px-2.5 py-1 text-xs font-semibold text-status-failed line-through">
                {w}
              </span>
            ))}
          </div>
        </SoonBlock>
      </div>
      <SoonBlock what={t.rich("audience.soonBrand", { b: (c) => <b>{c}</b> })} />
    </OnboardingFrame>
  )
}
