import { describe, expect, it } from "vitest"

import { matrixSvg, matrixSvgSize, ROW_INDENT } from "~/features/workspace/heatmap/matrix-svg"
import { token } from "~/lib/color"

const base = { title: "Disease by Tissue", meta: "BioSamples, Count", legend: { kind: "count", max: "10" } } as const

const svgOf = (corner: { row: string; col: string }) =>
  new DOMParser().parseFromString(
    matrixSvg({ rowLabels: [{ value: "a", label: "A", total: 1 }], colLabels: [{ value: "b", label: "B", total: 1 }], cells: [], corner, total: 1, ...base }),
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
        ...base,
      }),
      "image/svg+xml",
    )
    const fillOf = (text: string) => [...svg.querySelectorAll("text")].find((t) => t.textContent === text)?.getAttribute("fill")
    expect(fillOf("0")).toBe(token("--color-ink-soft"))
    expect(fillOf("12")).toBe(token("--color-ink"))
    expect(token("--color-ink-soft")).not.toBe(token("--color-ink"))
  })

  it("cuts a long label by code points, with an ellipsis, so that the markup stays well formed", () => {
    const label = `a${"\u{1f600}".repeat(120)}`
    const markup = matrixSvg({
      rowLabels: [{ value: "a", label, total: 1 }],
      colLabels: [{ value: "b", label, total: 1 }],
      cells: [],
      corner: { row: "R", col: "C" },
      total: 1,
      ...base,
    })
    const svg = new DOMParser().parseFromString(markup, "image/svg+xml")
    expect(svg.querySelector("parsererror")).toBeNull()
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent ?? "")
    expect(texts.filter((t) => t.endsWith("…"))).toHaveLength(2)
    expect(() => encodeURIComponent(markup)).not.toThrow()
  })

  it("keeps a label that fits as it is, without an ellipsis", () => {
    const markup = matrixSvg({
      rowLabels: [{ value: "a", label: "r".repeat(22), total: 1 }],
      colLabels: [{ value: "b", label: "c".repeat(10), total: 1 }],
      cells: [],
      corner: { row: "R", col: "C" },
      total: 1,
      ...base,
    })
    expect(markup).toContain(`>${"r".repeat(22)}<`)
    expect(markup).toContain(`>${"c".repeat(10)}<`)
    expect(markup).not.toContain("…")
  })

  it("escapes the names in the corner", () => {
    expect(cornerOf(svgOf({ row: "a<b", col: "c&d" }), "a<b")?.textContent).toBe("a<b ↓c&d →")
  })

  it("writes the term ID of a row after its label on the same line, and the term ID of a column under its label", () => {
    const svg = new DOMParser().parseFromString(
      matrixSvg({
        rowLabels: [
          { value: "MONDO:1", label: "Disease one", id: "MONDO:1", total: 1 },
          { value: "MONDO:2", label: "Disease two", total: 1 },
        ],
        colLabels: [{ value: "UBERON:1", label: "blood", id: "UBERON:1", total: 1 }],
        cells: [],
        corner: { row: "Disease", col: "Assay" },
        total: 1,
        ...base,
      }),
      "image/svg+xml",
    )
    const rowText = [...svg.querySelectorAll("text")].find((t) => t.textContent?.startsWith("Disease one"))
    expect(rowText?.textContent).toBe("Disease oneMONDO:1")
    expect(rowText?.querySelector("tspan")?.textContent).toBe("MONDO:1")
    expect([...svg.querySelectorAll("text")].some((t) => t.textContent === "MONDO:2")).toBe(false)
    expect([...svg.querySelectorAll("text")].find((t) => t.textContent === "Disease two")?.querySelector("tspan")).toBeNull()
    const column = [...svg.querySelectorAll("text")].find((t) => t.textContent === "UBERON:1")
    const label = [...svg.querySelectorAll("text")].find((t) => t.textContent === "blood")
    expect(Number(column?.getAttribute("y"))).toBeGreaterThan(Number(label?.getAttribute("y")))
  })

  it("widens the columns so that the longest term ID under a column label keeps room on each side, and keeps them otherwise", () => {
    const corner = { row: "Disease", col: "Tissue" }
    const plain = { rowLabels: [{ value: "a", label: "A", total: 1 }], colLabels: [{ value: "b", label: "B", total: 1 }], legend: base.legend, title: base.title, meta: base.meta, corner }
    const withId = { rowLabels: plain.rowLabels, legend: base.legend, title: base.title, meta: base.meta, corner, colLabels: [{ value: "UBERON:0000178", label: "blood", id: "UBERON:0000178", total: 1 }] }
    expect(matrixSvgSize(withId).width).toBeGreaterThan(matrixSvgSize(plain).width)
    const svg = new DOMParser().parseFromString(matrixSvg({ ...withId, cells: [], corner, total: 1, ...base }), "image/svg+xml")
    const cell = svg.querySelectorAll("rect")[1]
    expect(Number(cell?.getAttribute("width"))).toBeGreaterThanOrEqual(Math.ceil("UBERON:0000178".length * 11 * 0.6) + 16)
  })
})

describe("matrixSvg heading, legend, and outputs", () => {
  const parse = (data: Partial<Parameters<typeof matrixSvg>[0]> = {}) =>
    new DOMParser().parseFromString(
      matrixSvg({
        rowLabels: [{ value: "a", label: "A", total: 1 }],
        colLabels: [{ value: "b", label: "B", total: 1 }],
        cells: [{ row: "a", col: "b", text: "1", background: "#FFFFFF", dark: false, gap: true, soft: false }],
        corner: { row: "R", col: "C" },
        total: 1,
        ...base,
        ...data,
      }),
      "image/svg+xml",
    )
  const texts = (svg: Document) => [...svg.querySelectorAll("text")].map((t) => t.textContent)

  it("writes the name of the figure and what the cells count on the heading line", () => {
    const list = texts(parse({ title: "Disease by Tissue", meta: "BioProjects, Ratio to expected" }))
    expect(list).toContain("Disease by Tissue")
    expect(list).toContain("BioProjects, Ratio to expected")
  })

  it("draws the count scale as a gradient between 0 and the largest count, and the gap swatch", () => {
    const svg = parse({ legend: { kind: "count", max: "1,234" } })
    expect(svg.querySelector("linearGradient")?.querySelectorAll("stop")).toHaveLength(4)
    expect(texts(svg)).toEqual(expect.arrayContaining(["0", "1,234", "Gap"]))
  })

  it("draws the four steps of the ratio scale and the gap swatch", () => {
    const list = texts(parse({ legend: { kind: "ratio" } }))
    expect(list).toEqual(expect.arrayContaining(["≤ 0.5×", "< 2×", "≥ 2×", "≥ 4×", "Gap"]))
    expect(parse({ legend: { kind: "ratio" } }).querySelector("linearGradient")).toBeNull()
  })

  it("keeps the legend inside the figure however few the columns are", () => {
    const rowLabels = [{ value: "a", label: "A", total: 1 }]
    const colLabels = [{ value: "b", label: "B", total: 1 }]
    const { width } = matrixSvgSize({ rowLabels, colLabels, legend: { kind: "ratio" }, title: base.title, meta: base.meta, corner: { row: "R", col: "C" } })
    const svg = parse({ legend: { kind: "ratio" } })
    const rects = [...svg.querySelectorAll("rect")]
    expect(Math.max(...rects.map((r) => Number(r.getAttribute("x") ?? 0) + Number(r.getAttribute("width") ?? 0)))).toBeLessThanOrEqual(width)
    expect(rects.some((r) => r.getAttribute("fill") === "url(#count-scale)")).toBe(false)
  })

  it("moves the label of a nested row right by its depth times the indent of the page, and widens the room for the labels", () => {
    const flat = [{ value: "a", label: "A", total: 1 }]
    const nested = [{ value: "a", label: "A", total: 1 }, { value: "c", label: "Child", total: 1, depth: 2 }]
    const legend = base.legend
    const corner = { row: "R", col: "C" }
    const xOf = (svg: Document, text: string) => Number([...svg.querySelectorAll("text")].find((t) => t.textContent === text)?.getAttribute("x"))
    const svg = parse({ rowLabels: nested })
    expect(xOf(svg, "Child") - xOf(svg, "A")).toBe(2 * ROW_INDENT)
    expect(matrixSvgSize({ rowLabels: nested, colLabels: [], legend, title: base.title, meta: base.meta, corner }).width).toBeGreaterThanOrEqual(matrixSvgSize({ rowLabels: flat, colLabels: [], legend, title: base.title, meta: base.meta, corner }).width)
  })

  it("keeps no mark of a chosen cell and no class, role, or tabindex of the page", () => {
    const markup = matrixSvg({ rowLabels: [{ value: "a", label: "A", total: 1 }], colLabels: [{ value: "b", label: "B", total: 1 }], cells: [], corner: { row: "R", col: "C" }, total: 1, ...base })
    expect(markup).not.toMatch(/ (class|role|tabindex|aria-[a-z]+)=/)
  })

  it("starts the left edge of the heading and of the table at the same x", () => {
    const svg = parse()
    const xOf = (text: string) => [...svg.querySelectorAll("text")].find((t) => t.textContent?.startsWith(text))?.getAttribute("x")
    expect(xOf("Disease by Tissue")).toBe(xOf("R ↓"))
    expect(xOf("Column total")).toBe(xOf("R ↓"))
  })
})

describe("matrixSvg labels", () => {
  const rows = (labels: string[]) => labels.map((label, index) => ({ value: `r${index}`, label, total: 1 }))
  const draw = (rowLabels: ReturnType<typeof rows>, colLabels: ReturnType<typeof rows>) =>
    new DOMParser().parseFromString(matrixSvg({ rowLabels, colLabels, cells: [], corner: { row: "R", col: "C" }, total: 1, ...base }), "image/svg+xml")
  const texts = (svg: Document) => [...svg.querySelectorAll("text")].map((t) => t.textContent)

  it("writes the whole of a row label that is longer than the old room of 22 characters", () => {
    expect(texts(draw(rows(["systemic lupus erythematosus", "chronic obstructive pulmonary disease"]), rows(["B"])))).toEqual(expect.arrayContaining(["systemic lupus erythematosus", "chronic obstructive pulmonary disease"]))
  })

  it("wraps a column label into lines in tspans and writes all the words", () => {
    const svg = draw(rows(["A"]), rows(["bone marrow stromal cell line"]))
    const label = [...svg.querySelectorAll("text")].find((t) => t.querySelector("tspan[dy]"))
    expect(label?.textContent?.replaceAll(" ", "")).toBe("bonemarrowstromalcellline".replaceAll(" ", ""))
    expect(label?.querySelectorAll("tspan").length).toBeGreaterThan(1)
    expect(label?.querySelectorAll("tspan").length).toBeLessThanOrEqual(3)
  })

  it("ends a column label of more than three lines with an ellipsis and keeps the top of the header below the heading", () => {
    const svg = draw(rows(["A"]), rows(["word ".repeat(40).trim()]))
    const label = [...svg.querySelectorAll("text")].find((t) => t.querySelector("tspan[dy]"))
    expect(label?.querySelectorAll("tspan")).toHaveLength(3)
    expect(label?.textContent?.endsWith("…")).toBe(true)
    expect(Number(label?.getAttribute("y"))).toBeGreaterThan(32)
  })

  it("cuts a row label that passes the widest room for the labels, and widens the room up to it", () => {
    const long = "x".repeat(200)
    const svg = draw(rows([long]), rows(["B"]))
    expect(texts(svg).some((t) => t?.endsWith("…") && t.length < 200)).toBe(true)
    const short = matrixSvgSize({ rowLabels: rows(["x"]), colLabels: rows(["B"]), legend: base.legend, title: base.title, meta: base.meta, corner: { row: "R", col: "C" } }).width
    const wide = matrixSvgSize({ rowLabels: rows(["x".repeat(40)]), colLabels: rows(["B"]), legend: base.legend, title: base.title, meta: base.meta, corner: { row: "R", col: "C" } }).width
    expect(wide).toBeGreaterThan(short)
  })
})
