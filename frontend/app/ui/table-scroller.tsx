import { createContext, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes, useCallback, useContext, useEffect, useRef, useState } from "react"

import { cn } from "./cn"

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]"

/** Whether the table has moved away from its start, so that the frozen column draws its edge. */
const ScrolledBack = createContext(false)

type TableScrollerProps = {
  children: ReactNode
  /** The overflow classes of the box. A table that also scrolls down in a box of limited height passes `overflow-auto` and the height. */
  boxClassName?: string
}

/**
 * The box that scrolls a table wider than itself sideways.
 *
 * The far edge is shaded while more of the table lies that way, so that a reader sees that the table goes on before
 * touching it. Once the table has moved, the frozen first column (`FrozenTh`, `FrozenTd`) draws a shadow on its right
 * edge, so that the cells passing under it do not read as part of it.
 *
 * The table inside uses separate borders (`border-separate border-spacing-0`) with its rules on the cells: a collapsed
 * table paints the borders itself, which leaves the frozen cells without their rules and without the shadow.
 */
export const TableScroller = ({ children, boxClassName = "overflow-x-auto" }: TableScrollerProps) => {
  const box = useRef<HTMLDivElement | null>(null)
  const [reach, setReach] = useState({ back: false, on: false, bare: false })

  // The state changes only when one of the ends is crossed, so a drag does not draw every cell on every pixel.
  const measure = useCallback(() => {
    const element = box.current
    if (!element) return
    const room = element.scrollWidth - element.clientWidth
    const back = element.scrollLeft > 1
    const on = element.scrollLeft < room - 1
    // A box that scrolls and holds nothing to focus is a stop of Tab itself, so the keyboard can scroll it.
    const bare = room > 0 && element.querySelector(FOCUSABLE) === null
    setReach((was) => (was.back === back && was.on === on && was.bare === bare ? was : { back, on, bare }))
  }, [])

  // A wider window, or rows that arrive later, can change how far the table travels.
  useEffect(() => {
    const element = box.current
    if (!element) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [measure])

  return (
    <div className="relative">
      {/* Relative, so that an absolutely placed element inside the table is clipped by this box instead of widening the page. */}
      <div
        ref={box}
        data-table-scroller=""
        {...(reach.bare ? { tabIndex: 0, role: "region", "aria-label": "Scrollable table" } : {})}
        className={cn("peer relative", boxClassName, reach.bare && "focus-visible:outline-none focus-visible:shadow-none")}
        onScroll={measure}
      >
        <ScrolledBack.Provider value={reach.back}>{children}</ScrolledBack.Provider>
      </div>
      {/*
       * A box that the keyboard can stop at fills a card that clips its edges, and its frozen column covers its content,
       * so its focus ring is drawn inside it, over the table.
       */}
      {reach.bare && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 hidden rounded-[3px] shadow-focus-inset outline-2 -outline-offset-3 outline-brand-deep peer-focus-visible:block"
        />
      )}
      {reach.on && <div aria-hidden="true" data-scroll-shade="" className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-linear-to-l from-ink/15 to-transparent" />}
    </div>
  )
}

/**
 * The shadow for the right edge of a frozen first column that a table draws with its own cells: the class while the
 * table has scrolled sideways, and an empty string before.
 */
export const useFrozenEdge = (): string => (useContext(ScrolledBack) ? FROZEN_EDGE : "")

const FROZEN = "sticky left-0 z-10"
const FROZEN_EDGE = "shadow-frozen-edge"

/** A header cell of the frozen first column, painted with the header row's background. */
export const FrozenTh = ({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) => {
  const scrolled = useContext(ScrolledBack)
  return (
    <th {...rest} className={cn(FROZEN, "bg-surface-subtle", scrolled && FROZEN_EDGE, className)}>
      {children}
    </th>
  )
}

/** A body cell of the frozen first column. Its row has `group`, so that the cell follows the row's hover color. */
export const FrozenTd = ({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) => {
  const scrolled = useContext(ScrolledBack)
  return (
    <td {...rest} className={cn(FROZEN, "bg-surface group-hover:bg-brand-soft", scrolled && FROZEN_EDGE, className)}>
      {children}
    </td>
  )
}
