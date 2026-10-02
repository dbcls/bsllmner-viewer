import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ACTION_ICON, Icon, ICON_NAMES } from "~/ui/icons"

describe("Icon", () => {
  it.each(ICON_NAMES)("draws %s as a decorative SVG that follows the font size", (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector("svg")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg?.childElementCount).toBeGreaterThan(0)
    expect(svg?.getAttribute("class")).toContain("size-[1.1em]")
  })

  it("draws the small size when asked and keeps the extra classes", () => {
    const { container } = render(<Icon name="external" size="sm" className="ml-1" />)
    const classes = container.querySelector("svg")?.getAttribute("class") ?? ""
    expect(classes).toContain("size-[0.85em]")
    expect(classes).not.toContain("size-[1.1em]")
    expect(classes).toContain("ml-1")
  })
})

describe("ACTION_ICON", () => {
  it("gives every action its own glyph", () => {
    const glyphs = Object.values(ACTION_ICON)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })
})
