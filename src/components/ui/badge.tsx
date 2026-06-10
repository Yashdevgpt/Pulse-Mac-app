import * as React from "react"

import { cn } from "@/lib/utils"

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        variant === "default" && "border border-[var(--lux-border)] bg-[var(--lux-fill)] text-[var(--lux-text)]",
        variant === "outline" && "border border-[var(--lux-border-strong)] bg-transparent text-[var(--lux-muted)]",
        className
      )}
      {...props}
    />
  )
}

export { Badge }
