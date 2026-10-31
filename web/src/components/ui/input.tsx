import * as React from "react"
import { cn } from "@/lib/utils"

/* fase2 .inp: white field, line-strong border, 10px radius, 44px; focus = info border + soft ring */
export const fieldClass =
  "w-full min-w-0 rounded-md border border-line-strong bg-field px-3 py-[9px] text-sm max-tablet:min-h-10 text-fg outline-none placeholder:text-fg-3 focus-visible:border-info focus-visible:shadow-[0_0_0_3px_var(--info-bg)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-failed"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldClass, "h-11", className)} {...props} />
}

export { Input }
