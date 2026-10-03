import { type ReactNode, useId } from "react"

import { cn } from "./cn"
import { FOCUS_RING_WITHIN } from "./focus"

type CheckboxRowProps = {
  checked: boolean
  onChange: () => void
  label: ReactNode
  sub?: ReactNode
  count?: ReactNode
}

/**
 * A facet row: a checkbox, its label, and a count at the right edge. The name of the checkbox is the label, and the count
 * is its description, so that the name stays the same while the count changes; the check mark is only for the eye.
 */
export const CheckboxRow = ({ checked, onChange, label, sub, count }: CheckboxRowProps) => {
  const countId = useId()
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-1 text-fs-body-sm text-ink select-none">
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-3.5 w-3.5 items-center justify-center rounded-badge border text-fs-micro text-white",
            checked ? "border-brand bg-brand" : "border-border-soft bg-surface",
            FOCUS_RING_WITHIN,
          )}
        >
          <span aria-hidden="true">{checked ? "✓" : ""}</span>
          <input type="checkbox" checked={checked} onChange={onChange} aria-describedby={count === undefined ? undefined : countId} className="sr-only" />
        </span>
        <span>
          {label}
          {sub && <span className="ml-1 text-fs-label text-ink-soft">{sub}</span>}
        </span>
      </span>
      {/* Hidden from the name of the checkbox, and read as its description through aria-describedby. */}
      {count !== undefined && (
        <span id={countId} aria-hidden="true" className="font-mono text-fs-micro text-ink-soft">
          {count}
        </span>
      )}
    </label>
  )
}
