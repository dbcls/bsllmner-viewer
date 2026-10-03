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

describe("barsSvg labels", () => {
  const textsOf = (rows: Parameters<typeof barsSvg>[2]) =>
    [...new DOMParser().parseFromString(barsSvg("Disease", "BioSamples", rows), "image/svg+xml").querySelectorAll("text")].map((t) => t.textContent ?? "")

  it("cuts a label that would pass the right edge, with an ellipsis, and keeps a label that fits", () => {
    const long = "x".repeat(120)
    const list = textsOf([{ label: long, count: 1 }, { label: "short", count: 1 }])
    expect(list.find((t) => t.endsWith("…"))?.length).toBeLessThan(long.length)
    expect(list).toContain("short")
  })

  it("leaves room for the term ID after the label", () => {
    const withId = textsOf([{ label: "y".repeat(120), id: "MONDO:0007254", count: 1 }]).find((t) => t.includes("MONDO:0007254")) ?? ""
    const without = textsOf([{ label: "y".repeat(120), count: 1 }]).find((t) => t.endsWith("…")) ?? ""
    expect(withId.replace(" MONDO:0007254", "").length).toBeLessThan(without.length)
  })

  it("writes the heading, the unit, and fonts as attributes without a class", () => {
    const markup = barsSvg("Disease", "BioSamples", [{ label: "a", count: 1 }])
    expect(markup).toContain(">Disease<")
    expect(markup).toContain(">BioSamples<")
    expect(markup).not.toContain("class=")
  })
})

describe("barsSvg without a term", () => {
  const texts = (withoutTerm: Parameters<typeof barsSvg>[3]) =>
    [...new DOMParser().parseFromString(barsSvg("Disease", "BioSamples", [{ label: "a", count: 3 }], withoutTerm), "image/svg+xml").querySelectorAll("text")].map((t) => t.textContent)

  it("writes the No term row with the count and the percentage under the bars", () => {
    expect(texts({ count: 2209, total: 2903 })).toEqual(expect.arrayContaining(["No term", "2,209 (76%)"]))
  })

  it("writes no No term row when the field has no part without a term", () => {
    expect(texts(null)).not.toContain("No term")
    expect(texts(null)).toHaveLength(4)
  })

  it("makes the figure taller by the row, and writes the size that barsSvgSize gives", () => {
    const rows = [{ label: "a", count: 3 }]
    const withTerm = { count: 1, total: 4 }
    expect(barsSvgSize(rows, withTerm).height).toBeGreaterThan(barsSvgSize(rows).height)
    const svg = new DOMParser().parseFromString(barsSvg("Disease", "BioSamples", rows, withTerm), "image/svg+xml").documentElement
    expect(Number(svg.getAttribute("height"))).toBe(barsSvgSize(rows, withTerm).height)
  })
})
