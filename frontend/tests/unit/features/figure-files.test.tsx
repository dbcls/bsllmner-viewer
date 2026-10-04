import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS, type WorkspaceState } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

const net = vi.hoisted(() => ({ empty: false, hold: false, release: [] as (() => void)[] }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const year = (value: number) => [{ field: "date_published", from: `${value}-01-01`, to: `${value}-12-31` }]
const points = (counts: number[]) => counts.map((count, index) => ({ year: 2019 + index, count, clauses: year(2019 + index) }))
const element = (value: string, count: number) => ({ value, label: `label ${value}`, clauses: [{ field: "disease", value }], count })

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string) => {
    if (net.hold) await new Promise<void>((resolve) => net.release.push(resolve))
    if (path === "/api/dataset") {
      const field = (name: string) => ({ name, multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 1 })
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field("disease"), field("cell_type")], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    if (path === "/api/distribution") {
      return ok({ datasetVersion: VERSION, q: null, unit: "biosample", total: 10, withoutTerm: 4, elements: net.empty ? [] : [element("MONDO:1", 6)] })
    }
    if (path === "/api/crosstab") {
      const count = net.empty ? 0 : 1
      const cell = (row: string, col: string, gap: boolean) => ({ row, col, count: gap ? 0 : 3, expected: 1.5, ratio: gap ? 0 : 2, residual: 1.25, classification: gap ? "gap" : null })
      const rows = net.empty ? [] : [{ ...element("MONDO:1", 5), countExact: 0, countSelected: 0, hasChildren: false, parents: [] }, { ...element("MONDO:2", 4), countExact: 0, countSelected: 0, hasChildren: false, parents: [] }]
      const cols = net.empty ? [] : [{ ...element("UBERON:1", 6), countExact: 0, countSelected: 0, hasChildren: false, parents: [] }]
      return ok({ datasetVersion: VERSION, q: null, populationQ: null, rowField: "disease", colField: "cell_type", unit: "biosample", facetSelfExclude: true, total: count * 9, rows, cols, cells: net.empty ? [] : [cell("MONDO:1", "UBERON:1", false), cell("MONDO:2", "UBERON:1", true)] })
    }
    if (path === "/api/trend") {
      return ok({
        datasetVersion: VERSION,
        q: "disease:D:1",
        unit: "biosample",
        facetSelfExclude: true,
        years: net.empty ? [] : [2019, 2020, 2021],
        firstYear: 2019,
        lastYear: 2021,
        total: net.empty ? [] : points([0, 4, 7]),
        allEntries: net.empty ? [] : points([0, 9, 12]),
        totalPopulationQ: "disease:D:1",
        field: "disease",
        populationQ: "disease:D:1",
        series: net.empty ? [] : [{ value: "D:1", label: "disease one", clauses: [{ field: "disease", value: "D:1" }], points: points([0, 4, 0]) }],
      })
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { DistributionTab } from "~/features/workspace/distribution/distribution-tab"
import { HeatmapTab } from "~/features/workspace/heatmap/heatmap-tab"
import { TREND_LINE } from "~/features/workspace/trend/trend-style"
import { TrendTab } from "~/features/workspace/trend/trend-tab"
import { type Condition, useCondition } from "~/features/workspace/use-condition"

const noUpdate = () => undefined
const latestState = () => DEFAULTS

/** Gives the view the condition of the real hook, for a page without a condition. */
const WithCondition = ({ children }: { children: (condition: Condition) => ReactElement }) => children(useCondition(null, noUpdate, latestState))

type Saved = { name: string; text: string }

/** Reads a Blob the way a browser does; jsdom has no Blob.text. */
const read = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })

describe("the files that the tabs save", () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  let blobs: Blob[]
  let names: string[]

  beforeEach(() => {
    net.empty = false
    net.hold = false
    net.release.length = 0
    blobs = []
    names = []
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob)
      return `blob:${blobs.length}`
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
  })

  afterEach(() => {
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Chooses `format` in the Export menu of the figure and gives the file that is saved. */
  const save = async (figure: string, format: "TSV" | "SVG" | "PNG"): Promise<Saved> => {
    const user = userEvent.setup()
    const button = await screen.findByRole("button", { name: `Export the ${figure}` })
    await vi.waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await user.click(screen.getByRole("menuitem", { name: new RegExp(`^${format}`) }))
    await vi.waitFor(() => expect(names).toHaveLength(1))
    return { name: names[0] as string, text: await read(blobs[0] as Blob) }
  }

  const tsv = (saved: Saved) => saved.text.trimEnd().split("\n").map((line) => line.split("\t"))
  const svgOf = (saved: Saved) => new DOMParser().parseFromString(saved.text, "image/svg+xml")

  describe("Distribution", () => {
    const render = (state: Partial<WorkspaceState> = {}) => renderWithQuery(
      <WithCondition>{(condition) => <DistributionTab state={{ ...DEFAULTS, tab: "distribution", ...state }} condition={condition} onUnit={vi.fn()} onTermIds={vi.fn()} onAlert={vi.fn()} />}</WithCondition>,
    )

    it("saves the TSV with the elements, the part without a term, and the total", async () => {
      render()
      const saved = await save("Disease distribution", "TSV")
      expect(saved.name).toBe("distribution-disease-biosample.tsv")
      expect(tsv(saved)).toEqual([["value", "label", "count"], ["MONDO:1", "label MONDO:1", "6"], ["", "No term", "4"], ["", "Total", "10"]])
    })

    it("saves the SVG with the No term row and the fonts, with the term ID after the label when Term IDs is on", async () => {
      render({ termIds: true })
      const saved = await save("Disease distribution", "SVG")
      expect(saved.name).toBe("distribution-disease-biosample.svg")
      const texts = [...svgOf(saved).querySelectorAll("text")].map((t) => t.textContent)
      expect(texts).toEqual(expect.arrayContaining(["Disease", "BioSamples", "label MONDO:1 MONDO:1", "No term", "4 (40%)"]))
      expect(saved.text).toContain("@font-face")
    })

    it("keeps Export off while the distribution loads, and when no term matches", async () => {
      net.hold = true
      const first = render()
      expect(await screen.findByRole("button", { name: "Export the Disease distribution" })).toBeDisabled()
      first.unmount()
      net.hold = false
      net.empty = true
      render()
      expect(await screen.findAllByText(/have a term in this field/)).not.toHaveLength(0)
      expect(screen.getByRole("button", { name: "Export the Disease distribution" })).toBeDisabled()
    })
  })

  describe("Heatmap", () => {
    const render = (state: Partial<WorkspaceState> = {}) =>
      renderWithQuery(
        <WithCondition>
          {(condition) => <HeatmapTab state={{ ...DEFAULTS, tab: "heatmap", row: "disease", col: "cell_type", ...state }} condition={condition} update={vi.fn()} latest={() => DEFAULTS} replacing={false} setReplacing={vi.fn()} onAlert={vi.fn()} />}
        </WithCondition>,
      )

    it("saves the TSV with the cells and the totals, named without ratio even when Cells is Ratio to expected", async () => {
      render({ color: "ratio" })
      const saved = await save("heatmap", "TSV")
      expect(saved.name).toBe("heatmap-disease-x-cell_type-biosample.tsv")
      const [header, first, second] = tsv(saved)
      expect(header).toEqual(["row", "row_label", "col", "col_label", "count", "expected", "ratio", "residual", "classification", "row_total", "col_total", "total"])
      expect(first).toEqual(["MONDO:1", "label MONDO:1", "UBERON:1", "label UBERON:1", "3", "1.5", "2", "1.25", "", "5", "6", "9"])
      expect(second?.[8]).toBe("gap")
    })

    it("names the SVG with ratio when Cells is Ratio to expected, and writes the term IDs after the row labels", async () => {
      render({ color: "ratio", termIds: true })
      const saved = await save("heatmap", "SVG")
      expect(saved.name).toBe("heatmap-disease-x-cell_type-biosample-ratio.svg")
      const svg = svgOf(saved)
      const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent)
      expect(texts).toEqual(expect.arrayContaining(["Disease by Cell type", "BioSamples, Ratio to expected", "label MONDO:1MONDO:1", "UBERON:1"]))
    })

    it("names the files after the axes in the order that the state has them", async () => {
      render({ row: "cell_type", col: "disease" })
      expect((await save("heatmap", "TSV")).name).toBe("heatmap-cell_type-x-disease-biosample.tsv")
    })

    it("keeps Export off while the heatmap loads, and when nothing matches", async () => {
      net.hold = true
      const first = render()
      expect(await screen.findByRole("button", { name: "Export the heatmap" })).toBeDisabled()
      first.unmount()
      net.hold = false
      net.empty = true
      render()
      await screen.findByText(/match this condition/)
      expect(screen.getByRole("button", { name: "Export the heatmap" })).toBeDisabled()
    })
  })

  describe("Trend", () => {
    const render = (state: Partial<WorkspaceState> = {}) =>
      renderWithQuery(
        <WithCondition>
          {(condition) => (
            <TrendTab state={{ ...DEFAULTS, tab: "trend", q: "disease:D:1", trendField: "disease", trendAll: true, trendCondition: true, ...state }} condition={condition} update={vi.fn()} latest={() => DEFAULTS} replacing={false} setReplacing={vi.fn()} onAlert={vi.fn()} />
          )}
        </WithCondition>,
      )

    it("saves the TSV with a row for each point of each line", async () => {
      render()
      const saved = await save("trend", "TSV")
      expect(saved.name).toBe("trend-disease-biosample.tsv")
      const rows = tsv(saved)
      expect(rows[0]).toEqual(["series", "label", "year", "count"])
      expect(rows).toHaveLength(1 + 3 + 3 + 3)
      expect(rows).toEqual(expect.arrayContaining([["all", "All entries", "2021", "12"], ["condition", "Condition", "2020", "4"], ["D:1", "disease one", "2020", "4"]]))
    })

    it("saves the SVG named by the field and the publication year, with the line widths and radii of the page", async () => {
      render()
      const saved = await save("trend", "SVG")
      expect(saved.name).toBe("trend-disease-biosample.svg")
      const svg = svgOf(saved)
      const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent)
      expect(texts).toEqual(expect.arrayContaining(["Disease by publication year", "BioSamples"]))
      const widths = new Map([...svg.querySelectorAll("polyline")].map((p) => [p.getAttribute("stroke"), Number(p.getAttribute("stroke-width"))]))
      expect([...widths.values()].sort()).toEqual([TREND_LINE.all.width, TREND_LINE.condition.width, TREND_LINE.series.width].sort())
      expect(new Set([...svg.querySelectorAll("circle")].map((c) => Number(c.getAttribute("r"))))).toEqual(new Set([TREND_LINE.all.radius, TREND_LINE.condition.radius, TREND_LINE.series.radius]))
    })

    it("keeps Export off while the trend loads, and when no year has data", async () => {
      net.hold = true
      const first = render()
      expect(await screen.findByRole("button", { name: "Export the trend" })).toBeDisabled()
      first.unmount()
      net.hold = false
      net.empty = true
      render()
      await vi.waitFor(() => expect(screen.getByRole("button", { name: "Export the trend" })).toBeDisabled())
      expect(await screen.findByText(/match this condition|No .* match/)).toBeTruthy()
    })
  })

  describe("PNG", () => {
    const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0))
    const arrayBuffer = Blob.prototype.arrayBuffer

    // jsdom has no image decoding, canvas drawing, or Blob.arrayBuffer, which every browser has.
    beforeEach(() => {
      vi.stubGlobal(
        "Image",
        class {
          src = ""
          decode = async () => undefined
        },
      )
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn(), set fillStyle(_: string) { /* the color is not read */ } } as unknown as CanvasRenderingContext2D)
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob([PIXEL], { type: "image/png" })))
      Blob.prototype.arrayBuffer ??= function (this: Blob) {
        return new Promise<ArrayBuffer>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.readAsArrayBuffer(this)
        })
      }
    })

    afterEach(() => {
      Blob.prototype.arrayBuffer = arrayBuffer
    })

    const view = (tab: string, condition: Condition): ReactElement => {
      const state = { ...DEFAULTS, tab: tab as WorkspaceState["tab"], q: tab === "trend" ? "disease:D:1" : null, row: "disease", col: "cell_type", trendField: "disease", trendAll: true, trendCondition: true }
      if (tab === "distribution") return <DistributionTab state={state} condition={condition} onUnit={vi.fn()} onTermIds={vi.fn()} onAlert={vi.fn()} />
      if (tab === "heatmap") return <HeatmapTab state={state} condition={condition} update={vi.fn()} latest={() => DEFAULTS} replacing={false} setReplacing={vi.fn()} onAlert={vi.fn()} />
      return <TrendTab state={state} condition={condition} update={vi.fn()} latest={() => DEFAULTS} replacing={false} setReplacing={vi.fn()} onAlert={vi.fn()} />
    }

    it.each([
      ["distribution", "Disease distribution", "distribution-disease-biosample.png"],
      ["heatmap", "heatmap", "heatmap-disease-x-cell_type-biosample.png"],
      ["trend", "trend", "trend-disease-biosample.png"],
    ])("saves the PNG of the %s tab with the name of its SVG and the extension png", async (tab, figure, name) => {
      renderWithQuery(<WithCondition>{(condition) => view(tab, condition)}</WithCondition>)
      const saved = await save(figure, "PNG")
      expect(saved.name).toBe(name)
      expect(blobs[0]?.type).toBe("image/png")
    })
  })
})
