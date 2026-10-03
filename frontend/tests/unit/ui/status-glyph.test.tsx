import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { STATUS_ORDER, statusInfo } from "~/lib/labels"
import { StatusGlyph, StatusPill } from "~/ui/status-glyph"

const TONE_TEXT = { brand: "text-brand", "brand-mid": "text-brand-mid", warn: "text-warn-fg", muted: "text-ink-soft", critical: "text-critical-fg" }

describe("StatusGlyph", () => {
  it.each(STATUS_ORDER)("draws %s as a mark of the one size, named by its label", (status) => {
    const { label, mark: shape, tone } = statusInfo(status)
    render(<StatusGlyph mark={shape} tone={tone} label={label} />)
    const mark = screen.getByRole("img", { name: label }).querySelector("svg")
    expect(mark).toHaveAttribute("viewBox", "0 0 12 12")
    expect(mark?.getAttribute("class")).toContain("size-[0.9em]")
    expect(mark?.childElementCount).toBeGreaterThan(0)
  })

  it.each(STATUS_ORDER)("colors %s by its tone", (status) => {
    const { label, mark, tone } = statusInfo(status)
    render(<StatusGlyph mark={mark} tone={tone} label={label} />)
    expect(screen.getByRole("img", { name: label }).className).toContain(TONE_TEXT[tone])
  })
})

describe("StatusPill", () => {
  it("shows the same mark as the glyph before the label, hidden from assistive technology", () => {
    const pill = render(<StatusPill mark="struck" tone="warn" label="Rejected" size="sm" />).container
    const glyph = render(<StatusGlyph mark="struck" tone="warn" label="Rejected" />).container
    const mark = pill.querySelector("svg")
    expect(pill.textContent).toBe("Rejected")
    expect(mark).toHaveAttribute("aria-hidden", "true")
    expect(mark?.outerHTML).toBe(glyph.querySelector("svg")?.outerHTML)
  })
})
