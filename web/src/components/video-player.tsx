"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import type { FileRef, VideoFormat } from "@/lib/api/types"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

const RATIO: Record<VideoFormat, [number, number]> = { VERTICAL_9_16: [9, 16], PORTRAIT_4_5: [4, 5], SQUARE_1_1: [1, 1] }
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

/**
 * VideoPlayer (spec §4): native <video> + own controls (play, scrub, mono time, sound).
 * size "lg" = Final OK (up to 72vh), "sm" = Edit (up to 64vh); mobile caps at 62vh.
 */
export function VideoPlayer({
  video, poster, format = "VERTICAL_9_16", size = "lg", overlay, className, videoRef, onTime,
}: {
  video: FileRef | null; poster?: string | null; format?: VideoFormat; size?: "lg" | "sm"; overlay?: React.ReactNode; className?: string
  /** Feature 2 (block timeline): read/seek the element and follow the playhead. */
  videoRef?: React.RefObject<HTMLVideoElement | null>; onTime?: (sec: number) => void
}) {
  const t = useTranslations("player")
  const ownRef = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? ownRef
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(video?.durationSec ?? 0)
  // proporção real do arquivo quando a API manda (ou quando o vídeo carrega); o formato é só o padrão.
  // Campeão 3:4 (720x960) forçado em 9:16 cortava as laterais.
  const [natural, setNatural] = useState<[number, number] | null>(null)
  const [w, h] = video?.width && video?.height ? [video.width, video.height] : natural ?? RATIO[format]

  // new file = reset the controls (adjusted during render, not in an effect)
  const [shownUrl, setShownUrl] = useState(video?.url)
  if (shownUrl !== video?.url) {
    setShownUrl(video?.url)
    setPlaying(false)
    setTime(0)
  }

  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = ref.current
    if (!v || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur
  }

  return (
    <div
      className={cn(
        "@container relative overflow-hidden rounded-[10px] bg-[#0d0d0d] [--player-cap:62vh]",
        size === "lg" ? "tablet:[--player-cap:min(72vh,720px)]" : "tablet:[--player-cap:min(64vh,600px)]",
        className
      )}
      style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, calc(var(--player-cap) * ${w} / ${h}))` }}
    >
      {video ? (
        <video
          ref={ref}
          src={video.url}
          poster={poster ?? undefined}
          playsInline
          muted={muted}
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            setTime(e.currentTarget.currentTime)
            onTime?.(e.currentTarget.currentTime)
          }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget
            setDur(el.duration || dur)
            if (el.videoWidth && el.videoHeight) setNatural([el.videoWidth, el.videoHeight])
          }}
          onClick={toggle}
        />
      ) : poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
      {overlay}
      {video && !overlay ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 bg-gradient-to-b from-transparent to-black/75 px-3 pt-6 pb-2.5 text-white">
          <button type="button" onClick={toggle} aria-label={playing ? t("pause") : t("play")} className="grid place-items-center p-1">
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <div className="relative h-3 flex-1 cursor-pointer" onPointerDown={seek} role="slider" aria-label={t("seek")} aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(time)} tabIndex={0}
            onKeyDown={(e) => {
              const v = ref.current
              if (!v) return
              if (e.key === "ArrowRight") v.currentTime = Math.min(dur, v.currentTime + 1)
              if (e.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - 1)
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-[2px] bg-white/25">
              <b className="absolute inset-y-0 left-0 rounded-[2px] bg-white" style={{ width: dur ? `${(time / dur) * 100}%` : 0 }} />
            </div>
          </div>
          {/* tiny players (< 200 px, e.g. the 2-column sample grid on a phone) drop the time so the sound button still fits */}
          <span className="hidden font-mono text-[11px] whitespace-nowrap tabular-nums @[200px]:inline">
            {fmt(time)} / {fmt(dur)}
          </span>
          <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? t("unmute") : t("mute")} aria-pressed={muted} className={cn("grid place-items-center p-1", muted && "opacity-50")}>
            <Icon name="vol" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
