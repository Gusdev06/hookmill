import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="skeleton" aria-hidden="true" className={cn("sk", className)} {...props} />
}

export { Skeleton }
