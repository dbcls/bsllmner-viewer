import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"
import { Icon, type IconName } from "./icons"

type ButtonKind = "primary" | "secondary" | "ghost" | "inverse"
type ButtonSize = "xs" | "sm" | "md"

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  kind?: ButtonKind
  size?: ButtonSize
  /** The glyph of the button's action, before its text. */
  icon?: IconName
  /** A glyph after the text, such as the chevron of a button that opens a menu. A block button puts it at its right edge. */
  trailingIcon?: IconName
  /** Fills the width of its container and starts its content at the left, for buttons stacked in a column. */
  block?: boolean
  children: ReactNode
}

const kindClass: Record<ButtonKind, string> = {
  primary: "bg-brand text-white border border-transparent hover:bg-brand-deep",
  secondary: "bg-surface text-ink border border-border-soft hover:bg-brand-soft",
  ghost: "bg-transparent text-brand-deep border border-transparent hover:bg-brand-soft",
  inverse: "bg-ink text-brand-soft border border-ink-mid hover:bg-ink-mid",
}

/** A whole-pixel height, so buttons stacked in a column sit on whole pixels and their text renders alike. */
const sizeClass: Record<ButtonSize, string> = {
  xs: "h-6 px-2.5 text-fs-body-sm",
  sm: "h-7 px-3 text-fs-body-sm",
  md: "h-8 px-4 text-fs-body",
}

/**
 * The classes of a button, for a control that draws its own content in a button's frame. The content puts its text in a
 * `text-trim-cap` span so the capitals sit in the middle of the button.
 */
export const buttonClass = (kind: ButtonKind, size: ButtonSize, block = false): string =>
  cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-button font-sans font-semibold leading-none whitespace-nowrap cursor-pointer",
    block ? "w-full justify-start" : "justify-center",
    kindClass[kind],
    sizeClass[size],
  )

export const Button = ({
  kind = "primary",
  size = "md",
  icon,
  trailingIcon,
  block,
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
    className={cn(buttonClass(kind, size, block), disabled && "cursor-not-allowed opacity-55")}
  >
    {icon && <Icon name={icon} />}
    <span className="text-trim-cap">{children}</span>
    {trailingIcon && <Icon name={trailingIcon} size="sm" className={cn("opacity-60", block ? "ml-auto pl-1" : "-mr-0.5")} />}
  </button>
)
