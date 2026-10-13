import type { SVGProps } from "react"
import { cn } from "@/lib/utils"

/* 16px stroke icons, ported 1:1 from design/mockup-wizard-v1.html */
const PATHS = {
  plus: <path d="M8 3v10M3 8h10" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  chev: <path d="M6 4l4 4-4 4" />,
  chevd: <path d="M4 6l4 4 4-4" />,
  left: <path d="M10 4L6 8l4 4" />,
  refresh: (
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 3v3h-3" />
    </>
  ),
  pencil: <path d="M10.5 3.5l2 2L6 12H4v-2z" />,
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </>
  ),
  star: <path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1 4.6 12.9l.7-3.8L2.5 6.5l3.8-.5z" />,
  link: (
    <>
      <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7" />
      <path d="M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.3v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.5v3.5" />
      <path d="M8 5.2v.1" />
    </>
  ),
  vol: (
    <>
      <path d="M3 6.5h2l3-2.5v8l-3-2.5H3z" />
      <path d="M10.5 6a3 3 0 0 1 0 4" />
    </>
  ),
  arrowr: <path d="M3 8h10M9 4l4 4-4 4" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.8 2 1.8 9 0 11M8 2.5c-1.8 2-1.8 9 0 11" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  minus: <path d="M3 8h10" />,
  upload: (
    <>
      <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5" />
      <path d="M3 13h10" />
    </>
  ),
  branch: (
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 3-7 2-7 4" />
    </>
  ),
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  film: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1" />
      <path d="M5 3v10M11 3v10M2.5 6h2.5M2.5 10h2.5M11 6h2.5M11 10h2.5" />
    </>
  ),
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, className, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-4 flex-none", className)}
      {...props}
    >
      {PATHS[name]}
    </svg>
  )
}
