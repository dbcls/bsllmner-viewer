import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { FrozenTd, FrozenTh, TableScroller } from "~/ui/table-scroller"

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
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
  const shade = () => view.container.querySelector("[aria-hidden='true']")
  const edges = () => [screen.getByRole("columnheader", { name: "BioSample" }), screen.getByRole("cell", { name: "SAMD00000001" })].map((cell) => cell.className.includes("shadow-"))
  return { scrollTo, shade, edges }
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
