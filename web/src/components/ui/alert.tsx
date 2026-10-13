import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* fase2 .alert: icon + body + actions, 14 px radius; destructive (red) · warning (amber) · success (green) · info/default (blue) */
const alertVariants = cva(
  "flex w-full flex-wrap items-start gap-3 rounded-[14px] border px-4 py-3.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-line bg-card [&>svg]:text-status-progress",
        info: "border-status-progress-edge bg-status-progress-bg [&>svg]:text-status-progress",
        destructive: "border-status-failed-edge bg-status-failed-bg [&>svg]:text-status-failed",
        warning: "border-status-waiting-edge bg-status-waiting-bg [&>svg]:text-status-waiting",
        success: "border-status-approved-edge bg-status-approved-bg [&>svg]:text-status-approved",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-body" className={cn("grid min-w-[200px] flex-1 gap-0.5", className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<"b">) {
  return <b data-slot="alert-title" className={cn("font-semibold", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="alert-description" className={cn("text-fg-2", className)} {...props} />
}

function AlertActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-actions" className={cn("flex flex-wrap gap-2", className)} {...props} />
}

export { Alert, AlertBody, AlertTitle, AlertDescription, AlertActions }
