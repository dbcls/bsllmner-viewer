import type { ReactNode } from "react"

import { cn } from "./cn"
import { FOCUS_RING_WITHIN } from "./focus"

type ToggleProps = {
  label: ReactNode
  checked: boolean
  onChange: () => void
  /** The switch is shown but cannot change, as when what it shows or hides is not there. */
  disabled?: boolean
}

/** A switch with its label to the right. */
export const Toggle = ({ label, checked, onChange, disabled = false }: ToggleProps) => (
  <label
    className={cn("inline-flex items-center gap-1.5 text-fs-label select-none", disabled ? "cursor-not-allowed text-ink-softer" : "cursor-pointer text-ink-mid")}
  >
    <span
      className={cn(
        "relative inline-block h-4 w-7 rounded-pill transition-colors",
        checked && !disabled ? "bg-brand" : "bg-border-soft",
        FOCUS_RING_WITHIN,
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform",
          checked && "translate-x-3",
        )}
      />
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} disabled={disabled} className="sr-only" />
    </span>
    {label}
  </label>
)
