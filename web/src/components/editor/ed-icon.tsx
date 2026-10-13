import type { SVGProps } from "react"
import { cn } from "@/lib/utils"

/* 16px stroke icons, ported 1:1 from design/mockup-editor-v1.html */
const P = {
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  left: <path d="M10 4L6 8l4 4" />,
  right: <path d="M6 4l4 4-4 4" />,
  refresh: (<><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 3v3h-3" /></>),
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  alert: (<><path d="M8 2.5l6 10.5H2z" /><path d="M8 6.5v3" /><path d="M8 11.3v.1" /></>),
  info: (<><circle cx="8" cy="8" r="5.5" /><path d="M8 7.5v3.5" /><path d="M8 5.2v.1" /></>),
  undo: (<><path d="M6 3.5L3 6.5l3 3" /><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" /></>),
  redo: (<><path d="M10 3.5l3 3-3 3" /><path d="M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9" /></>),
  lock: (<><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>),
  trimL: (<><path d="M6 3H4v10h2" /><path d="M13 8H8M10 6l-2 2 2 2" /></>),
  trimR: (<><path d="M10 3h2v10h-2" /><path d="M3 8h5M6 6l2 2-2 2" /></>),
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />,
  magnet: (<><path d="M4 2.5v5.5a4 4 0 0 0 8 0V2.5" /><path d="M4 5.5h2.2M9.8 5.5H12" /><path d="M6.2 2.5v5.5a1.8 1.8 0 0 0 3.6 0V2.5" /></>),
  kbd: (<><rect x="1.5" y="4" width="13" height="8" rx="1.5" /><path d="M4.5 6.8h.01M7 6.8h.01M9.5 6.8h.01M12 6.8h.01M5 9.5h6" /></>),
  eye: (<><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>),
  eyeoff: (<><path d="M2.5 2.5l11 11" /><path d="M6.5 4A6.9 6.9 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a12 12 0 0 1-1.6 2.1M10.6 11.8A6 6 0 0 1 8 12.5C4 12.5 1.5 8 1.5 8a11.6 11.6 0 0 1 2.4-2.9" /></>),
  txt: <path d="M3 4h10M8 4v9" />,
  cc: (<><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M5 9.5h6M5 7h3.5" /></>),
  film: (<><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M5.5 2.5v11M10.5 2.5v11M2.5 8h3M10.5 8h3" /></>),
  cta: (<><rect x="1.5" y="5" width="13" height="6" rx="3" /><path d="M5 8h6" /></>),
  endc: (<><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><path d="M5.5 10.5h5" /><path d="M5.5 6h5" /></>),
  safe: (<><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" strokeDasharray="2 2" /><rect x="5" y="4.5" width="6" height="7" rx=".5" /></>),
  exp: (<><path d="M8 10V2.5M5 5.5l3-3 3 3" /><path d="M2.5 10v3.5h11V10" /></>),
  style: (<><path d="M3 13l3.5-9h1L11 13" /><path d="M4.5 9.5h5" /><path d="M12 3.5v5" /></>),
  move: (<><path d="M8 2v12M2 8h12" /><path d="M6 4l2-2 2 2M6 12l2 2 2-2M4 6L2 8l2 2M12 6l2 2-2 2" /></>),
  clock: (<><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></>),
  words: <path d="M2.5 4.5h11M2.5 8h7M2.5 11.5h9" />,
  back: <path d="M10 3.5L5.5 8l4.5 4.5" />,
  pencil: <path d="M10.5 3.5l2 2L6 12H4v-2z" />,
  desktop: (<><rect x="2" y="3" width="12" height="8" rx="1" /><path d="M6 13.5h4M8 11v2.5" /></>),
  globe: (<><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.8 2 1.8 9 0 11M8 2.5c-1.8 2-1.8 9 0 11" /></>),
  users: (<><circle cx="6" cy="6" r="2.2" /><path d="M2.5 13c.4-2.2 1.8-3.4 3.5-3.4s3.1 1.2 3.5 3.4" /><circle cx="11" cy="6.5" r="1.8" /><path d="M10.5 9.7c1.6 0 2.7 1 3 3.3" /></>),
} as const
export type EdIconName = keyof typeof P

export function EdIcon({ name, className, ...rest }: { name: EdIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("size-4 flex-none", className)} {...rest}>
      {P[name]}
    </svg>
  )
}
