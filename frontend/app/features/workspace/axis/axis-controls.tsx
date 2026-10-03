import { ACTION_ICON, Button, InlineLabel, Select, Skeleton } from "~/ui"

/** What the axis controls read of an element on the axis. */
export type AxisElement = { value: string; label: string }

type AxisControlsProps = {
  /** The name of the axis in the view, such as "Rows" or "Split by". */
  name: string
  /** The accessible name of the dimension's select. */
  selectLabel: string
  dimension: string
  dimensions: { value: string; label: string }[]
  /** The label of a first option that leaves the axis without a dimension, such as "None". */
  placeholder?: string
  elements: readonly AxisElement[]
  /** The number of elements on their way, while the view loads for the first time; null once they are known. */
  pending: number | null
  /** The elements are not known, as the request that lists them failed and the URL names none. */
  unknown?: boolean
  onDimension: (dimension: string) => void
  /** Opens the dialog of the axis's terms. Without it, as on an axis without a dimension, there is no button. */
  onOpenTerms?: () => void
}

/** One axis of a chart view on one line: its name, its dimension, and a button with the number of elements shown, which opens them in a dialog. */
export const AxisControls = ({ name, selectLabel, dimension, dimensions, placeholder, elements, pending, unknown = false, onDimension, onOpenTerms }: AxisControlsProps) => {
  const count = pending ?? elements.length
  return (
    <span role="group" aria-label={name} className="inline-flex items-center gap-1.5">
      <InlineLabel>{name}</InlineLabel>
      <Select
        options={dimensions}
        value={dimension}
        onChange={onDimension}
        size="sm"
        aria-label={selectLabel}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
      {onOpenTerms && (
        <Button kind="secondary" size="sm" icon={ACTION_ICON.openDialog} aria-haspopup="dialog" onClick={onOpenTerms}>
          {unknown ? (
            "–"
          ) : pending === null ? (
            count
          ) : (
            <span className="inline-flex w-4 align-middle">
              <Skeleton kind="block" className="h-2.5 w-4" />
            </span>
          )}{" "}
          {count === 1 ? "term" : "terms"}
        </Button>
      )}
    </span>
  )
}
