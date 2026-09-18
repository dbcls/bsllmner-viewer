import type { TextareaHTMLAttributes } from "react"

import { cn } from "./cn"

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "onChange" | "value"> & {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  mono?: boolean
}

/** A textarea; Ctrl/Cmd+Enter calls onSubmit. */
export const TextArea = ({ value, onChange, onSubmit, mono, ...rest }: TextAreaProps) => (
  <textarea
    {...rest}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onKeyDown={(event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && onSubmit) {
        event.preventDefault()
        onSubmit()
      }
    }}
    className={cn(
      "w-full resize-y rounded-button border border-border-soft bg-surface-subtle px-2.5 py-2 text-ink leading-normal",
      mono ? "font-mono text-fs-body-sm" : "text-fs-body",
    )}
  />
)
