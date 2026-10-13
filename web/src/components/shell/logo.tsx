import { cn } from "@/lib/utils"

/** mockup .brand-mark: lime 30 px square, "HM" wide 800 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-grid size-[30px] flex-none place-items-center rounded-sm bg-brand text-[10px] font-extrabold text-[#15171a] [font-stretch:125%]", className)}
      aria-hidden="true"
    >
      HM
    </span>
  )
}

/** Client avatar: first letter on a deep square (mockup .client-av). */
export function ClientAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn("inline-grid size-8 flex-none place-items-center rounded-[9px] bg-[#1e2550] text-sm font-extrabold text-[#e9dfc9]", className)}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || "·"}
    </span>
  )
}
