import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FrozenTd, FrozenTh, TableScroller } from "~/ui/table-scroller"

afterEach(() => {
  vi.restoreAllMocks()
})

const renderTable = () => {
  const view = render(
    <TableScroller>
      <table>
        <thead>
          <tr>
            <FrozenTh>BioSample</FrozenTh>
            <th>Title</th>
          </tr>
        </thead>
        <tbody>
          <tr className="group">
            <FrozenTd>SAMD00000001</FrozenTd>
            <td>a sample</td>
          </tr>
        </tbody>
      </table>
    </TableScroller>,
  )
  const scroller = view.container.querySelector<HTMLElement>("[data-table-scroller]")
  if (!scroller) throw new Error("no scroller")
  Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 1000 })
  Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 400 })
  const scrollTo = (left: number) => {
    scroller.scrollLeft = left
    fireEvent.scroll(scroller)
  }
  const shade = () => view.container.querySelector("[data-scroll-shade]")
  const edges = () => [screen.getByRole("columnheader", { name: "BioSample" }), screen.getByRole("cell", { name: "SAMD00000001" })].map((cell) => cell.className.includes("shadow-"))
  return { scroller, scrollTo, shade, edges }
}

describe("TableScroller", () => {
  it("shades the far edge while the table goes on, and draws the frozen edge only once the table has moved", () => {
    const { scrollTo, shade, edges } = renderTable()
    scrollTo(0)
    expect(shade()).not.toBeNull()
    expect(edges()).toEqual([false, false])

    scrollTo(300)
    expect(shade()).not.toBeNull()
    expect(edges()).toEqual([true, true])

    scrollTo(600)
    expect(shade()).toBeNull()
    expect(edges()).toEqual([true, true])

    scrollTo(0)
    expect(edges()).toEqual([false, false])
  })

  it("keeps the frozen cells at the left edge, the header cell on the header color and the body cell on the row's hover color", () => {
    renderTable()
    const header = screen.getByRole("columnheader", { name: "BioSample" }).className
    const body = screen.getByRole("cell", { name: "SAMD00000001" }).className
    expect(header).toContain("sticky")
    expect(header).toContain("bg-surface-subtle")
    expect(body).toContain("sticky")
    expect(body).toContain("group-hover:bg-brand-soft")
  })
})

describe("TableScroller edges", () => {
  it("measures again when the observer reports a new size of the box", () => {
    let report: () => void = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          report = callback
        }
        observe = vi.fn()
        disconnect = vi.fn()
      },
    )
    const { scroller, scrollTo, shade } = renderTable()
    scrollTo(0)
    expect(shade()).not.toBeNull()
    expect(scroller).toHaveAttribute("tabindex", "0")
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 400 })
    act(() => report())
    expect(shade()).toBeNull()
    expect(scroller).not.toHaveAttribute("tabindex")
  })

  it("draws the frozen edge only after more than 1 pixel and drops the shade within 1 pixel of the far end", () => {
    const { scrollTo, shade, edges } = renderTable()
    scrollTo(1)
    expect(edges()).toEqual([false, false])
    scrollTo(2)
    expect(edges()).toEqual([true, true])
    scrollTo(598)
    expect(shade()).not.toBeNull()
    scrollTo(599)
    expect(shade()).toBeNull()
  })
})

describe("TableScroller keyboard scrolling", () => {
  const renderBox = (wide: boolean, withLink: boolean) => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(wide ? 1000 : 400)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400)
    const view = render(
      <TableScroller>
        <table>
          <tbody>
            <tr>
              <td>{withLink ? <a href="#x">link</a> : "empty"}</td>
            </tr>
          </tbody>
        </table>
      </TableScroller>,
    )
    return view.container.querySelector<HTMLElement>("[data-table-scroller]") as HTMLElement
  }

  it("becomes a named stop of Tab when it scrolls and holds nothing to focus", () => {
    const box = renderBox(true, false)
    expect(box).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("region", { name: "Scrollable table" })).toBe(box)
  })

  it("adds no stop when it does not scroll or when a link inside takes the focus", () => {
    expect(renderBox(false, false)).not.toHaveAttribute("tabindex")
    cleanup()
    expect(renderBox(true, true)).not.toHaveAttribute("tabindex")
  })
})
