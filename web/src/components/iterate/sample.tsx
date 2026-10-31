"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { IterateBatch, IteratePiece } from "@/lib/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/icon"
import { VideoPlayer } from "@/components/video-player"
import { useSession } from "@/components/providers/session-provider"
import { ME_KEY, useMe } from "@/hooks/use-me"
import { ik } from "@/hooks/use-iterate"
import { cn } from "@/lib/utils"
import { Code, Cols, Dot, GenThumb, Head, IterActionBar, IterFlow, IterWrap, usePieceName } from "./parts"

/*
 * Free sample with a blurred preview (docs/contratos/amostra-gratis-v1.md, mockup design/mockup-amostra-gratis.html, ok 29/10).
 * The blur is made on the server (`piece.preview`: 0-3 s sharp, the rest blurred, with the seal); the web only plays it and
 * puts the lock over the player after the 3 s. Nothing here calls an endpoint that answers 402 (zip, formats, retry, editor, Meta).
 * P2 (no gateway yet): "Unlock" opens "Talk to us"; the team unlocks the account in Settings (PATCH /admin/users/:id/access).
 */

/** amostra-gratis-v1 §0/§3 (the contract package is types only, so the numbers live here too). */
export const SAMPLE_SHARP_SEC = 3
export const SAMPLE_MAX_PIECES = 4

/** A sample batch the account hasn't paid for: the API marks every piece `locked`. Before the pieces exist, the account plan says it. */
export function useSampleLocked(batch: Pick<IterateBatch, "sample" | "pieces">) {
  const me = useMe()
  if (!batch.sample) return false
  if (batch.pieces.length) return batch.pieces.some((p) => p.locked)
  return me.data?.user.access === "SAMPLE"
}
export const isLockedSample = (batch: Pick<IterateBatch, "sample" | "pieces">) => !!batch.sample && batch.pieces.some((p) => p.locked)

/**
 * Unlock without reloading: when the window gets the focus back (the person paid or wrote to us in another tab), refetch
 * `/auth/me` and the batch. PAID turns the same pieces into the normal ones (no new render).
 */
export function useUnlockOnFocus(batchId?: string) {
  const qc = useQueryClient()
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return
      void qc.invalidateQueries({ queryKey: ME_KEY })
      if (batchId) void qc.invalidateQueries({ queryKey: ik.batch(batchId) })
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [qc, batchId])
}

/** "Free sample · up to 4 variations, no cost" — the line the analysis and the generation show for the sample batch. */
export function SampleEyebrow() {
  const t = useTranslations("sample")
  return <>{t("badge", { n: SAMPLE_MAX_PIECES })}</>
}

// ───────────── Download (locked) ─────────────
export function SampleDownloadScreen({ batch }: { batch: IterateBatch }) {
  const t = useTranslations("sample")
  useUnlockOnFocus(batch.id)
  const [contact, setContact] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const pieces = batch.pieces.filter((p) => p.status !== "left_out" && p.status !== "failed")
  const ready = pieces.filter((p) => p.status === "ready").length
  const failed = batch.pieces.filter((p) => p.status === "failed").length
  const n = pieces.length
  const openContact = () => {
    setContact(true)
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  return (
    <IterWrap>
      <IterFlow current="download" batchId={batch.id} done="download" />
      <Head
        eyebrow={t("eyebrowReady", { ready, total: n })}
        title={ready === n ? t("title", { n }) : t("titleWaiting", { ready, total: n })}
        lede={t("lede", { name: batch.source.name, n, sec: SAMPLE_SHARP_SEC })}
      />
      {failed ? <p className="m-0 text-[13px] text-fg-3">{t("failedNote", { n: failed })}</p> : null}
      <Cols
        main={
          <section aria-label={t("gridAria")} className="grid grid-cols-2 gap-2.5 tablet:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tablet:gap-3.5">
            {pieces.map((p) => (
              <SamplePiece key={p.id} p={p} />
            ))}
          </section>
        }
        side={<UnlockPanel ref={panelRef} pieces={n} contact={contact} onContact={setContact} />}
      />
      {/* review 29/10 F6: one lime per screen and no dead buttons in the bar; the hint says what opens on unlock */}
      <IterActionBar hint={t("lockedActions")}>
        <Button variant="brand" onClick={openContact}>
          <Icon name="lock" />
          {t("panel.cta")}
        </Button>
      </IterActionBar>
    </IterWrap>
  )
}

function SamplePiece({ p }: { p: IteratePiece }) {
  const t = useTranslations("sample")
  const pieceName = usePieceName()
  const [time, setTime] = useState(0)
  const past = time >= SAMPLE_SHARP_SEC
  const why = `sample-why-${p.id}`
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-card p-2.5">
      {p.status === "ready" && p.preview ? (
        <div className="relative">
          <VideoPlayer video={p.preview} poster={p.poster?.url ?? null} size="sm" onTime={setTime} />
          {past ? null : (
            <span className="pointer-events-none absolute top-2 left-2 rounded-[4px] bg-brand px-1.5 py-0.5 font-mono text-[10px] text-brand-ink">
              {t("hookTag", { sec: SAMPLE_SHARP_SEC })}
            </span>
          )}
          {/* the lock covers the frame above the controls: the blurred rest keeps playing (and the sound), the controls stay usable */}
          <div
            aria-hidden={!past}
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 bottom-11 grid place-items-center content-center gap-1.5 rounded-t-md bg-black/35 p-2.5 text-center text-[13px] font-bold text-white transition-opacity duration-300 motion-reduce:transition-none",
              past ? "opacity-100" : "opacity-0"
            )}
          >
            <Icon name="lock" className="size-6" />
            {t("lockLine")}
          </div>
        </div>
      ) : (
        <div className="relative grid aspect-[9/16] w-full place-items-center overflow-hidden rounded-md bg-ink" role="status">
          <GenThumb queued={p.status === "queued"} className="absolute inset-0 size-full rounded-none" />
          <span className="relative inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
            <Dot pulse />
            {p.status === "ready" ? t("previewMaking") : t("rendering")}
          </span>
        </div>
      )}
      {/* QA layout #4: the code always under the name, so sibling cards line up */}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <b className="min-w-0 text-[13px]">{pieceName(p)}</b>
        <Code className="text-[11px] whitespace-normal [overflow-wrap:anywhere]">{p.code}</Code>
      </div>
      <p className="m-0 text-xs text-fg-2">{p.change}</p>
      {/* review 29/10 F4 + QA layout #4: side by side when both labels fit, otherwise each on its own line (any width) */}
      <div className="mt-auto flex flex-wrap gap-1.5">
        <Button size="sm" disabled aria-describedby={why} className="flex-auto px-2 text-xs">
          {t("download")}
        </Button>
        <Button size="sm" disabled aria-describedby={why} className="flex-auto px-2 text-xs">
          {t("sendToMeta")}
        </Button>
      </div>
      <span id={why} className="sr-only">{t("lockedWhy")}</span>
    </article>
  )
}

// ───────────── Unlock panel (ink) ─────────────
/**
 * mockup .ink: unlock list + CTA, then the AI block disabled ("paid plan"). `reason: 'sample_used'` = /iterate/new after the
 * sample. The CTA opens "Talk to us" (P2): the e-mail to copy and the account id the team needs to unlock it.
 */
export function UnlockPanel({
  pieces, reason = "locked", contact, onContact, ref, className,
}: {
  pieces: number; reason?: "locked" | "sample_used"; contact: boolean; onContact: (v: boolean) => void
  ref?: React.Ref<HTMLElement>; className?: string
}) {
  const t = useTranslations("sample")
  return (
    <aside
      ref={ref}
      aria-label={t("panel.aria")}
      className={cn("on-ink flex min-w-0 scroll-mt-4 flex-col gap-3.5 rounded-xl bg-ink p-5 text-ink-body", className)}
    >
      {contact ? (
        <TalkToUs onBack={() => onContact(false)} />
      ) : (
        <>
          <h2 className="m-0 text-xl leading-tight text-white">{reason === "sample_used" ? t("panel.titleUsed") : t("panel.title", { n: pieces })}</h2>
          <p className="m-0 text-[13px] text-ink-fg-2">{reason === "sample_used" ? t("panel.subUsed") : t("panel.sub")}</p>
          <ul className="m-0 grid list-none gap-2 p-0 text-[13px]">
            {(["li1", "li2", "li3"] as const).map((k) => (
              <li key={k} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 size-[7px] flex-none rounded-[2px] bg-brand" />
                {t(`panel.${k}`)}
              </li>
            ))}
          </ul>
          {/* F6: on the ink panel the CTA is the light button (--primary = --ink-fg); the screen's lime is in the action bar */}
          <Button variant="default" onClick={() => onContact(true)}>
            {t("panel.cta")}
          </Button>
        </>
      )}
      <div className="border-t border-ink-line" />
      <div className="grid gap-1 rounded-md border border-dashed border-ink-line p-3" aria-disabled="true">
        <b className="flex flex-wrap items-center gap-1.5 text-[13px] text-white">
          {t("panel.aiTitle")}
          <span className="rounded-[4px] border border-ink-line bg-ink-2 px-1.5 py-0.5 font-mono text-[10px] font-normal text-ink-fg-2">{t("panel.aiTag")}</span>
        </b>
        <span className="text-xs text-ink-fg-2">{t("panel.aiBody")}</span>
      </div>
      <span className="text-xs text-ink-fg-2">{t("panel.note", { n: SAMPLE_MAX_PIECES })}</span>
    </aside>
  )
}

/**
 * review 29/10 L4: unlock asked from inside another block ("Generate anyway" on a locked sample, or a 402) opens "Talk to us"
 * in a dialog, on the ink surface, instead of dropping the whole unlock panel inline.
 */
export function UnlockDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="on-ink max-w-[calc(100%-32px)] rounded-xl border-ink-line bg-ink p-5 text-ink-body sm:max-w-md [&>[data-slot=dialog-close]]:text-ink-fg-2">
        <TalkToUs onBack={() => onOpenChange(false)} inDialog />
      </DialogContent>
    </Dialog>
  )
}

/** P2 without a gateway: the e-mail as copyable text (not only a mailto) and the account id the admin pastes in Settings. */
function TalkToUs({ onBack, inDialog = false }: { onBack: () => void; inDialog?: boolean }) {
  const t = useTranslations("sample.contact")
  const { session } = useSession()
  const email = t("email")
  const copy = (text: string, done: string) => {
    if (!navigator.clipboard) return toast(text)
    void navigator.clipboard.writeText(text).then(() => toast(done), () => toast(text))
  }
  return (
    <div className="flex flex-col gap-3" role={inDialog ? undefined : "region"} aria-live={inDialog ? undefined : "polite"} aria-label={inDialog ? undefined : t("title")}>
      {inDialog ? (
        <>
          <DialogTitle className="m-0 pr-8 text-xl leading-tight text-white">{t("title")}</DialogTitle>
          <DialogDescription className="m-0 text-[13px] text-ink-fg-2">{t("body")}</DialogDescription>
        </>
      ) : (
        <>
          <h2 className="m-0 text-xl leading-tight text-white">{t("title")}</h2>
          <p className="m-0 text-[13px] text-ink-fg-2">{t("body")}</p>
        </>
      )}
      <CopyRow label={t("emailLabel")} value={email} onCopy={() => copy(email, t("copiedEmail"))} copyLabel={t("copy")} />
      <CopyRow label={t("idLabel")} value={session.user.id} onCopy={() => copy(session.user.id, t("copiedId"))} copyLabel={t("copy")} />
      <p className="m-0 text-[13px] font-semibold text-white">{t("instant")}</p>
      <p className="m-0 text-xs text-ink-fg-2">{t("auto")}</p>
      <div className="flex flex-wrap gap-2">
        <a href={`mailto:${email}?subject=${encodeURIComponent(t("subject"))}&body=${encodeURIComponent(t("mailBody", { id: session.user.id }))}`} className={buttonVariants({ size: "sm", variant: "brand" })}>
          {t("openMail")}
        </a>
        <Button size="sm" variant="outline" onClick={onBack} className="border-ink-line bg-transparent text-ink-body hover:border-ink-fg hover:bg-transparent hover:text-white">
          {t("back")}
        </Button>
      </div>
    </div>
  )
}

function CopyRow({ label, value, onCopy, copyLabel }: { label: string; value: string; onCopy: () => void; copyLabel: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-ink-fg-2">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-ink-line bg-ink-2 py-1 pr-1 pl-2.5">
        <span className="min-w-0 flex-1 font-mono text-[13px] text-white select-all [overflow-wrap:anywhere]">{value}</span>
        <Button size="sm" variant="outline" onClick={onCopy} aria-label={`${copyLabel} ${label}`} className="flex-none border-ink-line bg-transparent text-ink-body hover:border-ink-fg hover:bg-transparent hover:text-white">
          {copyLabel}
        </Button>
      </div>
    </div>
  )
}

/** /iterate/new with the sample already spent (access SAMPLE, sampleUsed): the unlock panel instead of the upload. */
export function SampleUsedScreen() {
  const t = useTranslations("sample")
  useUnlockOnFocus()
  const [contact, setContact] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const openContact = () => {
    setContact(true)
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  return (
    <IterWrap>
      <IterFlow current="analyze" />
      <Head eyebrow={t("usedEyebrow")} title={t("usedTitle")} lede={t("usedLede")} />
      <Cols
        main={
          <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-card p-[18px]">
            <b>{t("usedWhatTitle")}</b>
            <p className="m-0 text-[13px] text-fg-2">{t("usedWhatBody")}</p>
            <div>
              <Link href="/" className={buttonVariants({ size: "sm" })}>
                {t("usedHome")}
              </Link>
            </div>
          </section>
        }
        side={<UnlockPanel ref={panelRef} pieces={0} reason="sample_used" contact={contact} onContact={setContact} />}
      />
      {/* F6/L1: the bar's lime is the action that exists here (unlock), not a Generate that never turns on */}
      <IterActionBar hint={t("usedHint")}>
        <Button variant="brand" onClick={openContact}>
          <Icon name="lock" />
          {t("panel.cta")}
        </Button>
      </IterActionBar>
    </IterWrap>
  )
}
