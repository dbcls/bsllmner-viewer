import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { barsSvg } from "~/features/workspace/distribution/bars-svg"
import { matrixSvg } from "~/features/workspace/heatmap/matrix-svg"
import { TREND_LINE } from "~/features/workspace/trend/trend-style"
import { trendSvg } from "~/features/workspace/trend/trend-svg"
import { usedFaces } from "~/lib/figure-fonts"
import { FIGURE_TEXT, type FigureTextRole, TEXT_SIZE, textSize } from "~/lib/figure-style"

const app = (path: string): string => readFileSync(resolve(process.cwd(), "app", path), "utf8")

/** The class names in a text, so that `inline` does not match `inline-flex`. */
const tokens = (text: string) => text.split(/[\s"'`]+/)

const WEIGHT_CLASSES: Record<string, number> = { "font-normal": 400, "font-medium": 500, "font-semibold": 600 }

describe("the text of the saved figures", () => {
  it("has the sizes of the text tokens of the page", () => {
    const tokens = Object.fromEntries([...app("styles/tailwind.css").matchAll(/--text-fs-([a-z-]+):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]))
    for (const [name, size] of Object.entries(TEXT_SIZE)) expect(tokens[name], name).toBe(size)
  })

  describe.each(Object.entries(FIGURE_TEXT) as [FigureTextRole, (typeof FIGURE_TEXT)[FigureTextRole]][])("the role %s", (name, role) => {
    const { screen } = role
    it("is set on the page with the classes of its size, weight, and family", () => {
      const source = app(screen.file)
      expect(source.split("\n").some((line) => screen.classes.every((c) => tokens(line).includes(c))), `${screen.file}: ${screen.classes.join(" ")}`).toBe(true)
      const ancestors = "ancestors" in screen ? screen.ancestors : []
      for (const c of ancestors) expect(tokens(source), c).toContain(c)
      const all: readonly string[] = [...screen.classes, ...ancestors]
      const sizes = all.filter((c) => c.startsWith("text-fs-")).map((c) => c.slice("text-fs-".length))
      expect(sizes.length ? sizes : ["body"], name).toContain(role.size)
      const weights = all.filter((c) => c in WEIGHT_CLASSES).map((c) => WEIGHT_CLASSES[c])
      expect(weights.length ? weights : [400]).toContain(role.weight)
      expect(all.includes("font-mono")).toBe(role.mono)
    })
  })
})

type Effective = { size: number; weight: number; mono: boolean }

/** The font that a text of the figure is drawn with: its own attributes, then those of the elements around it. */
const effective = (element: Element): Effective => {
  const find = (attribute: string) => {
    for (let at: Element | null = element; at; at = at.parentElement) if (at.hasAttribute(attribute)) return at.getAttribute(attribute) as string
    return undefined
  }
  return { size: Number(find("font-size")), weight: Number(find("font-weight") ?? 400), mono: (find("font-family") ?? "").includes("IBM Plex Mono") }
}

const parse = (markup: string) => new DOMParser().parseFromString(markup, "image/svg+xml")
const find = (svg: Document, text: string) => [...svg.querySelectorAll("text, tspan")].find((e) => e.textContent?.trim() === text) as Element

const expectRole = (svg: Document, text: string, role: FigureTextRole) =>
  expect(effective(find(svg, text)), `${text} as ${role}`).toEqual({ size: textSize(role), weight: FIGURE_TEXT[role].weight, mono: FIGURE_TEXT[role].mono })

const matrix = parse(
  matrixSvg({
    rowLabels: [{ value: "r", label: "Row label", id: "MONDO:1", total: 7 }],
    colLabels: [{ value: "c", label: "Column", id: "UBERON:1", total: 8 }],
    cells: [
      { row: "r", col: "c", text: "5", background: "#fff", dark: false, gap: false, soft: false },
    ],
    corner: { row: "Disease", col: "Tissue" },
    total: 9,
    title: "Disease by Tissue",
    meta: "BioProjects, Count",
    legend: { kind: "count", max: "5" },
  }),
)
const gapMatrix = parse(
  matrixSvg({
    rowLabels: [{ value: "r", label: "Row label", total: 7 }],
    colLabels: [{ value: "c", label: "Column", total: 8 }],
    cells: [{ row: "r", col: "c", text: "0", background: "#fff", dark: false, gap: true, soft: false }],
    corner: { row: "Disease", col: "Tissue" },
    total: 9,
    title: "t",
    meta: "m",
    legend: { kind: "ratio" },
  }),
)
const bars = parse(barsSvg("Disease", "BioSamples", [{ label: "asthma", id: "MONDO:2", count: 12 }], { count: 3, total: 20 }))
const lines = [
  { key: "a", label: "All entries", color: "#888", ...TREND_LINE.all, points: [{ year: 2020, count: 1 }, { year: 2021, count: 2 }] },
  { key: "c", label: "Condition", strong: true, id: "X:1", color: "#111", ...TREND_LINE.condition, points: [{ year: 2020, count: 1 }, { year: 2021, count: 2 }] },
]
const trend = parse(trendSvg({ title: "Disease by publication year", unit: "BioSamples", years: [2020, 2021], max: 2, labels: true, lines }))

describe("the saved figures", () => {
  it("draws the Heatmap text with the font of each role", () => {
    expectRole(matrix, "Disease by Tissue", "heading")
    expectRole(matrix, "BioProjects, Count", "meta")
    expectRole(matrix, "Column", "heatColumnLabel")
    expectRole(matrix, "UBERON:1", "termId")
    expectRole(matrix, "MONDO:1", "termId")
    expectRole(matrix, "Row total", "heatHeading")
    expectRole(matrix, "Column total", "heatHeading")
    expectRole(matrix, "5", "heatCell")
    expectRole(matrix, "7", "heatTotal")
    expectRole(matrix, "8", "heatTotal")
    expectRole(matrix, "9", "heatGrandTotal")
    expect(effective([...matrix.querySelectorAll("text")].find((t) => t.textContent?.startsWith("Row label")) as Element)).toEqual({ size: 12, weight: 500, mono: false })
    expectRole(gapMatrix, "0", "heatGapCell")
  })

  it("draws the Distribution text with the font of each role", () => {
    expectRole(bars, "Disease", "heading")
    expectRole(bars, "MONDO:2", "termId")
    expectRole(bars, "12", "barCount")
    expectRole(bars, "No term", "withoutTermLabel")
    expectRole(bars, "3 (15%)", "withoutTermCount")
    expect(effective([...bars.querySelectorAll("text")].find((t) => t.textContent?.startsWith("asthma")) as Element)).toEqual({ size: 13, weight: 400, mono: false })
  })

  it("draws the Trend text with the font of each role", () => {
    expectRole(trend, "Disease by publication year", "heading")
    expectRole(trend, "X:1", "termId")
    expectRole(trend, "2021", "trendTick")
    expect(effective([...trend.querySelectorAll("text")].find((t) => t.textContent === "All entries") as Element)).toEqual({ size: 12, weight: 400, mono: false })
    expect(effective([...trend.querySelectorAll("text")].find((t) => t.textContent?.startsWith("Condition")) as Element)).toEqual({ size: 12, weight: 600, mono: false })
  })

  it("draws the lines of the Trend with the widths and the point radii that the page uses", () => {
    const widths = [...trend.querySelectorAll("polyline")].map((p) => [p.getAttribute("stroke"), Number(p.getAttribute("stroke-width"))])
    expect(widths).toEqual([["#888", TREND_LINE.all.width], ["#111", TREND_LINE.condition.width]])
    expect([...trend.querySelectorAll("circle")].map((c) => Number(c.getAttribute("r")))).toEqual([TREND_LINE.all.radius, TREND_LINE.all.radius, TREND_LINE.condition.radius, TREND_LINE.condition.radius])
  })

  it.each([
    ["Heatmap", matrix],
    ["Heatmap with a gap", gapMatrix],
    ["Distribution", bars],
    ["Trend", trend],
  ])("embeds a face for every family and weight that the %s draws with", (_, svg) => {
    const drawn = new Set([...svg.querySelectorAll("text, tspan")].map(effective).map((e) => `${e.mono ? "IBM Plex Mono" : "Public Sans"} ${e.weight}`))
    const embedded = usedFaces(new XMLSerializer().serializeToString(svg)).map((f) => `${f.family} ${f.weight}`)
    expect(new Set(embedded)).toEqual(drawn)
    expect(embedded).toHaveLength(drawn.size)
  })
})
