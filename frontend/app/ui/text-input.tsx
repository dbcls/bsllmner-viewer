import type { InputHTMLAttributes } from "react"

import { BOX_FOCUS, BOX_SIZE, type BoxSize } from "./box"
import { cn } from "./cn"
import { Icon, type IconName } from "./icons"

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "onChange" | "value" | "size"> & {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  mono?: boolean
  size?: BoxSize
  block?: boolean
  widthClass?: string
  /** A glyph inside the start of the box, such as the search glyph of a search box. */
  icon?: IconName
}

const PADDING: Record<BoxSize, string> = { sm: "px-2", md: "px-2.5" }
/** The text starts after the glyph, which sits where the text starts in a box without one. */
const PADDING_WITH_ICON: Record<BoxSize, string> = { sm: "pr-2 pl-7", md: "pr-2.5 pl-8" }
const ICON_AT: Record<BoxSize, string> = { sm: "left-2", md: "left-2.5" }

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
        BOX_FOCUS,
        BOX_SIZE[size],
        icon === undefined ? PADDING[size] : PADDING_WITH_ICON[size],
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
