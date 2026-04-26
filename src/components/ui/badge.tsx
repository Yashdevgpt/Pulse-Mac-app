import * as React from "react"

import { cn } from "@/lib/utils"

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold",
        variant === "default" && "bg-primary text-primary-foreground",
        variant === "outline" && "border border-input bg-background text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Badge }
