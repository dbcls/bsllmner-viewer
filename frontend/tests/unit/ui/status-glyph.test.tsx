import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { STATUS_ORDER, statusInfo } from "~/lib/labels"
import { StatusGlyph, StatusPill } from "~/ui/status-glyph"

describe("StatusGlyph", () => {
  it.each(STATUS_ORDER)("draws %s as a mark of the one size, named by its label", (status) => {
    const { label } = statusInfo(status)
    render(<StatusGlyph status={status} label={label} />)
    const mark = screen.getByRole("img", { name: label }).querySelector("svg")
    expect(mark).toHaveAttribute("viewBox", "0 0 12 12")
    expect(mark?.getAttribute("class")).toContain("size-[0.9em]")
    expect(mark?.childElementCount).toBeGreaterThan(0)
  })

  it("draws an unknown status as the mark of a missing value", () => {
    const { container } = render(<StatusGlyph status="bogus" label="bogus" />)
    const notStated = render(<StatusGlyph status="not_stated" label="Not stated" />).container
    expect(container.querySelector("svg")?.innerHTML).toBe(notStated.querySelector("svg")?.innerHTML)
  })
})

describe("StatusPill", () => {
  it("shows the same mark as the glyph before the label, hidden from assistive technology", () => {
    const pill = render(<StatusPill status="unmapped_rejected" label="Rejected" size="sm" />).container
    const glyph = render(<StatusGlyph status="unmapped_rejected" label="Rejected" />).container
    const mark = pill.querySelector("svg")
    expect(pill.textContent).toBe("Rejected")
    expect(mark).toHaveAttribute("aria-hidden", "true")
    expect(mark?.outerHTML).toBe(glyph.querySelector("svg")?.outerHTML)
  })
})
