"use client"

import { useId, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"

/*
 * Pieces of the Eddy conversation (design/mockup-onboarding-eddy.html): Eddy's message with the avatar, the person's
 * bubble, the system line, the card that holds the action of the moment, the editable row and the "Confirmed" line.
 */

export function EddyAvatar({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("grid size-7 flex-none place-items-center rounded-[9px] bg-ink font-mono text-xs font-semibold text-brand tablet:size-8", className)}>
      Ed
    </span>
  )
}

export function EddyMsg({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-3" aria-busy={busy || undefined}>
      <EddyAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="text-xs font-bold text-fg-3">Eddy</span>
        {children}
      </div>
    </div>
  )
}

/** Eddy's sentence: max 60ch like the mockup */
export function Say({ children }: { children: React.ReactNode }) {
  return <p className="m-0 max-w-[60ch] text-pretty">{children}</p>
}

export function MeBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <span className="max-w-[80%] rounded-[14px_14px_4px_14px] bg-fg px-3.5 py-2 text-white [overflow-wrap:anywhere]">{children}</span>
    </div>
  )
}

export function SysLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 self-center font-mono text-xs text-fg-3">
      <i aria-hidden="true" className="size-[7px] rounded-full bg-ok-dot" />
      {children}
    </div>
  )
}

export function ChatCard({ children, className, beam, ...rest }: React.ComponentProps<"div"> & { beam?: boolean }) {
  return (
    <div {...rest} className={cn("relative min-w-0 rounded-lg border border-line bg-card", beam && "beam", className)}>
      {children}
    </div>
  )
}

export function CardHead({ title, tag }: { title: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
      <b className="min-w-0 truncate text-[13.5px]">{title}</b>
      {tag ? <span className="inline-flex h-[22px] max-w-[55%] items-center truncate rounded-full bg-card-2 px-2 text-[11.5px] font-bold text-fg-2">{tag}</span> : null}
    </div>
  )
}

/** The card's foot: the actions while active, the "Confirmed" line after. */
export function CardFoot({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-4 py-3 max-tablet:[&>button]:flex-[1_1_auto]">
      {children}
      {hint ? <span className="basis-full text-xs text-fg-3 tablet:ml-auto tablet:basis-auto">{hint}</span> : null}
    </div>
  )
}

export function Confirmed({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-fg-3">
      <i aria-hidden="true" className="size-[7px] flex-none rounded-full bg-ok-dot" />
      {children}
    </span>
  )
}

/** A field row of a card: label · value · Edit (or Add); editing opens the input in place, Save writes through `onSave`. */
export function EditRow({
  label, value, emptyText, emptyWarn, multiline, editable, onSave, maxLength, mono, placeholder,
}: {
  label: string
  value: string | null | undefined
  /** what shows when the value is empty */
  emptyText: string
  /** amber empty (something that should be there) instead of muted */
  emptyWarn?: boolean
  multiline?: boolean
  editable: boolean
  onSave: (v: string) => Promise<unknown>
  maxLength?: number
  mono?: boolean
  placeholder?: string
}) {
  const t = useTranslations("eddyOnboarding")
  const errorMessage = useErrorMessage()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const v = value?.trim() ?? ""

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(draft.trim())
      setEditing(false)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-line-soft px-3.5 py-2.5 first:border-t-0 tablet:grid-cols-[130px_minmax(0,1fr)_auto] tablet:px-4">
      <label htmlFor={id} className="col-span-2 pt-px text-[12.5px] font-semibold text-fg-3 tablet:col-span-1">
        {label}
      </label>
      {editing ? (
        <div className="col-span-2 flex flex-col gap-1.5 tablet:col-span-2">
          {multiline ? (
            <Textarea id={id} value={draft} maxLength={maxLength} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus disabled={busy} />
          ) : (
            <Input id={id} value={draft} maxLength={maxLength} onChange={(e) => setDraft(e.target.value)} autoFocus disabled={busy} placeholder={placeholder} className={cn(mono && "font-mono")} />
          )}
          {error ? (
            <span role="alert" className="text-xs text-status-failed">
              {errorMessage(error)}
            </span>
          ) : null}
          <div className="flex gap-1.5">
            <Button size="sm" variant="default" onClick={save} disabled={busy} aria-busy={busy}>
              {busy ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
              {t("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <span className={cn("min-w-0 whitespace-pre-line [overflow-wrap:anywhere]", mono && "font-mono", !v && (emptyWarn ? "font-semibold text-warn" : "text-fg-3"))}>{v || emptyText}</span>
          {editable ? (
            <button
              type="button"
              onClick={() => {
                setDraft(v)
                setError(null)
                setEditing(true)
              }}
              className="min-h-10 px-1 text-xs font-bold text-fg-2 underline underline-offset-2 hover:text-fg tablet:min-h-7"
              aria-label={`${v ? t("edit") : t("add")} · ${label}`}
            >
              {v ? t("edit") : t("add")}
            </button>
          ) : (
            <span />
          )}
        </>
      )}
    </div>
  )
}
