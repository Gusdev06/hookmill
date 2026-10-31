import { cn } from "@/lib/utils"

/**
 * review 29/10 F9: one way to show "chosen" on a card (fase2 §4 faces, onboarding-v2 ModeCard): ink outline 1.5 px + 1 px ring.
 * Focus is the `--ring` outline. Classes only, no component: the item can be a Radix radio, a checkbox label or a button.
 */
export function choiceCardClass(on: boolean, className?: string) {
  return cn(
    "rounded-lg border-[1.5px] bg-card p-4 text-left outline-none hover:border-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
    on ? "border-fg shadow-[0_0_0_1px_var(--fg)]" : "border-line",
    className
  )
}
