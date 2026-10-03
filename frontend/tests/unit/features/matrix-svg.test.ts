import { describe, expect, it } from "vitest"

import { matrixSvg } from "~/features/workspace/heatmap/matrix-svg"
import { token } from "~/lib/color"

const svgOf = (corner: { row: string; col: string }) =>
  new DOMParser().parseFromString(
    matrixSvg({ rowLabels: [{ value: "a", label: "A", total: 1 }], colLabels: [{ value: "b", label: "B", total: 1 }], cells: [], corner, total: 1 }),
    "image/svg+xml",
  )

/** The text in the corner: the one that starts with the name of the row dimension. */
const cornerOf = (svg: Document, row: string) => [...svg.querySelectorAll("text")].find((t) => t.textContent?.startsWith(`${row} ↓`))

describe("matrixSvg", () => {
  it("names the row dimension and then, after a space, the column dimension on one line, each with its arrow and without a separator", () => {
    const svg = svgOf({ row: "Cell type", col: "Developmental stage" })
    const corner = cornerOf(svg, "Cell type")
    expect(corner?.textContent).toBe("Cell type ↓Developmental stage →")
    const col = corner?.querySelector("tspan")
    expect(col?.textContent).toBe("Developmental stage →")
    expect(Number(col?.getAttribute("dx"))).toBeGreaterThan(0)
    expect([...svg.querySelectorAll("text")].some((t) => t.textContent?.includes("·"))).toBe(false)
  })

  it("writes the text of a soft cell, such as a 0 that is not a gap, in the grey of the page, and other text in ink", () => {
    const cell = { row: "a", col: "b", background: "#FFFFFF", dark: false, gap: false }
    const svg = new DOMParser().parseFromString(
      matrixSvg({
        rowLabels: [{ value: "a", label: "A", total: 1 }],
        colLabels: [
          { value: "b", label: "B", total: 1 },
          { value: "c", label: "C", total: 1 },
        ],
        cells: [
          { ...cell, text: "0", soft: true },
          { ...cell, col: "c", text: "12", soft: false },
        ],
        corner: { row: "R", col: "C" },
        total: 1,
      }),
      "image/svg+xml",
    )
    const fillOf = (text: string) => [...svg.querySelectorAll("text")].find((t) => t.textContent === text)?.getAttribute("fill")
    expect(fillOf("0")).toBe(token("--color-ink-soft"))
    expect(fillOf("12")).toBe(token("--color-ink"))
    expect(token("--color-ink-soft")).not.toBe(token("--color-ink"))
  })

  it("escapes the names in the corner", () => {
    expect(cornerOf(svgOf({ row: "a<b", col: "c&d" }), "a<b")?.textContent).toBe("a<b ↓c&d →")
  })
})
