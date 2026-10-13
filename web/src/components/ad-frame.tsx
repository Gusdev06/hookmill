/* eslint-disable @next/next/no-img-element -- thumbnails come from signed storage URLs / fixtures, not next/image */
import { NavIcon } from "@/components/shell/nav-icon"
import { cn } from "@/lib/utils"

/*
 * AdFrame (artifact Ads Machine AdFrame): the ad as a phone-ratio frame with the hook caption, a label chip
 * and duration/ratio chips. With `src` it shows the real thumbnail; without it, the placeholder art
 * (tone colors are video content = data, not UI tokens).
 */
export type AdTone = "night" | "dawn" | "plum" | "sage" | "sand" | "ink"
export type AdRatio = "9:16" | "4:5" | "1:1"
export type AdSize = "xs" | "sm" | "md" | "lg"

const TONES: Record<AdTone, { bg: string; orb: string; pillow: string; mask: string }> = {
  night: { bg: "#1E2550", orb: "#E9DFC9", pillow: "#2C3570", mask: "#0E1230" },
  dawn: { bg: "#F2C29A", orb: "#FF8E4D", pillow: "#FBE4CF", mask: "#2B2142" },
  plum: { bg: "#3A2142", orb: "#F3D3E3", pillow: "#50305B", mask: "#170C1C" },
  sage: { bg: "#BFCFB8", orb: "#F6F1E2", pillow: "#E4EBDF", mask: "#22362B" },
  sand: { bg: "#E5D8C3", orb: "#C99A62", pillow: "#F5EDE1", mask: "#1E2550" },
  ink: { bg: "#17191C", orb: "#C8F03C", pillow: "#25282D", mask: "#0B0C0E" },
}
const SIZES: Record<AdSize, { cap: string; chip: string; r: string }> = {
  xs: { cap: "0px", chip: "9px", r: "8px" },
  sm: { cap: "12px", chip: "10px", r: "10px" },
  md: { cap: "16px", chip: "11px", r: "12px" },
  lg: { cap: "22px", chip: "12px", r: "16px" },
}
const RATIOS: Record<AdRatio, string> = { "9:16": "9 / 16", "4:5": "4 / 5", "1:1": "1 / 1" }

export function AdFrame({
  hook,
  tone = "night",
  label,
  duration,
  ratio = "9:16",
  size = "md",
  src,
  alt = "",
  className,
}: {
  hook?: string | null
  tone?: AdTone
  label?: string | null
  /** "0:32" */
  duration?: string | null
  ratio?: AdRatio
  size?: AdSize
  /** real thumbnail; replaces the placeholder art */
  src?: string | null
  alt?: string
  className?: string
}) {
  const t = TONES[tone]
  const s = SIZES[size]
  const chrome = size !== "xs"
  const chip = "rounded-full px-[7px] py-[3px] font-mono font-semibold"
  return (
    <figure
      className={cn("relative m-0 w-full overflow-hidden text-white", className)}
      style={{ aspectRatio: RATIOS[ratio], borderRadius: s.r, background: t.bg }}
    >
      {src ? (
        <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" />
      ) : (
        <>
          <div aria-hidden="true" className="absolute top-[7%] -right-[14%] aspect-square w-[58%] rounded-full" style={{ background: t.orb }} />
          <div aria-hidden="true" className="absolute -inset-x-[15%] -bottom-[8%] h-[38%] rounded-[50%_50%_0_0]" style={{ background: t.pillow }} />
          <div aria-hidden="true" className="absolute inset-x-[8%] bottom-[22.6%] h-[1.6%] rounded-full opacity-55" style={{ background: t.mask }} />
          <div aria-hidden="true" className="absolute bottom-[17%] left-[20%] aspect-[2.7/1] w-[60%] rounded-full" style={{ background: t.mask }} />
        </>
      )}
      {chrome && hook ? (
        <figcaption className="absolute inset-x-[9%] top-[29%] text-center leading-[1.6] font-extrabold text-balance" style={{ fontSize: s.cap }}>
          <span className="rounded-[4px] bg-[#111316] px-1.5 py-0.5 text-white [box-decoration-break:clone]">{hook}</span>
        </figcaption>
      ) : null}
      {chrome && label ? (
        <span className={cn(chip, "absolute top-2 left-2 bg-[rgba(253,253,251,0.94)] text-[#15171a]")} style={{ fontSize: s.chip }}>
          {label}
        </span>
      ) : null}
      {chrome && (duration || ratio) ? (
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-1.5">
          {duration ? (
            <span className={cn(chip, "inline-flex items-center gap-1 bg-[rgba(17,19,22,0.8)]")} style={{ fontSize: s.chip }}>
              <NavIcon name="play" size={9} />
              {duration}
            </span>
          ) : (
            <span />
          )}
          <span className={cn(chip, "bg-[rgba(17,19,22,0.8)]")} style={{ fontSize: s.chip }}>
            {ratio}
          </span>
        </div>
      ) : null}
    </figure>
  )
}
