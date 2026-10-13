import type { FileRef } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { Icon } from "@/components/icon"

/** 9:16 frame (mockup .thumb). Signed URLs expire in 6 h, so a plain <img> (no optimizer cache). */
export function Thumb({ file, play, className, children }: { file: FileRef | null; play?: boolean; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative aspect-[9/16] max-w-full overflow-hidden rounded-sm border border-line bg-stage", className)}>
      {file ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.url} alt="" className="block size-full object-cover" loading="lazy" decoding="async" />
      ) : null}
      {play ? (
        <span className="absolute inset-0 grid place-items-center text-white opacity-85">
          <Icon name="play" />
        </span>
      ) : null}
      {children}
    </div>
  )
}
