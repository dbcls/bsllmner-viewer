import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"

type ButtonKind = "primary" | "secondary" | "ghost"
type ButtonSize = "sm" | "md"

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  kind?: ButtonKind
  size?: ButtonSize
  children: ReactNode
}

const kindClass: Record<ButtonKind, string> = {
  primary: "bg-brand text-white border border-transparent",
  secondary: "bg-surface text-ink border border-border-soft",
  ghost: "bg-transparent text-brand-deep border border-transparent",
}

const sizeClass: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-fs-body-sm",
  md: "px-4 py-2 text-fs-body",
}

export const Button = ({
  kind = "primary",
  size = "md",
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) => (
  <button
    {...rest}
    type={type}
    disabled={disabled}
    aria-disabled={disabled || undefined}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 rounded-button font-sans font-semibold leading-none cursor-pointer",
      kindClass[kind],
      sizeClass[size],
      disabled && "cursor-not-allowed opacity-55",
    )}
  >
    {children}
  </button>
)
