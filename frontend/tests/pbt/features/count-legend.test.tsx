import { fc, test } from "@fast-check/vitest"
import { describe, expect, it, vi } from "vitest"

import type { Update } from "~/features/workspace/state"
import type * as Client from "~/lib/api/client"
import { DEFAULTS } from "~/lib/workspace-state"

import { renderWithQuery } from "../../unit/query"

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { failure } = await import("../../unit/query")
  return { ...original, api: { ...original.api, GET: async () => failure(500) } }
})

import { HeatmapTab } from "~/features/workspace/heatmap/heatmap-tab"
import { matrixSvg } from "~/features/workspace/heatmap/matrix-svg"
import type { Condition } from "~/features/workspace/use-condition"
import { countScale, mix, RATIO_STEPS, ratioScale } from "~/lib/color"

type Stop = { color: string; offset: number }

/** The red, green, and blue of a hex color or of an `rgb(r, g, b)` color. */
const rgb = (color: string): number[] => {
  const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color)
  if (match) return match.slice(1).map(Number)
  const hex = color.replace("#", "")
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

/** The color that a gradient draws at t, by the rule of CSS and SVG: linear between the two stops around t. */
const colorAt = (stops: Stop[], t: number): string => {
  const next = stops.findIndex((stop) => stop.offset >= t)
  const to = stops[next === -1 ? stops.length - 1 : next] as Stop
  const from = stops[Math.max(0, (next === -1 ? stops.length : next) - 1)] as Stop
  return to.offset === from.offset ? to.color : mix(from.color, to.color, (t - from.offset) / (to.offset - from.offset))
}

/** The stops of a CSS linear gradient. A stop without a position gets one as CSS gives it: evenly between its neighbors. */
const cssStops = (gradient: string): Stop[] => {
  const parts = [...gradient.matchAll(/(#[0-9A-Fa-f]{6}|rgb\([^)]*\))(?:\s+([\d.]+)%)?/g)]
  const offsets = parts.map((part, index) => (part[2] !== undefined ? Number(part[2]) / 100 : index === 0 ? 0 : index === parts.length - 1 ? 1 : null))
  for (let index = 1; index < offsets.length - 1; index++) {
    if (offsets[index] !== null) continue
    const end = offsets.findIndex((offset, at) => at > index && offset !== null)
    const start = offsets[index - 1] as number
    offsets[index] = start + ((offsets[end] as number) - start) / (end - index + 1)
  }
  return parts.map((part, index) => ({ color: part[1] ?? "", offset: offsets[index] as number }))
}

/** The stops of the gradient of the count legend of a saved figure. */
const svgStops = (): Stop[] => {
  const label = { value: "a", label: "A", total: 1 }
  const markup = matrixSvg({ rowLabels: [label], colLabels: [{ ...label, value: "b" }], cells: [], corner: { row: "R", col: "C" }, total: 1, title: "T", meta: "M", legend: { kind: "count", max: "10" } })
  const svg = new DOMParser().parseFromString(markup, "image/svg+xml")
  return [...svg.querySelectorAll("#count-scale stop")].map((stop) => ({ color: stop.getAttribute("stop-color") ?? "", offset: Number(stop.getAttribute("offset")) }))
}

/** The stops of the gradient of the count legend on the page. */
const pageStops = (): Stop[] => {
  const condition = { isSelected: () => false, toggle: vi.fn(), toggleNarrow: vi.fn() } as unknown as Condition
  const update: Update = vi.fn()
  const { container, unmount } = renderWithQuery(
    <HeatmapTab state={{ ...DEFAULTS, tab: "heatmap" }} condition={condition} update={update} latest={() => DEFAULTS} replacing={false} setReplacing={vi.fn()} onAlert={vi.fn()} />,
  )
  const bar = [...container.querySelectorAll<HTMLElement>("[style]")].find((element) => element.style.background.startsWith("linear-gradient"))
  unmount()
  return cssStops(bar?.style.background ?? "")
}

/** A position on the scale above 0, spread evenly over (0, 1]. */
const position = fc.integer({ min: 1, max: 1000 }).map((step) => step / 1000)

/** Whether two colors differ by at most 1 in each channel, the rounding of `mix`. */
const sameColor = (a: string, b: string): boolean => rgb(a).every((value, index) => Math.abs(value - (rgb(b)[index] ?? 0)) <= 1)

describe("the count legend of the heatmap", () => {
  const legends = { page: pageStops, "saved figure": svgStops }

  for (const [where, read] of Object.entries(legends)) {
    let stopsOf: Stop[] | undefined
    test.prop([position])(`shows at each position of the ${where} the color of a cell at that position of the scale`, (t) => {
      const stops = (stopsOf ??= read())
      expect(stops.length).toBeGreaterThan(1)
      expect(sameColor(colorAt(stops, t), countScale(t)), `${colorAt(stops, t)} at ${t}, cell ${countScale(t)}`).toBe(true)
    })
  }
})

describe("the ratio legend of the heatmap", () => {
  it("shows in each swatch of the saved figure the color of a cell whose ratio is in that step", () => {
    const label = { value: "a", label: "A", total: 1 }
    const markup = matrixSvg({ rowLabels: [label], colLabels: [{ ...label, value: "b" }], cells: [], corner: { row: "R", col: "C" }, total: 1, title: "T", meta: "M", legend: { kind: "ratio" } })
    const svg = new DOMParser().parseFromString(markup, "image/svg+xml")
    const swatchFill = (text: string) => [...svg.querySelectorAll("text")].find((element) => element.textContent === text)?.previousElementSibling?.getAttribute("fill")
    expect(swatchFill(`≤ ${RATIO_STEPS.low}×`)).toBe(ratioScale(RATIO_STEPS.low))
    expect(swatchFill(`< ${RATIO_STEPS.mid}×`)).toBe(ratioScale((RATIO_STEPS.low + RATIO_STEPS.mid) / 2))
    expect(swatchFill(`≥ ${RATIO_STEPS.mid}×`)).toBe(ratioScale(RATIO_STEPS.mid))
    expect(swatchFill(`≥ ${RATIO_STEPS.high}×`)).toBe(ratioScale(RATIO_STEPS.high))
  })
})
