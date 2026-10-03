import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import { barsSvg, barsSvgSize } from "~/features/workspace/distribution/bars-svg"

const labelsOf = (rows: Parameters<typeof barsSvg>[2]) =>
  [...new DOMParser().parseFromString(barsSvg("Disease", "BioSamples", rows), "image/svg+xml").querySelectorAll("text")].map((t) => t.textContent)

describe("barsSvg", () => {
  it("writes the term ID after the label of a bar that has one, and only the label of the others", () => {
    const labels = labelsOf([
      { label: "breast cancer", id: "MONDO:0007254", count: 3 },
      { label: "lung cancer", count: 2 },
    ])
    expect(labels).toContain("breast cancer MONDO:0007254")
    expect(labels).toContain("lung cancer")
  })
})

describe("barsSvgSize", () => {
  test.prop([fc.array(fc.record({ label: fc.string({ maxLength: 12 }), count: fc.nat(1_000_000) }), { maxLength: 30 })])(
    "equals the width and the height that barsSvg writes",
    (rows) => {
      const svg = new DOMParser().parseFromString(barsSvg("Disease", "BioSamples", rows), "image/svg+xml").documentElement
      const size = barsSvgSize(rows)
      expect(Number(svg.getAttribute("width"))).toBe(size.width)
      expect(Number(svg.getAttribute("height"))).toBe(size.height)
    },
  )
})
