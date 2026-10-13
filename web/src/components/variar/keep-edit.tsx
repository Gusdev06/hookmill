"use client"

import { useTranslations } from "next-intl"
import type { ChampionDetail, EditLayer, EditMap, KeepEditAvailability, KeepEditBlockerHit, Rect, Teardown } from "@/lib/api/types"
import { Icon } from "@/components/icon"
import { Panel, PanelHead, Tag } from "@/components/page"
import { StatusChip } from "@/components/status-chip"
import { Memo, mmss } from "@/components/wizard/common"
import { cn } from "@/lib/utils"

/** The two kinds that can keep the winner's edit (feature-2 §13). */
export const KEEP_KINDS = ["SWAP_AVATAR", "NEW_HOOKS"] as const
export type KeepKind = (typeof KEEP_KINDS)[number]
export const isKeepKind = (k: string): k is KeepKind => (KEEP_KINDS as readonly string[]).includes(k)

/** "Two or more faces on screen · 0:11–0:19": the reason and the stretch it happens in (null = the whole video). */
export function useBlockerText() {
  const t = useTranslations("variar.keep")
  return (h: KeepEditBlockerHit) => {
    const reason = t(`reason.${h.reason}` as never)
    return h.startSec !== null && h.endSec !== null ? `${reason} · ${t("at", { from: mmss(h.startSec), to: mmss(h.endSec) })}` : reason
  }
}

export function BlockerList({ hits, className }: { hits: KeepEditBlockerHit[]; className?: string }) {
  const text = useBlockerText()
  return (
    <ul className={cn("m-0 grid list-none gap-1 p-0 text-[13px]", className)}>
      {hits.map((h, i) => (
        <li key={`${h.reason}${i}`} className="flex items-start gap-1.5 text-status-waiting">
          <Icon name="alert" className="mt-0.5 flex-none" />
          <span className="min-w-0">{text(h)}</span>
        </li>
      ))}
    </ul>
  )
}

/** One line per kind: keeps the edit, or can't, with every blocker and its stretch. */
export function KeepAvailability({ keepEdit, kinds }: { keepEdit: ChampionDetail["keepEdit"]; kinds: readonly KeepKind[] }) {
  const t = useTranslations("variar")
  return (
    <div className="grid gap-2.5">
      {kinds.map((k) => {
        const a: KeepEditAvailability = keepEdit[k]
        return (
          <div key={k} className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium">{t(`kind.${k}.title`)}</span>
              <StatusChip status={a.available ? "approved" : "waiting"}>{a.available ? t("keep.kept") : t("keep.blocked")}</StatusChip>
            </div>
            {a.blockers.length ? <BlockerList hits={a.blockers} /> : null}
          </div>
        )
      })}
    </div>
  )
}

const pct = (v: number, of: number) => `${(v / Math.max(1, of)) * 100}%`
const boxStyle = (r: Rect, m: EditMap) => ({ left: pct(r.x, m.width), top: pct(r.y, m.height), width: pct(r.w, m.width), height: pct(r.h, m.height) })

/** A keyframe with the mapped edit drawn on top: face area (dashed) and the text layers live at that instant. */
function MappedFrame({ url, atSec, map }: { url: string; atSec: number; map: EditMap }) {
  const f = Math.round(atSec * map.fps)
  const seg = map.faceTrack.find((s) => f >= s.startFrame && f < s.endFrame)
  const layers = map.layers.filter((l) => f >= l.startFrame && f < l.endFrame)
  return (
    <figure className="m-0 grid w-[76px] flex-none gap-1 tablet:w-[84px]">
      <div className="relative overflow-hidden rounded-[4px] border border-line bg-surface-2" style={{ aspectRatio: `${map.width} / ${map.height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
        {seg ? <i className="absolute border-[1.5px] border-dashed border-status-approved bg-status-approved/10" style={boxStyle(seg.region, map)} /> : null}
        {layers.map((l) => (
          <i key={l.id} className="absolute rounded-[2px] border-[1.5px] border-status-waiting bg-status-waiting/15" style={boxStyle(l.background.box ?? l.box, map)} />
        ))}
      </div>
      <figcaption className="text-center font-mono text-[11px] text-fg-3">{mmss(atSec)}</figcaption>
    </figure>
  )
}

function useLayerLine() {
  const t = useTranslations("variar.keep.map")
  return (l: EditLayer, fps: number) =>
    `${t(`layer.${l.kind}`)}${l.text ? ` “${l.text}”` : ""} · ${t(`bg.${l.background.kind}`)} · ${mmss(l.startFrame / fps)}–${mmss(l.endFrame / fps)}`
}

/** Teardown (§13.1-13.2): the mapped edit over the keyframes + whether each kind can keep it, with the reason. */
export function EditMapPanel({ champion, td }: { champion: ChampionDetail; td: Teardown }) {
  const t = useTranslations("variar.keep")
  const layerLine = useLayerLine()
  const map = td.editMap
  return (
    <Panel>
      <PanelHead>
        <h2>{t("map.title")}</h2>
        {map ? <span className="font-mono text-xs text-fg-3">{t("map.count", { f: map.faceTrack.length, t: map.layers.length })}</span> : null}
      </PanelHead>
      {!map ? (
        <Memo icon="info">{t("map.notMapped")}</Memo>
      ) : (
        <>
          <p className="text-[13px] text-fg-2">{t("map.sub")}</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="list" aria-label={t("map.title")}>
            {td.measurements.keyframes.map((k) => (
              <div role="listitem" key={k.atSec}>
                <MappedFrame url={k.image.url} atSec={k.atSec} map={map} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2" aria-hidden="true">
            <span className="flex items-center gap-1.5">
              <i className="size-3 rounded-[2px] border-[1.5px] border-dashed border-status-approved" />
              {t("map.face")}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="size-3 rounded-[2px] border-[1.5px] border-status-waiting" />
              {t("map.text")}
            </span>
          </div>
          <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
            {map.faceTrack.map((s, i) => (
              <li key={`f${i}`} className="flex min-w-0 items-start gap-2">
                <i className="mt-1 size-2.5 flex-none rounded-[2px] border-[1.5px] border-dashed border-status-approved" aria-hidden="true" />
                <span className="min-w-0">
                  {t("map.faceAt", {
                    where: s.fullFrame ? t("map.fullFrame") : t("map.box", { w: Math.round((s.region.w / map.width) * 100), h: Math.round((s.region.h / map.height) * 100) }),
                    from: mmss(s.startFrame / map.fps),
                    to: mmss(s.endFrame / map.fps),
                  })}
                </span>
              </li>
            ))}
            {map.layers.map((l) => (
              <li key={l.id} className="flex min-w-0 items-start gap-2">
                <i className="mt-1 size-2.5 flex-none rounded-[2px] border-[1.5px] border-status-waiting" aria-hidden="true" />
                <span className="min-w-0">{layerLine(l, map.fps)}</span>
              </li>
            ))}
          </ul>
          {map.profile ? (
            <div className="grid gap-1.5">
              <span className="text-xs text-fg-3">{t("map.profile")}</span>
              <div className="flex flex-wrap gap-1.5">
                {[map.profile.ageBand, map.profile.ethnicity, map.profile.hair, map.profile.clothing, map.profile.setting, map.profile.framing].filter(Boolean).map((x) => (
                  <Tag key={x}>{x}</Tag>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      <div className="grid gap-2 border-t border-line pt-3">
        <span className="text-xs text-fg-3">{t("map.availability")}</span>
        <KeepAvailability keepEdit={champion.keepEdit} kinds={KEEP_KINDS} />
      </div>
    </Panel>
  )
}
