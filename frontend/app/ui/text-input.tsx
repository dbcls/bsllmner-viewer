import type { InputHTMLAttributes } from "react"

import { cn } from "./cn"
import { Icon, type IconName } from "./icons"

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "onChange" | "value" | "size"> & {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  mono?: boolean
  size?: "sm" | "md"
  block?: boolean
  widthClass?: string
  /** A glyph inside the start of the box, such as the search glyph of a search box. */
  icon?: IconName
}

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
        "rounded-button border border-border-soft bg-surface text-ink placeholder:text-ink-soft",
        size === "sm" ? "py-1 pr-2 text-fs-label" : "py-1.5 pr-2.5 text-fs-body",
        icon === undefined && (size === "sm" ? "pl-2" : "pl-2.5"),
        icon !== undefined && (size === "sm" ? "pl-7" : "pl-8"),
        mono && "font-mono",
        block && "w-full",
        widthClass,
      )}
    />
  )
  if (icon === undefined) return input
  return (
    <span className={cn("relative", block ? "flex w-full" : "inline-flex")}>
      <span className={cn("pointer-events-none absolute inset-y-0 flex items-center text-ink-soft", size === "sm" ? "left-2" : "left-2.5")}>
        <Icon name={icon} />
      </span>
      {input}
    </span>
  )
}
