import type { ReactNode } from "react"

import { cn } from "./cn"

type ToggleProps = {
  label: ReactNode
  checked: boolean
  onChange: () => void
  title?: string
}

/** A switch with its label to the right. */
export const Toggle = ({ label, checked, onChange, title }: ToggleProps) => (
  <label className="inline-flex cursor-pointer items-center gap-1.5 text-fs-label text-ink-mid select-none" title={title}>
    <span
      className={cn(
        "relative inline-block h-4 w-7 rounded-pill transition-colors",
        checked ? "bg-brand" : "bg-border-soft",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-light has-[:focus-visible]:ring-offset-1",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform",
          checked && "translate-x-3",
        )}
      />
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} className="sr-only" />
    </span>
    {label}
  </label>
)
