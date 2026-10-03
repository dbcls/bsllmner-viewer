import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import { distributionRows, WITHOUT_TERM_LABEL } from "~/features/workspace/distribution/table"
import { heatmapRows } from "~/features/workspace/heatmap/table"
import { PNG_SCALE, pngScale } from "~/lib/export"
import { embedFonts, usedFaces } from "~/lib/figure-fonts"
import { cut, figureFileName } from "~/lib/figure-style"

describe("pngScale", () => {
  it("is 4 for the figures of the page", () => {
    expect(pngScale(960, 400)).toBe(PNG_SCALE)
    expect(pngScale(480, 700)).toBe(PNG_SCALE)
  })

  test.prop([fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 1, max: 100_000 })])(
    "keeps the canvas inside its side and area limits and never raises the scale above 4",
    (width, height) => {
      const scale = pngScale(width, height)
      expect(scale).toBeLessThanOrEqual(PNG_SCALE)
      expect(scale).toBeGreaterThan(0)
      expect(Math.floor(width * scale)).toBeLessThanOrEqual(16384)
      expect(Math.floor(height * scale)).toBeLessThanOrEqual(16384)
      expect(Math.floor(width * scale) * Math.floor(height * scale)).toBeLessThanOrEqual(268_435_456)
    },
  )
})

describe("cut", () => {
  test.prop([fc.string({ unit: "binary" }), fc.integer({ min: 2, max: 40 })])("returns at most the length, ends a cut label with an ellipsis, and keeps a short one", (label, length) => {
    const out = cut(label, length)
    expect(Array.from(out).length).toBeLessThanOrEqual(length)
    if (Array.from(label).length <= length) expect(out).toBe(label)
    else expect(out.endsWith("…")).toBe(true)
  })
})

describe("figureFileName", () => {
  it("joins the figure, the fields, the unit, and the variant", () => {
    expect(figureFileName("distribution", ["disease"], "biosample", "tsv")).toBe("distribution-disease-biosample.tsv")
    expect(figureFileName("heatmap", ["disease", "tissue"], "bioproject", "png")).toBe("heatmap-disease-x-tissue-bioproject.png")
    expect(figureFileName("heatmap", ["disease", "tissue"], "sra-experiment", "svg", "ratio")).toBe("heatmap-disease-x-tissue-sra-experiment-ratio.svg")
    expect(figureFileName("trend", ["disease"], "biosample", "svg")).toBe("trend-disease-biosample.svg")
  })
})

describe("distributionRows", () => {
  it("writes the elements, the part without a term, and the total, with the values as they are", () => {
    const rows = distributionRows([{ value: "MONDO:1", label: "asthma", count: 1234567 }], 12, 2000000)
    expect(rows).toEqual([
      ["MONDO:1", "asthma", 1234567],
      ["", WITHOUT_TERM_LABEL, 12],
      ["", "Total", 2000000],
    ])
  })

  it("leaves out the row without a term when the field has none", () => {
    expect(distributionRows([], null, 5)).toEqual([["", "Total", 5]])
    expect(distributionRows([], undefined, 5)).toEqual([["", "Total", 5]])
    expect(distributionRows([], 0, 5)).toHaveLength(2)
  })
})

describe("heatmapRows", () => {
  const rows = [{ value: "r1", label: "R one", count: 10 }]
  const cols = [{ value: "c1", label: "C one", count: 7 }]

  it("writes the unrounded values and the totals of the row, the column, and the table on each row", () => {
    const cell = { row: "r1", col: "c1", count: 3, expected: 200.9234, ratio: 0.93612345, residual: -13.58123, classification: "under" }
    expect(heatmapRows(rows, cols, [cell], 50)).toEqual([["r1", "R one", "c1", "C one", 3, 200.9234, 0.93612345, -13.58123, "under", 10, 7, 50]])
  })

  test.prop([fc.double({ noNaN: true, noDefaultInfinity: true }), fc.nat()])("keeps the number of the api in the row", (expected, count) => {
    const [row] = heatmapRows(rows, cols, [{ row: "r1", col: "c1", count, expected, ratio: null, residual: null }], 1)
    expect(row?.[4]).toBe(count)
    expect(row?.[5]).toBe(expected)
    expect(row?.[6]).toBeNull()
  })
})

describe("embedFonts", () => {
  const markup = '<svg xmlns="http://www.w3.org/2000/svg" font-family="Public Sans, sans-serif"><text font-weight="600">a</text></svg>'

  const names = (svg: string) => usedFaces(svg).map((f) => `${f.family} ${f.weight}`)

  it("chooses the faces by what the markup draws with", () => {
    expect(names('<svg font-family="Public Sans, sans-serif"><text>a</text></svg>')).toEqual(["Public Sans 400"])
    expect(names(markup)).toEqual(["Public Sans 600"])
    expect(names(`${markup.slice(0, -6)}<text font-family="IBM Plex Mono, monospace">1</text></svg>`)).toEqual(["Public Sans 600", "IBM Plex Mono 400"])
    expect(names('<svg><text font-weight="500">a</text><text font-family="IBM Plex Mono, monospace" font-weight="600">1</text></svg>')).toEqual(["Public Sans 500", "IBM Plex Mono 600"])
  })

  it("takes the family and the weight of a tspan from the text around it where the tspan sets none", () => {
    expect(names('<svg><text font-weight="500">a<tspan>b</tspan></text></svg>')).toEqual(["Public Sans 500"])
    expect(names('<svg><text font-weight="500">a<tspan font-family="IBM Plex Mono, monospace">b</tspan></text></svg>')).toEqual(["Public Sans 500", "IBM Plex Mono 500"])
    expect(names('<svg><text font-weight="500">a<tspan font-family="IBM Plex Mono, monospace" font-weight="400">b</tspan></text></svg>')).toEqual(["Public Sans 500", "IBM Plex Mono 400"])
  })

  const family = fc.constantFrom("Public Sans, sans-serif", "IBM Plex Mono, monospace")
  const weight = fc.constantFrom(400, 500, 600)
  const drawn = fc.array(fc.record({ family, weight, nested: fc.boolean() }), { maxLength: 12 })

  test.prop([drawn])("finds exactly the families and weights that the texts set, whether set on a text or on a tspan in it", (items) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-family="Public Sans, sans-serif">${items
      .map((item) => {
        const attributes = `font-family="${item.family}" font-weight="${item.weight}"`
        return item.nested ? `<text font-weight="${item.weight}">a<tspan font-family="${item.family}">b</tspan></text>` : `<text ${attributes}>a</text>`
      })
      .join("")}</svg>`
    const expected = new Set(items.map((item) => `${item.family.startsWith("IBM") ? "IBM Plex Mono" : "Public Sans"} ${item.weight}`))
    // A nested text sets the weight on the text and the family on the tspan: its own text is drawn in the sans.
    for (const item of items) if (item.nested) expected.add(`Public Sans ${item.weight}`)
    expect(new Set(names(svg))).toEqual(expected)
  })

  it("puts a style with a base64 font-face for each face right after the opening tag, and keeps the rest", async () => {
    const out = await embedFonts(markup.replace("<text", '<text font-weight="500">a</text><text'), async () => "AAAA")
    const doc = new DOMParser().parseFromString(out, "image/svg+xml")
    expect(doc.querySelector("parsererror")).toBeNull()
    expect(doc.documentElement.firstElementChild?.nodeName).toBe("style")
    expect(out.match(/@font-face/g)).toHaveLength(2)
    expect(out).toContain("src:url(data:font/woff2;base64,AAAA)")
    expect(out.endsWith('<text font-weight="600">a</text></svg>')).toBe(true)
  })

  it("returns markup without an opening svg tag as it is", async () => {
    expect(await embedFonts("<g><text>a</text></g>", async () => "AAAA")).toBe("<g><text>a</text></g>")
  })

  it("fails when a font cannot be loaded, so that the caller knows the file has no font", async () => {
    await expect(embedFonts(markup, async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline")
  })
})
