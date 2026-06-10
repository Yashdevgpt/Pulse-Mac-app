import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-16 w-full rounded-xl border border-[var(--lux-border)] bg-[var(--lux-fill)] px-3.5 py-2 text-base text-[var(--lux-text)] transition-[border-color,box-shadow] placeholder:text-[var(--lux-soft)] focus-visible:outline-none focus-visible:border-[var(--lux-gold-border)] focus-visible:shadow-[0_0_0_3px_var(--lux-gold-glow)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = "Textarea"

export { Textarea }
