import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-xl border border-[var(--lux-border)] bg-[var(--lux-fill)] px-3.5 py-2 text-base text-[var(--lux-text)] transition-[border-color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[var(--lux-soft)] focus-visible:outline-none focus-visible:border-[var(--lux-gold-border)] focus-visible:shadow-[0_0_0_3px_var(--lux-gold-glow)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
)
Input.displayName = "Input"

export { Input }
