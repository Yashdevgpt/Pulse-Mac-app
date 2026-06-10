import * as React from "react"

import { cn } from "@/lib/utils"

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm"
}

type ButtonVariantOptions = {
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
  className?: string
}

const buttonVariants = ({
  variant = "default",
  size = "default",
  className,
}: ButtonVariantOptions = {}) =>
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    variant === "default" && "",
    variant === "outline" && "",
    variant === "ghost" && "hover:bg-[var(--lux-fill)]",
    size === "default" && "h-10 px-4 py-2",
    size === "sm" && "h-9 rounded-md px-3",
    size === "lg" && "h-11 rounded-md px-8",
    size === "icon" && "size-10",
    size === "icon-sm" && "size-8",
    className
  )

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
)
Button.displayName = "Button"

export { Button, buttonVariants }
