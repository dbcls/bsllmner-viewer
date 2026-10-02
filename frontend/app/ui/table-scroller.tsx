import { createContext, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes, useCallback, useContext, useEffect, useRef, useState } from "react"

import { cn } from "./cn"

/** Whether the table has moved away from its start, so that the frozen column draws its edge. */
const ScrolledBack = createContext(false)

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
export const TableScroller = ({ children }: { children: ReactNode }) => {
  const box = useRef<HTMLDivElement | null>(null)
  const [reach, setReach] = useState({ back: false, on: false })

  // The state changes only when one of the ends is crossed, so a drag does not draw every cell on every pixel.
  const measure = useCallback(() => {
    const element = box.current
    if (!element) return
    const room = element.scrollWidth - element.clientWidth
    const back = element.scrollLeft > 1
    const on = element.scrollLeft < room - 1
    setReach((was) => (was.back === back && was.on === on ? was : { back, on }))
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
      <div ref={box} data-table-scroller="" className="relative overflow-x-auto" onScroll={measure}>
        <ScrolledBack.Provider value={reach.back}>{children}</ScrolledBack.Provider>
      </div>
      {reach.on && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-linear-to-l from-ink/15 to-transparent" />}
    </div>
  )
}

const FROZEN = "sticky left-0 z-10"
const FROZEN_EDGE = "shadow-[6px_0_6px_-6px_rgba(26,23,38,0.35)]"

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
