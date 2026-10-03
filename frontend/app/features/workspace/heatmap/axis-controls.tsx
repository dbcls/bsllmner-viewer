import type { Element, TermElement } from "~/lib/api/types"
import { ACTION_ICON, Button, InlineLabel, Select, Skeleton } from "~/ui"

export type AxisSide = "row" | "col"

type AxisControlsProps = {
  side: AxisSide
  dimension: string
  dimensions: { value: string; label: string }[]
  elements: (Element | TermElement)[]
  /** The number of elements on their way, while the cross-tabulation loads for the first time; null once they are known. */
  pending: number | null
  onDimension: (dimension: string) => void
  /** Opens the dialog of the axis's terms. */
  onOpenTerms: () => void
}

/** One axis of the heatmap on one line: its name, its dimension, and a button with the number of elements shown, which opens them in a dialog. */
export const AxisControls = ({ side, dimension, dimensions, elements, pending, onDimension, onOpenTerms }: AxisControlsProps) => {
  const name = side === "row" ? "Rows" : "Columns"
  const count = pending ?? elements.length
  return (
    <span role="group" aria-label={name} className="inline-flex items-center gap-1.5">
      <InlineLabel>{name}</InlineLabel>
      <Select options={dimensions} value={dimension} onChange={onDimension} size="sm" aria-label={`${side === "row" ? "Row" : "Column"} dimension`} />
      <Button kind="secondary" size="sm" icon={ACTION_ICON.openDialog} aria-haspopup="dialog" onClick={onOpenTerms}>
        {pending === null ? (
          count
        ) : (
          <span className="inline-flex w-4 align-middle">
            <Skeleton kind="block" className="h-2.5 w-4" />
          </span>
        )}{" "}
        {count === 1 ? "term" : "terms"}
      </Button>
    </span>
  )
}
