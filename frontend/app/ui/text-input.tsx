import type { InputHTMLAttributes } from "react"

import { cn } from "./cn"

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "onChange" | "value" | "size"> & {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  mono?: boolean
  size?: "sm" | "md"
  block?: boolean
  widthClass?: string
}

export const TextInput = ({ value, onChange, onEnter, mono, size = "md", block, widthClass, ...rest }: TextInputProps) => (
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
      size === "sm" ? "px-2 py-1 text-fs-label" : "px-2.5 py-1.5 text-fs-body",
      mono && "font-mono",
      block && "w-full",
      widthClass,
    )}
  />
)
