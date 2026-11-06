"use client"

import { useId, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { AdminTemplate, TemplateStatus } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { NavIcon } from "@/components/shell/nav-icon"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useMe } from "@/hooks/use-me"
import { tk } from "@/hooks/use-templates"
import { Pill, TemplateStill } from "./parts"

/** Only the HookMill team (INTERNAL account + OWNER of the active workspace); the API answers 403 to everyone else. */
export function useIsTeamOwner() {
  const me = useMe()
  const { session } = useSession()
  return me.data?.user.access === "INTERNAL" && session.workspace.role === "OWNER"
}

/*
 * /templates/admin (mockup-templates "Admin · catalog"): every template with its example, internal type, tier, editable credits,
 * uses, status and Upload / Replace video (PUT pre-signed → complete, poster by ffmpeg). Without an example a LIVE template stays
 * hidden from customers ("Needs example").
 */
export function TemplatesAdmin() {
  const t = useTranslations("adTemplates.admin")
  const errorMessage = useErrorMessage()
  const team = useIsTeamOwner()
  const me = useMe()
  const q = useQuery({ queryKey: tk.admin, queryFn: () => api.admin.templates(), enabled: team })
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-[18px] px-[var(--gut)] pt-5 pb-16 tablet:pt-6">
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="m-0 max-w-[62ch] text-fg-2">{t("lede")}</p>
      </div>
      {me.isPending ? (
        <span className="sk h-40 rounded-lg" />
      ) : !team ? (
        <Alert>
          <NavIcon name="info" size={20} />
          <AlertBody>
            <AlertTitle>{t("teamOnly")}</AlertTitle>
            <AlertDescription>{t("teamOnlyBody")}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : (
        <>
          <GrantCreditsCard />
          {q.isPending ? (
            <span className="sk h-80 rounded-lg" />
          ) : q.isError ? (
            <Alert variant="destructive">
              <NavIcon name="alert" size={20} />
              <AlertBody>
                <AlertTitle>{errorMessage(q.error)}</AlertTitle>
              </AlertBody>
              <AlertActions>
                <Button size="sm" onClick={() => q.refetch()}>
                  {t("retry")}
                </Button>
              </AlertActions>
            </Alert>
          ) : (
            <div className="no-scrollbar overflow-x-auto rounded-lg border border-line bg-card">
              <table className="w-full min-w-[860px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    {(["example", "template", "type", "tier", "credits", "uses", "status", ""] as const).map((h, i) => (
                      <th key={i} className="border-b border-line px-3 py-2.5 text-left font-mono text-[10.5px] font-medium tracking-[0.06em] text-fg-3 uppercase">
                        {h ? t(`col.${h}`) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((it) => (
                    <AdminRow key={it.slug} it={it} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 text-[12.5px] text-fg-3">{t("foot")}</p>
        </>
      )}
    </div>
  )
}

const STATUSES: TemplateStatus[] = ["LIVE", "DRAFT", "HIDDEN"]

function AdminRow({ it }: { it: AdminTemplate }) {
  const t = useTranslations("adTemplates.admin")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [credits, setCredits] = useState(it.credits == null ? "" : String(it.credits))
  const [base, setBase] = useState(it.credits)
  if (it.credits !== base) {
    setBase(it.credits)
    setCredits(it.credits == null ? "" : String(it.credits))
  }
  const patch = useMutation({
    mutationFn: (b: Parameters<typeof api.admin.updateTemplate>[1]) => api.admin.updateTemplate(it.slug, b),
    onSuccess: (n) => {
      qc.setQueryData<{ items: AdminTemplate[] }>(tk.admin, (old) => (old ? { items: old.items.map((x) => (x.slug === n.slug ? n : x)) } : old))
      void qc.invalidateQueries({ queryKey: ["ad-templates"] })
      toast(t("saved", { name: it.nameEn }))
    },
    onError: (e) => {
      setCredits(it.credits == null ? "" : String(it.credits))
      toast(errorMessage(e))
    },
  })
  const commitCredits = () => {
    const v = credits.trim() === "" ? null : Number(credits)
    if (v === it.credits || (v !== null && (!Number.isInteger(v) || v < 0))) return setCredits(it.credits == null ? "" : String(it.credits))
    patch.mutate({ credits: v })
  }
  const status = it.status === "LIVE" && it.needsExample ? "needs" : it.status
  return (
    <tr className="border-t border-line-soft first:border-t-0">
      <td className="px-3 py-2.5 align-middle">
        {it.example || it.poster ? (
          <TemplateStill template={it} className="w-9" />
        ) : (
          <div className="aspect-[9/16] w-9 rounded-[5px] border-[1.5px] border-dashed border-line-strong bg-card-2" title={t("noExample")} />
        )}
      </td>
      <td className="px-3 py-2.5 align-middle">
        <b className="block">{it.nameEn}</b>
        <span className="block font-mono text-[11px] text-fg-3">{it.slug}</span>
      </td>
      <td className="px-3 py-2.5 align-middle font-mono text-[11.5px]">{it.internalKey}</td>
      <td className="px-3 py-2.5 align-middle">{it.tier === "AI" ? <Pill tone="ai">AI</Pill> : <Pill>{it.tier === "STATIC" ? t("tierStatic") : t("tierEdit")}</Pill>}</td>
      <td className="px-3 py-2.5 align-middle">
        <Input
          aria-label={t("creditsFor", { name: it.nameEn })}
          inputMode="numeric"
          value={credits}
          onChange={(e) => setCredits(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={commitCredits}
          onKeyDown={(e) => (e.key === "Enter" ? e.currentTarget.blur() : undefined)}
          className="h-9 w-16 px-2"
          placeholder="—"
        />
      </td>
      <td className="px-3 py-2.5 align-middle font-mono tabular-nums">{it.uses}</td>
      <td className="px-3 py-2.5 align-middle">
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={it.status} onValueChange={(v) => patch.mutate({ status: v as TemplateStatus })}>
            <SelectTrigger aria-label={t("statusFor", { name: it.nameEn })} className="h-9 w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {status === "needs" ? <Pill tone="warn">{t("needsExample")}</Pill> : null}
          {!it.available ? <Pill tone="beta">{t("unavailable")}</Pill> : null}
          {it.beta ? <Pill tone="beta">{t("beta")}</Pill> : null}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right align-middle">
        <ExampleUpload it={it} />
      </td>
    </tr>
  )
}

/** POST example → PUT the MP4 (progress) → complete. 9:16, ≤ 60 s, ≤ 60 MB (the API checks and says why). */
function ExampleUpload({ it }: { it: AdminTemplate }) {
  const t = useTranslations("adTemplates.admin")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const input = useRef<HTMLInputElement>(null)
  const [pct, setPct] = useState<number | null>(null)
  const up = useMutation({
    mutationFn: async (file: File) => {
      if (file.type && file.type !== "video/mp4") throw new Error("mime")
      if (file.size > 60 * 1024 * 1024) throw new Error("size")
      setPct(0)
      const target = await api.admin.exampleUpload(it.slug, { mimeType: "video/mp4", sizeBytes: file.size })
      await api.admin.sendExample(target, file, { onProgress: (l, total) => setPct(Math.round((l / Math.max(1, total)) * 100)) })
      return api.admin.exampleComplete(it.slug, { key: target.key })
    },
    onSuccess: (n) => {
      qc.setQueryData<{ items: AdminTemplate[] }>(tk.admin, (old) => (old ? { items: old.items.map((x) => (x.slug === n.slug ? n : x)) } : old))
      void qc.invalidateQueries({ queryKey: ["ad-templates"] })
      toast(t("uploaded", { name: it.nameEn }))
    },
    onError: (e) => toast(e instanceof Error && (e.message === "mime" || e.message === "size") ? t(e.message === "mime" ? "onlyMp4" : "tooBig") : errorMessage(e)),
    onSettled: () => setPct(null),
  })
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="video/mp4"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (f) up.mutate(f)
        }}
      />
      <Button size="sm" disabled={up.isPending} aria-busy={up.isPending} onClick={() => input.current?.click()}>
        {up.isPending ? <span className="spin-ring size-3.5" aria-hidden="true" /> : <NavIcon name="upload" size={14} />}
        {up.isPending ? t("uploading", { p: pct ?? 0 }) : it.example ? t("replace") : t("upload")}
      </Button>
    </>
  )
}

/**
 * Credit an account by hand (T8, no gateway): e-mail or account id, ± credits, a note. The idempotency key is made once per
 * form fill, so a double click or a retry never credits twice. Only the team sees it.
 */
export function GrantCreditsCard({ className }: { className?: string }) {
  const t = useTranslations("adTemplates.grant")
  const errorMessage = useErrorMessage()
  const team = useIsTeamOwner()
  const qc = useQueryClient()
  const uid = useId()
  const [who, setWho] = useState("")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [key, setKey] = useState(() => newKey())
  const [last, setLast] = useState<{ who: string; credits: number; balance: number } | null>(null)
  const grant = useMutation({
    mutationFn: () => {
      const w = who.trim()
      return api.admin.grantCredits({ ...(w.includes("@") ? { email: w } : { userId: w }), credits: Number(amount), note: note.trim() || undefined, idempotencyKey: key })
    },
    onSuccess: (r) => {
      setLast({ who: who.trim(), credits: Number(amount), balance: r.balance })
      toast(t("done", { n: Number(amount), balance: r.balance }))
      setAmount("")
      setNote("")
      setKey(newKey())
      void qc.invalidateQueries({ queryKey: tk.credits })
      void qc.invalidateQueries({ queryKey: tk.ledger })
    },
  })
  if (!team) return null
  const n = Number(amount)
  const valid = who.trim().length > 0 && Number.isInteger(n) && n !== 0 && Math.abs(n) <= 10000
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-card p-4 tablet:p-5", className)} aria-labelledby={`${uid}-h`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id={`${uid}-h`} className="text-base font-bold">{t("title")}</h2>
        <Pill>{t("teamOnly")}</Pill>
      </div>
      <p className="m-0 text-[13px] text-fg-3 text-pretty">{t("body")}</p>
      <form
        className="grid grid-cols-[minmax(0,1fr)] items-end gap-3 tablet:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !grant.isPending) grant.mutate()
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-who`}>{t("who")}</Label>
          <Input id={`${uid}-who`} value={who} onChange={(e) => setWho(e.target.value)} placeholder={t("whoPlaceholder")} autoComplete="off" spellCheck={false} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-n`}>{t("credits")}</Label>
          <Input id={`${uid}-n`} value={amount} inputMode="numeric" onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ""))} placeholder="50" className="font-mono" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-note`}>{t("note")}</Label>
          <Input id={`${uid}-note`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} />
        </div>
        <Button type="submit" variant="default" disabled={!valid || grant.isPending} aria-busy={grant.isPending}>
          {t("submit")}
        </Button>
      </form>
      {grant.isError ? (
        <span className="text-xs font-semibold text-status-failed" role="alert">
          {errorMessage(grant.error)}
        </span>
      ) : last ? (
        <span className="text-xs text-status-approved" role="status">
          {t("last", { who: last.who, n: last.credits, balance: last.balance })}
        </span>
      ) : (
        <span className="text-xs text-fg-3">{t("hint")}</span>
      )}
    </section>
  )
}

function newKey() {
  return `grant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
