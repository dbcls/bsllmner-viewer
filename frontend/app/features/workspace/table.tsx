import type { ReactNode } from "react"

import { cn, FrozenTh } from "~/ui"

/**
 * The cells of a row of a table of the workspace (a row is a `group`). The rule is on the cells rather than the row: the
 * tables have separate borders, which the frozen column needs. The last row has none, so that it does not double the line
 * over the footer.
 */
export const TABLE_CELL = "border-b border-brand-soft px-2.5 py-1.5 group-last:border-b-0"

type ThProps = {
  children: ReactNode
  /** A fixed width for the column, whose header then ends in an ellipsis instead of widening it. */
  width?: string
  /** The column stays put when the table scrolls sideways. */
  frozen?: boolean
  align?: "left" | "right"
}

/** The heading of a column of a table of the workspace. */
export const Th = ({ children, width, frozen = false, align = "left" }: ThProps) => {
  const className = cn(
    "border-b border-border-soft px-2.5 py-2 text-fs-label font-semibold whitespace-nowrap text-ink-soft",
    align === "right" ? "text-right" : "text-left",
    width && cn(width, "truncate"),
  )
  return frozen ? <FrozenTh className={className}>{children}</FrozenTh> : <th className={className}>{children}</th>
}
