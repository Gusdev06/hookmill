"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import type { CreateClientBody } from "@/lib/api/types"
import { createClient } from "@/lib/session/token"
import { Alert, AlertBody, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"

/** New client: name (+ optional site), copyTeam on by default (D3). POST /workspaces via the BFF; lands on step 1. */
export function NewClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
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
