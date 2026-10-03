import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { FigureExport } from "~/features/workspace/figure-export"

const renderExport = () => {
  const callbacks = { onTsv: vi.fn(), onSvg: vi.fn(), onPng: vi.fn() }
  render(<FigureExport figure="Disease distribution" {...callbacks} />)
  return callbacks
}

describe("FigureExport", () => {
  it("is one Export button named after its figure", () => {
    renderExport()
    const button = screen.getByRole("button", { name: "Export the Disease distribution" })
    expect(button).toHaveTextContent("Export")
  })

  it.each([
    ["TSV", "onTsv"],
    ["SVG", "onSvg"],
    ["PNG", "onPng"],
  ] as const)("calls only the export of %s when its item is chosen", async (format, callback) => {
    const user = userEvent.setup()
    const callbacks = renderExport()
    await user.click(screen.getByRole("button", { name: "Export the Disease distribution" }))
    await user.click(screen.getByRole("menuitem", { name: new RegExp(`^${format}`) }))
    for (const [name, mock] of Object.entries(callbacks)) {
      expect(mock).toHaveBeenCalledTimes(name === callback ? 1 : 0)
    }
  })

  it("describes each format in a few words", async () => {
    const user = userEvent.setup()
    renderExport()
    await user.click(screen.getByRole("button", { name: "Export the Disease distribution" }))
    expect(screen.getAllByRole("menuitem").map((element) => element.textContent)).toEqual(["TSVData table", "SVGVector image", "PNGBitmap image"])
  })
})
