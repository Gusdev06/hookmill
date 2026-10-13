"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useFormatter, useNow, useTranslations } from "next-intl"
import type { ChampionDetail, VariationBatch, VariationItem, VariationKind } from "@/lib/api/types"
import { creativeHref } from "@/lib/routes"
import { variarHref } from "@/lib/routes"
import { Button, buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { GenCanvas } from "@/components/fx"
import { Icon } from "@/components/icon"
import { Count, Panel, PanelHead } from "@/components/page"
import { StatusChip } from "@/components/status-chip"
import { Thumb } from "@/components/thumb"
import { ActionBar, WzHead } from "@/components/wizard/shell"
import { Banner, Memo, useMoney } from "@/components/wizard/common"
import { useStatusLabel } from "@/hooks/use-status-label"
import { cn } from "@/lib/utils"
import { VariarFrame } from "./frame"
import { EditedBadge } from "@/components/editor/entry"

const ORDER: VariationKind[] = ["SWAP_AVATAR", "NEW_HOOKS", "COPY_NEW", "REMIX_EDIT"]

function itemTitle(t: ReturnType<typeof useTranslations<"variar">>, it: VariationItem, n: number) {
  if (it.isControl) return t("hooks.control")
  return it.kind === "SWAP_AVATAR" ? t("estimate.swapN", { n }) : t("hooks.hookN", { n })
}

/** One variation (mockup .vrow): thumb, name, what changed, status, action. Effects only on the row that is generating. */
function VariationRow({ it, n, textHooks }: { it: VariationItem; n: number; textHooks: boolean }) {
  const t = useTranslations("variar")
  const label = useStatusLabel()
  const c = it.creative!
  const sub = it.kind === "NEW_HOOKS" ? `“${(textHooks ? it.hook?.onScreenText : it.hook?.speech) ?? ""}”` : (it.lever ?? t("batch.newFace"))
  const failed = c.status === "failed"
  const running = c.status === "progress"
  const action =
    c.step === "review" ? (
      <Link href={creativeHref(c)} className={buttonVariants({ size: "sm" })}>
        {t("batch.review")}
        <Icon name="arrowr" />
      </Link>
    ) : running ? null : (
      <Link href={creativeHref(c)} className={buttonVariants({ size: "sm", variant: failed ? "outline" : "ghost" })}>
        {failed ? <Icon name="refresh" /> : null}
        {failed ? t("batch.fix") : t("batch.open")}
      </Link>
    )
  return (
    <div
      className={cn(
        "relative grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3.5 rounded-lg border bg-surface p-3 tablet:grid-cols-[48px_minmax(0,1fr)_auto]",
        failed ? "border-status-failed-edge" : "border-line",
        running && "beam"
      )}
    >
      {running ? (
        <div className="relative grid aspect-[9/16] w-11 place-items-center overflow-hidden rounded-sm border border-line bg-surface-2 tablet:w-12">
          <GenCanvas seed={n + 3} width={48} height={86} />
          {c.progress !== null ? <span className="on-ink absolute rounded-[4px] bg-black/60 px-1 font-mono text-[10px] text-fg">{c.progress}%</span> : null}
        </div>
      ) : failed ? (
        <div className="grid aspect-[9/16] w-11 place-items-center rounded-sm border border-status-failed-edge bg-surface-2 text-status-failed tablet:w-12">
          <Icon name="alert" />
        </div>
      ) : (
        <Thumb file={c.thumbnail} play={c.step === "review" || c.step === "library"} className="w-11 tablet:w-12" />
      )}
      <div className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{itemTitle(t, it, n)}</span>
          {/* D1: a variation exported with editor changes differs from the control in more than one thing */}
          {c.editedInEditor ? <EditedBadge variation /> : null}
        </span>
        <span className="row-sub">{sub}</span>
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2.5 tablet:col-span-1 tablet:justify-end">
        <StatusChip status={c.status}>{label(c)}</StatusChip>
        {action}
      </div>
    </div>
  )
}

/** Step 6 · Batch (spec §5.6): real count + bar + "you can close", rows grouped by kind, Review on the ready ones. */
export function BatchStep({ champion, batch }: { champion: ChampionDetail; batch: VariationBatch }) {
  const t = useTranslations("variar")
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  const money = useMoney()
  const router = useRouter()
  const launched = batch.status === "LAUNCHED"
  const items = batch.items.filter((i) => i.creative)
  const p = batch.progress
  const total = p?.total ?? items.length
  const ready = (p?.waiting ?? 0) + (p?.approved ?? 0)
  const firstReady = items.find((i) => i.creative?.step === "review")
  const done = !!p && p.generating === 0 && p.failed === 0

  return (
    <VariarFrame
      champion={champion}
      batch={batch}
      viewing="batch"
      actionbar={
        <ActionBar
          hint={done ? t("batch.allDone") : null}
          primary={
            <Button data-primary variant="default" disabled={!firstReady} onClick={() => firstReady && router.push(creativeHref(firstReady.creative!))}>
              {t("batch.reviewFirst")}
            </Button>
          }
        />
      }
    >
      <WzHead
        title={t("steps.batch")}
        sub={t("batch.sub", { name: champion.name })}
        aside={
          <Link href="/" className={buttonVariants()}>
            <Icon name="left" />
            {t("backHome")}
          </Link>
        }
      />
      {!launched ? (
        <Banner
          title={t("batch.notLaunched")}
          actions={
            <Link href={variarHref(champion.id, "estimate", batch.id)} className={buttonVariants({ size: "sm" })}>
              {t("continueTo", { step: t("steps.estimate") })}
            </Link>
          }
        />
      ) : (
        <>
          <Panel>
            <div className="grid gap-2">
              <PanelHead>
                <b className="font-semibold">
                  {t("batch.readyOf", { ready, total })}
                  {p?.failed ? ` · ${t("batch.failedN", { n: p.failed })}` : ""}
                </b>
                <span className="row-sub font-mono">
                  {done ? t("batch.spent", { cost: money(batch.costUsd) }) : batch.launchedAt ? t("batch.started", { ago: format.relativeTime(new Date(batch.launchedAt), now) }) : ""}
                </span>
              </PanelHead>
              <Progress value={total ? ((total - (p?.generating ?? 0)) / total) * 100 : 0} aria-label={t("batch.readyOf", { ready, total })} className={cn(done && "[&>*]:bg-status-approved")} />
            </div>
            {!done ? <Memo icon="info">{t.rich("batch.leave", { b: (c) => <b>{c}</b> })}</Memo> : <Memo icon="check">{t("batch.toLibrary")}</Memo>}
          </Panel>
          {ORDER.map((k) => {
            const group = items.filter((i) => i.kind === k)
            if (!group.length) return null
            let n = 0
            return (
              <section key={k} className="grid gap-2">
                <h2 className="text-sm">
                  {t(`kind.${k}.title`)}
                  <Count>{group.filter((i) => !i.isControl).length}</Count>
                </h2>
                <div className="grid gap-2">
                  {group.map((it) => (
                    <VariationRow key={it.id} it={it} n={it.isControl ? 0 : ++n} textHooks={batch.settings.keepEdit && batch.settings.hookMode === "TEXT"} />
                  ))}
                </div>
              </section>
            )
          })}
        </>
      )}
    </VariarFrame>
  )
}
