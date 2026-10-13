"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { CreateInviteBody } from "@/lib/api/types"
import { Alert, AlertBody, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"

/*
 * Invite (contract §14, fase2-agencia §3.4): POST /workspace/invites with ADMIN | MEMBER | CLIENT. No email is sent:
 * the answer is a link to copy. Used by Settings (in a dialog) and by the client onboarding step 1 (inline).
 */
type InviteRole = CreateInviteBody["role"]

function CopyLink({ url, id }: { url: string; id: string }) {
  const t = useTranslations()
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{t("settings.inviteReady")}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={url} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          onClick={() =>
            navigator.clipboard.writeText(url).then(() =>
              toast(
                <>
                  <Icon name="check" />
                  {t("common.copied")}
                </>
              )
            )
          }
        >
          <Icon name="copy" />
          {t("common.copy")}
        </Button>
      </div>
      <span className="text-xs text-fg-3">{t("settings.expires7")}</span>
    </div>
  )
}

/** Email + role → invite link. `inline` = one row (email · role · button) like the onboarding mockup. */
export function InviteForm({ inline, defaultRole = "MEMBER", idPrefix = "invite", disabled }: { inline?: boolean; defaultRole?: InviteRole; idPrefix?: string; disabled?: boolean }) {
  const t = useTranslations()
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<InviteRole>(defaultRole)
  const invite = useMutation({
    mutationFn: () => api.workspace.invite({ email: email.trim(), role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace", "members"] }),
  })
  const again = () => {
    invite.reset()
    setEmail("")
  }

  if (invite.data) {
    return (
      <div className="grid gap-2">
        <CopyLink url={invite.data.inviteUrl} id={`${idPrefix}-url`} />
        {inline ? (
          <div>
            <Button variant="ghost" size="sm" onClick={again}>
              <Icon name="plus" />
              {t("settings.inviteAnother")}
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <form
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        invite.mutate()
      }}
    >
      {invite.isError ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{errorMessage(invite.error)}</AlertTitle>
          </AlertBody>
        </Alert>
      ) : null}
      <div className={cn("grid gap-3.5", inline && "items-end tablet:grid-cols-[minmax(0,1fr)_220px_auto]")}>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${idPrefix}-email`}>{inline ? t("settings.inviteSomeone") : t("settings.email")}</Label>
          <Input id={`${idPrefix}-email`} type="email" required value={email} disabled={disabled} onChange={(e) => setEmail(e.target.value)} placeholder={t("settings.emailPlaceholder")} />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${idPrefix}-role`}>{t("settings.role")}</Label>
          <Select value={role} onValueChange={(v) => setRole(v as InviteRole)} disabled={disabled}>
            <SelectTrigger id={`${idPrefix}-role`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CLIENT">{t("settings.roles.CLIENT")}</SelectItem>
              <SelectItem value="MEMBER">{t("settings.roles.MEMBER")}</SelectItem>
              <SelectItem value="ADMIN">{t("settings.roles.ADMIN")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className={cn(!inline && "flex justify-end")}>
          <Button type="submit" variant={inline ? "outline" : "default"} disabled={disabled || invite.isPending || !email.trim()} className={cn(inline && "w-full tablet:w-auto")}>
            {t("settings.createLink")}
          </Button>
        </div>
      </div>
    </form>
  )
}

export function InviteDialog({ workspace }: { workspace: string }) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Icon name="plus" />
          {t("settings.invite")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100%-32px)] border-line bg-surface sm:max-w-md">
        <DialogHeader className="text-left sm:text-left">
          <DialogTitle>{t("settings.inviteTitle", { workspace })}</DialogTitle>
          <DialogDescription>{t("settings.inviteBody")}</DialogDescription>
        </DialogHeader>
        {/* remounts on every open: a fresh form each time */}
        {open ? <InviteForm /> : null}
      </DialogContent>
    </Dialog>
  )
}
