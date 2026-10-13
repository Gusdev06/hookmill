import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/* fase2 .btn: 44 px, 12 px radius, bold. brand = lime (one per screen: the step's advance),
   default = ink, outline, ghost, destructive = red outline (spec §2.5, §4) */
const buttonVariants = cva(
  "inline-flex min-w-0 shrink-0 items-center justify-center gap-2 rounded-btn border font-bold whitespace-nowrap transition-[background-color,border-color,color] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        brand: "border-transparent bg-brand text-[#15171a] hover:bg-brand-hover",
        default: "border-transparent bg-primary text-primary-foreground hover:opacity-90",
        outline: "border-line-strong bg-card font-semibold text-fg hover:border-fg",
        ghost: "border-transparent bg-transparent font-semibold text-fg-btn hover:bg-card-2 hover:text-fg",
        destructive: "border-status-failed-edge bg-card font-semibold text-status-failed hover:border-status-failed",
        link: "border-transparent font-semibold text-fg underline-offset-4 hover:text-brand-ink hover:underline",
      },
      size: {
        default: "h-11 px-4 text-sm",
        sm: "h-9 rounded-md px-3 text-[13px]",
        lg: "h-[50px] px-[18px] text-sm",
        icon: "size-11",
        "icon-sm": "size-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "outline",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
