import type { TextareaHTMLAttributes } from "react"

import { BOX_FOCUS } from "./box"
import { cn } from "./cn"

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "onChange" | "value"> & {
  value: string
  onChange: (value: string) => void
  mono?: boolean
  /** Fills the height of its container instead of taking it from `rows`, and keeps that height. */
  fill?: boolean
}

/** A textarea, as tall as its rows, with the edge and the focus of a box. */
export const TextArea = ({ value, onChange, mono, fill, ...rest }: TextAreaProps) => (
  <textarea
    {...rest}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className={cn(
      "w-full rounded-button border border-border-soft bg-surface-subtle px-2.5 py-2 text-ink leading-normal",
      fill ? "h-full resize-none" : "resize-y",
      BOX_FOCUS,
      mono ? "font-mono text-fs-body-sm" : "text-fs-body",
    )}
  />
)
