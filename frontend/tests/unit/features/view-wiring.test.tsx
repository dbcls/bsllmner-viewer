import { act, fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Update } from "~/features/workspace/state"
import type * as Client from "~/lib/api/client"
import { DEFAULTS, type Patch, type WorkspaceState } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

type Call = { path: string; query: Record<string, unknown> }
const net = vi.hoisted(() => ({ calls: [] as { path: string; query: Record<string, unknown> }[] }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const POPULATION = "population of the figure"

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: Record<string, unknown> } }) => {
    const query = init?.params?.query ?? {}
    net.calls.push({ path, query })
    if (path === "/api/dataset") {
      const field = (name: string) => ({ name, multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 0 })
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field("disease"), field("cell_type")], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    if (path === "/api/terms") return ok({ field: "disease", query: "", populationQ: null, unit: query["unit"], terms: [] })
    const element = (value: string) => ({ value, label: value, clauses: [{ field: "disease", value }], count: 1 })
    if (path === "/api/trend") {
      const point = { year: 2020, count: 1, clauses: [] }
      const series = ["T:1", "T:2"].map((value) => ({ value, label: value, clauses: [], points: [point] }))
      return ok({ datasetVersion: VERSION, q: null, unit: query["unit"], facetSelfExclude: true, years: [2020], firstYear: 2020, lastYear: 2020, total: [point], allEntries: [point], totalPopulationQ: null, field: query["field"], populationQ: POPULATION, series })
    }
    if (path === "/api/crosstab") {
      const rows = ["T:1", "T:2"].map((value) => ({ ...element(value), countExact: 0, countSelected: 0, hasChildren: false, parents: [] }))
      return ok({ datasetVersion: VERSION, q: null, populationQ: POPULATION, rowField: "disease", colField: "library_strategy", unit: query["unit"], facetSelfExclude: true, total: 1, rows, cols: [element("RNA-Seq")], cells: [] })
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { HeatmapTab } from "~/features/workspace/heatmap/heatmap-tab"
import { TrendTab } from "~/features/workspace/trend/trend-tab"
import type { Condition } from "~/features/workspace/use-condition"

const condition = { isSelected: () => false, toggle: vi.fn(), toggleNarrow: vi.fn() } as unknown as Condition

const views = [
  { name: "HeatmapTab", View: HeatmapTab, axis: "Rows", state: { tab: "heatmap", row: "disease", col: "library_strategy" } },
  { name: "TrendTab", View: TrendTab, axis: "Lines", state: { tab: "trend", trendField: "disease" } },
] as const

const renderView = (View: typeof HeatmapTab | typeof TrendTab, state: Partial<WorkspaceState>) => {
  const update = vi.fn<(patch: Patch, options?: { replace?: boolean }) => void>()
  const props = { state: { ...DEFAULTS, ...state }, condition, update: update as unknown as Update, latest: () => ({ ...DEFAULTS, ...state }), replacing: false, setReplacing: vi.fn(), onAlert: vi.fn() }
  renderWithQuery(<View {...props} />)
  return update
}

const termCalls = (): Call[] => net.calls.filter((call) => call.path === "/api/terms")

beforeEach(() => {
  net.calls = []
})

describe.each(views)("$name wiring to the axis terms dialog", ({ View, axis, state }) => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await within(await screen.findByRole("group", { name: axis })).findByRole("button", { name: /^\d+ terms?$/ }))
    return screen.getByRole("dialog")
  }

  it("searches the terms in the unit of the view", async () => {
    const user = userEvent.setup()
    renderView(View, { ...state, unit: "bioproject" })
    await openDialog(user)
    await vi.waitFor(() => expect(termCalls().length).toBeGreaterThan(0))
    expect(termCalls().map((call) => call.query["unit"])).toEqual(termCalls().map(() => "bioproject"))
  })

  it("resolves a pasted label in the unit of the view", async () => {
    const user = userEvent.setup()
    renderView(View, { ...state, unit: "bioproject" })
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole("radio", { name: "Paste list" }))
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Terms to set" }), { target: { value: "some label" } })
    await user.click(within(dialog).getByRole("button", { name: "Replace terms" }))
    await vi.waitFor(() => expect(termCalls().some((call) => call.query["query"] === "some label")).toBe(true))
    const lookups = termCalls().filter((call) => call.query["query"] === "some label")
    expect(lookups.map((call) => call.query["unit"])).toEqual(lookups.map(() => "bioproject"))
  })

  it("counts the terms in the population of the figure, once the figure is drawn", async () => {
    const user = userEvent.setup()
    renderView(View, { ...state, q: 'library_strategy:"RNA-Seq"' })
    await openDialog(user)
    await vi.waitFor(() => expect(termCalls().at(-1)?.query["q"]).toBe(POPULATION))
  })
})

describe.each(views)("$name replacement of a dimension that the dataset lacks", ({ View, state }) => {
  it("writes the dimension of the figure to the URL without a history entry", async () => {
    const lacking = View === HeatmapTab ? { row: "bogus" } : { trendField: "bogus" }
    const update = renderView(View, { ...state, ...lacking, rowTerms: ["T:9"], trendTerms: ["T:9"] })
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    const [patch, options] = update.mock.calls[0] ?? []
    expect(options).toEqual({ replace: true })
    expect(patch).toEqual(View === HeatmapTab ? { row: "disease", rowTerms: null } : { trendField: "disease", trendTerms: null })
  })
})
