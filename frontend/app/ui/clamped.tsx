import { type KeyboardEvent, type MouseEvent, type ReactNode, useState } from "react"

import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"

type ClampedProps = {
  /** The items, one per line, each with its own key. */
  items: readonly ReactNode[]
  /** How many items show while the list is closed. */
  shown: number
}

/** A press inside the list stays in it: a table row that opens a page on a press does not see it. */
const keep = (event: MouseEvent | KeyboardEvent) => event.stopPropagation()

/**
 * A list with one item per line that shows its first items and a button for the rest, such as the BioProjects of a
 * BioSample in a table row. An item wider than the list ends with an ellipsis. The button opens the rest in place and closes them again; it is not a link, and the turn of
 * its chevron shows which way it goes. One item left over is shown instead of a button, which would take its line.
 */
export const Clamped = ({ items, shown }: ClampedProps) => {
  const [open, setOpen] = useState(false)
  const rest = items.length - shown
  const cut = rest > 1
  return (
    <div className="flex flex-col items-start gap-1">
      {/* As wide as the cell, so that an item wider than the cell ends with an ellipsis. */}
      <ul className="flex min-w-0 flex-col items-start gap-1 self-stretch">
        {(open || !cut ? items : items.slice(0, shown)).map((item, index) => (
          <li key={index} className="max-w-full truncate">
            {item}
          </li>
        ))}
      </ul>
      {cut && (
        <button
          type="button"
          aria-expanded={open}
          onClick={(event) => {
            keep(event)
            setOpen(!open)
          }}
          onAuxClick={keep}
          onKeyDown={keep}
          className="inline-flex cursor-pointer items-center gap-0.5 font-sans whitespace-nowrap text-fs-label font-semibold text-brand hover:text-brand-deep"
        >
          {open ? "Show less" : `${rest} more`}
          <Icon name={ACTION_ICON.openList} size="sm" className={cn(open && "rotate-180")} />
        </button>
      )}
    </div>
  )
}
