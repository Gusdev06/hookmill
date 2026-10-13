"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { ClientCard, CreateClientBody } from "@/lib/api/types"
import { createClient, switchWorkspace } from "@/lib/session/token"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icon } from "@/components/icon"
import { ClientAvatar } from "@/components/shell/logo"
import { SoonBlock } from "@/components/soon"
import { clientHref } from "@/components/onboarding/shared"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"

/**
 * Clients (fase2-agencia §3.1): every workspace the user belongs to, with the derived status (Setup step X of 6 /
 * Live / Paused) and "waiting on you" from GET /workspaces. Spend and CPA are "Soon" (they need Meta).
 * Opening a client switches the session (PUT /api/session) and goes to its setup step, or Home once it's live.
 */
export default function ClientsPage() {
  const t = useTranslations("clients")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const qc = useQueryClient()
  const [pending, start] = useTransition()
  const [opening, setOpening] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const q = useQuery({ queryKey: ["clients"], queryFn: ({ signal }) => api.clients.list({ signal }), refetchOnWindowFocus: true })
  const list = q.data?.data ?? []
  const meta = q.data?.meta

  const open = (c: ClientCard) => {
    setOpening(c.id)
    start(async () => {
      try {
        if (!c.isActive) {
          await switchWorkspace(c.id)
          qc.clear()
        }
        router.push(clientHref(c))
      } catch {
        setOpening(null)
        toast.error(t("openFailed"))
      }
    })
  }

  const sub = meta
    ? [
        t("summary.live", { count: meta.summary.live }),
        meta.summary.setup ? t("summary.setup", { count: meta.summary.setup }) : null,
        meta.summary.paused ? t("summary.paused", { count: meta.summary.paused }) : null,
        t("summary.waiting", { count: meta.summary.waitingTotal }),
      ]
        .filter(Boolean)
        .join(" · ")
    : null

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-[22px] px-[var(--gut)] pt-5 pb-16 tablet:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          {sub ? <p className="m-0 text-fg-3">{sub}</p> : q.isPending ? <span className="sk h-4 w-64" /> : null}
        </div>
        {meta?.canCreate ? (
          <Button variant="brand" size="lg" onClick={() => setCreating(true)} className="w-full tablet:w-auto">
            <Icon name="plus" />
            {t("new")}
          </Button>
        ) : null}
      </div>

      {q.isError && !q.data ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("loadFailed")}</AlertTitle>
            <AlertDescription>{errorMessage(q.error)}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => q.refetch()}>
              <Icon name="refresh" />
              {tc("retry")}
            </Button>
          </AlertActions>
        </Alert>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-3.5" aria-busy={q.isPending}>
          {q.isPending
            ? [0, 1, 2].map((i) => <span key={i} className="sk h-[210px] rounded-xl" />)
            : list.map((c) => <ClientTile key={c.id} c={c} busy={pending && opening === c.id} disabled={pending} onOpen={() => open(c)} />)}
          {meta?.canCreate ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-[200px] flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-control p-[18px] text-center text-fg outline-none hover:border-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span aria-hidden="true" className="inline-grid size-11 place-items-center rounded-full bg-brand text-[#15171a]">
                <Icon name="plus" />
              </span>
              <strong className="text-base">{t("onboardTitle")}</strong>
              <span className="max-w-[260px] text-fg-3">{t("onboardBody")}</span>
            </button>
          ) : null}
        </div>
      )}

      <NewClientDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function ClientTile({ c, busy, disabled, onOpen }: { c: ClientCard; busy: boolean; disabled: boolean; onOpen: () => void }) {
  const t = useTranslations("clients")
  const to = useTranslations("onboarding")
  const host = c.websiteUrl ? c.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : null
  const line = [c.industry, c.businessType ? to(`businessType.${c.businessType}`) : null, host].filter(Boolean).join(" · ")
  const setup = !c.onboarding.completedAt
  const chip =
    c.status === "PAUSED" ? (
      <span className="rounded-full bg-card-2 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-fg-btn">{t("status.PAUSED")}</span>
    ) : c.status === "LIVE" ? (
      <span className="rounded-full bg-status-approved-bg px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-status-approved">{t("status.LIVE")}</span>
    ) : (
      <span className="rounded-full bg-status-waiting-bg px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-status-waiting">
        {t("status.SETUP", { n: c.onboarding.step })}
      </span>
    )
  const w = c.waitingOnYou

  return (
    <article className={cn("relative flex min-w-0 flex-col gap-3.5 rounded-xl border bg-card p-[18px]", c.isActive ? "border-[1.5px] border-fg" : "border-line")}>
      <div className="flex items-center gap-3">
        <ClientAvatar name={c.name} className="size-10 rounded-[11px] text-base" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-base font-bold">
            {/* the whole card opens the client */}
            <button
              type="button"
              onClick={onOpen}
              disabled={disabled}
              aria-busy={busy}
              className="text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring disabled:cursor-progress"
            >
              {c.name}
            </button>
          </h2>
          <span className="truncate text-[13px] text-fg-3">
            {line || <span className="font-mono">{c.shortCode}</span>}
            {c.isActive ? <span className="ml-1.5 font-semibold text-fg-2">· {t("current")}</span> : null}
          </span>
        </div>
        {chip}
      </div>

      {setup ? (
        <p className="m-0 text-fg-2">{t("nextUp", { step: to(`rail.${(["business", "meta", "offer", "audience", "goals", "brain"] as const)[c.onboarding.step - 1]}.title`) })}</p>
      ) : (
        <p className={cn("m-0", w.total ? "font-semibold text-status-waiting" : "text-fg-2")}>
          {w.total ? t("waiting", { creatives: w.creatives, batches: w.batches, total: w.total }) : t("nothingWaiting")}
        </p>
      )}

      {setup ? (
        <span className="relative z-[1] pointer-events-none inline-flex h-11 w-fit items-center gap-2 rounded-md bg-fg px-4 font-bold text-white">
          {busy ? t("opening") : t("continueSetup")}
          <Icon name="arrowr" />
        </span>
      ) : (
        <SoonBlock what={t.rich("soonSpend", { b: (c) => <b>{c}</b> })} example className="p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-fg-3">{t("spend30")}</span>
              <span className="font-mono text-[17px] font-semibold">$5,240</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-fg-3">{t("cpa")}</span>
              <span className="font-mono text-[17px] font-semibold">$41.20</span>
            </div>
          </div>
        </SoonBlock>
      )}
      {busy && !setup ? <span className="text-[13px] text-fg-3">{t("opening")}</span> : null}
    </article>
  )
}

/** New client: name (+ optional site), copyTeam on by default (D3). POST /workspaces via the BFF; lands on step 1. */
function NewClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("clients")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [site, setSite] = useState("")
  const [copyTeam, setCopyTeam] = useState(true)
  const create = useMutation({
    mutationFn: () => {
      const b: CreateClientBody = { name: name.trim(), copyTeam }
      const s = site.trim()
      if (s) b.websiteUrl = /^https?:\/\//i.test(s) ? s : `https://${s}`
      return createClient(b)
    },
    onSuccess: () => {
      qc.clear()
      router.push("/onboarding/business")
    },
  })
  const change = (o: boolean) => {
    if (create.isPending) return
    onOpenChange(o)
    if (!o) {
      setName("")
      setSite("")
      setCopyTeam(true)
      create.reset()
    }
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-[calc(100%-32px)] border-line bg-card sm:max-w-md">
        <DialogHeader className="text-left sm:text-left">
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newBody")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) create.mutate()
          }}
        >
          {create.isError ? (
            <Alert variant="destructive">
              <Icon name="alert" />
              <AlertBody>
                <AlertTitle>{errorMessage(create.error)}</AlertTitle>
              </AlertBody>
            </Alert>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="nc-name">{t("name")}</Label>
            <Input id="nc-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nc-site">
              {t("site")} <span className="font-normal text-fg-3">{t("optional")}</span>
            </Label>
            <Input id="nc-site" inputMode="url" value={site} onChange={(e) => setSite(e.target.value)} placeholder="example.com" />
          </div>
          <label className="flex min-h-11 items-start gap-2.5 text-[13px]">
            <Checkbox checked={copyTeam} onCheckedChange={(v) => setCopyTeam(v === true)} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold text-fg">{t("copyTeam")}</span>
              <span className="text-fg-3">{t("copyTeamHint")}</span>
            </span>
          </label>
          <div className="flex flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
            <Button type="button" variant="ghost" onClick={() => change(false)} disabled={create.isPending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="brand" disabled={!name.trim() || create.isPending}>
              {create.isPending ? t("creating") : t("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
