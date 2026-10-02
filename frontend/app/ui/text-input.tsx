import type { InputHTMLAttributes } from "react"

import { cn } from "./cn"
import { Icon, type IconName } from "./icons"

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "onChange" | "value" | "size"> & {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  mono?: boolean
  /** `lg` is the box that starts a search: taller, with a darker edge, so that it is found first. */
  size?: "sm" | "md" | "lg"
  block?: boolean
  widthClass?: string
  /** A glyph inside the start of the box, such as the search glyph of a search box. */
  icon?: IconName
}

type Size = NonNullable<TextInputProps["size"]>

const SIZE_CLASS: Record<Size, string> = {
  sm: "py-1 pr-2 text-fs-label",
  md: "py-1.5 pr-2.5 text-fs-body",
  lg: "h-10 pr-3 text-fs-body",
}
const PLAIN_START: Record<Size, string> = { sm: "pl-2", md: "pl-2.5", lg: "pl-3" }
const ICON_START: Record<Size, string> = { sm: "pl-7", md: "pl-8", lg: "pl-9" }
const ICON_AT: Record<Size, string> = { sm: "left-2", md: "left-2.5", lg: "left-3" }

export const TextInput = ({ value, onChange, onEnter, mono, size = "md", block, widthClass, icon, ...rest }: TextInputProps) => {
  const input = (
    <input
      {...rest}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && onEnter) {
          event.preventDefault()
          onEnter()
        }
      }}
      className={cn(
        "rounded-button border bg-surface text-ink placeholder:text-ink-soft",
        size === "lg" ? "border-ink-softer focus-visible:border-brand" : "border-border-soft",
        SIZE_CLASS[size],
        icon === undefined ? PLAIN_START[size] : ICON_START[size],
        mono && "font-mono",
        block && "w-full",
        widthClass,
      )}
    />
  )
  if (icon === undefined) return input
  return (
    <span className={cn("relative", block ? "flex w-full" : "inline-flex")}>
      <span className={cn("pointer-events-none absolute inset-y-0 flex items-center text-ink-soft", ICON_AT[size])}>
        <Icon name={icon} />
      </span>
      {input}
    </span>
  )
}
