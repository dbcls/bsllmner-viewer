import type { ReactNode } from "react"

import { cn } from "./cn"

type CheckboxRowProps = {
  checked: boolean
  onChange: () => void
  label: ReactNode
  sub?: ReactNode
  count?: ReactNode
}

/** A facet row: a checkbox, its label, and a count at the right edge. */
export const CheckboxRow = ({ checked, onChange, label, sub, count }: CheckboxRowProps) => (
  <label className="flex cursor-pointer items-center justify-between gap-2 py-1 text-fs-body-sm text-ink select-none">
    <span className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex h-3.5 w-3.5 items-center justify-center rounded-badge border text-fs-micro text-white",
          checked ? "border-brand bg-brand" : "border-border-soft bg-surface",
          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-light",
        )}
      >
        {checked ? "✓" : ""}
        <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      </span>
      <span>
        {label}
        {sub && <span className="ml-1 text-fs-label text-ink-soft">{sub}</span>}
      </span>
    </span>
    {count !== undefined && <span className="font-mono text-fs-micro text-ink-soft">{count}</span>}
  </label>
)
