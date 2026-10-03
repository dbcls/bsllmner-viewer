import { describe, expect, it } from "vitest"

import { type TrendFigure, trendSvg, trendSvgSize } from "~/features/workspace/trend/trend-svg"
import { token } from "~/lib/color"

const points = (counts: number[]) => counts.map((count, index) => ({ year: 2020 + index, count }))

const figure = (overrides: Partial<TrendFigure> = {}): TrendFigure => ({
  title: "Disease by publication year",
  unit: "BioSamples",
  years: [2020, 2021, 2022],
  max: 10,
  labels: false,
  lines: [
    { key: "all", label: "All entries", color: "#888888", width: 2, layer: 1, radius: 3.5, points: points([1, 5, 10]) },
    { key: "a", label: "asthma", id: "MONDO:1", color: "#123456", width: 2, layer: 0, radius: 4, points: points([0, 2, 3]) },
  ],
  ...overrides,
})

const parse = (f: TrendFigure) => new DOMParser().parseFromString(trendSvg(f), "image/svg+xml")

describe("trendSvg", () => {
  it("is well formed and has the size that trendSvgSize gives", () => {
    const f = figure()
    const svg = parse(f).documentElement
    expect(svg.nodeName).toBe("svg")
    expect(Number(svg.getAttribute("height"))).toBe(trendSvgSize(f).height)
    expect(Number(svg.getAttribute("width"))).toBe(960)
  })

  it("starts with a white background rect and writes the heading and the unit", () => {
    const svg = parse(figure())
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe(token("--color-surface"))
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent)
    expect(texts).toContain("Disease by publication year")
    expect(texts).toContain("BioSamples")
  })

  it("lists every line in the legend with its color, and the term ID after the label of a line that has one", () => {
    const svg = parse(figure())
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent)
    expect(texts).toContain("All entries")
    expect(texts).toContain("asthmaMONDO:1")
    const strokes = [...svg.querySelectorAll("line")].map((l) => l.getAttribute("stroke"))
    expect(strokes).toEqual(expect.arrayContaining(["#888888", "#123456"]))
  })

  it("grows the header by a row when the legend wraps", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ key: `k${index}`, label: `a long line name ${index}`, color: "#111111", width: 2, layer: 0, radius: 4, points: points([1, 2, 3]) }))
    expect(trendSvgSize({ lines: many }).height).toBeGreaterThan(trendSvgSize({ lines: many.slice(0, 2) }).height)
  })

  it("writes no attribute for pressing and no mark of a chosen point", () => {
    const markup = trendSvg(figure({ labels: true }))
    expect(markup).not.toMatch(/ (class|role|tabindex|aria-[a-z]+)=/)
    expect(markup).not.toContain("transparent")
  })

  it("writes the data labels in ink-mid over a halo, skips the points at 0, and ends the label of the last year at its point", () => {
    const svg = parse(figure({ labels: true }))
    const labelled = [...svg.querySelectorAll("text[paint-order]")]
    expect(labelled.every((t) => t.getAttribute("fill") === token("--color-ink-mid"))).toBe(true)
    expect(labelled).toHaveLength(5)
    expect(labelled.filter((t) => t.getAttribute("text-anchor") === "end")).toHaveLength(2)
    expect(parse(figure()).querySelectorAll("text[paint-order]")).toHaveLength(0)
  })

  it("draws a line of a higher layer after the others", () => {
    const polylines = [...parse(figure()).querySelectorAll("polyline")].map((p) => p.getAttribute("stroke"))
    expect(polylines).toEqual(["#123456", "#888888"])
  })

  it("writes the label of the line of the condition in the bold weight, and the term ID after a bold label in the regular weight", () => {
    const f = figure({ lines: [{ key: "c", label: "Condition", strong: true, id: "X:1", color: "#111111", width: 3, layer: 2, radius: 4.5, points: points([1, 2, 3]) }] })
    const label = [...parse(f).querySelectorAll("text")].find((t) => t.textContent?.startsWith("Condition"))
    expect(label?.getAttribute("font-weight")).toBe("600")
    expect(label?.querySelector("tspan")?.getAttribute("font-weight")).toBe("400")
  })

  it("escapes the names", () => {
    const svg = parse(figure({ title: "a<b&c" }))
    expect([...svg.querySelectorAll("text")].map((t) => t.textContent)).toContain("a<b&c")
  })
})
