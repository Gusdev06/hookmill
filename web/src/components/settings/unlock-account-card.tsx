"use client"

import { useId, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { AccountAccess } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useInvalidateMe, useMe } from "@/hooks/use-me"

const PLANS: AccountAccess[] = ["PAID", "SAMPLE", "INTERNAL"]

/*
 * Settings › Unlock an account (amostra-gratis-v1 §5, P2 without a gateway): PATCH /admin/users/:id/access. Only the HookMill
 * team sees it (INTERNAL account + OWNER of the active workspace; the API checks the same and answers 403 otherwise).
 * The person sends their account id from the "Talk to us" panel; the pieces of their sample unlock on their next focus.
 */
export function UnlockAccountCard() {
  const t = useTranslations("sample.admin")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const me = useMe()
  const invalidateMe = useInvalidateMe()
  const uid = useId()
  const [userId, setUserId] = useState("")
  const [access, setAccess] = useState<AccountAccess>("PAID")
  const [last, setLast] = useState<{ id: string; access: AccountAccess } | null>(null)
  const save = useMutation({
    mutationFn: () => api.admin.updateAccess(userId.trim(), access),
    onSuccess: (r) => {
      setLast(r)
      toast(t("done", { id: r.id, access: t(`plan.${r.access}`) }))
      if (r.id === me.data?.user.id) invalidateMe()
    },
  })
  if (me.data?.user.access !== "INTERNAL" || session.workspace.role !== "OWNER") return null
  const id = userId.trim()
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-card p-4 tablet:p-5" aria-labelledby={`${uid}-h`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id={`${uid}-h`} className="text-base font-bold">{t("title")}</h2>
        <span className="inline-flex h-fit items-center rounded-full border border-line-soft bg-card-2 px-2 py-[3px] text-[11px] font-bold whitespace-nowrap text-fg-2">{t("teamOnly")}</span>
      </div>
      <p className="m-0 text-[13px] text-fg-3 text-pretty">{t("body")}</p>
      <form
        className="grid grid-cols-[minmax(0,1fr)] items-end gap-3 tablet:grid-cols-[minmax(0,1fr)_180px_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          if (id && !save.isPending) save.mutate()
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-id`}>{t("userId")}</Label>
          <Input id={`${uid}-id`} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={t("userIdPlaceholder")} autoComplete="off" spellCheck={false} className="font-mono" aria-invalid={save.isError} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-plan`}>{t("planLabel")}</Label>
          <Select value={access} onValueChange={(v) => setAccess(v as AccountAccess)}>
            <SelectTrigger id={`${uid}-plan`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{PLANS.map((p) => <SelectItem key={p} value={p}>{t(`plan.${p}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="brand" disabled={!id || save.isPending} aria-busy={save.isPending}>
          {save.isPending ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
          {t("apply")}
        </Button>
      </form>
      {save.isError ? <p role="alert" className="m-0 text-[13px] text-status-failed">{errorMessage(save.error)}</p> : null}
      {last && !save.isError ? <p role="status" className="m-0 text-[13px] text-fg-2">{t("done", { id: last.id, access: t(`plan.${last.access}`) })}</p> : null}
    </section>
  )
}
