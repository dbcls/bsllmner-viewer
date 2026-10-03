import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS, type Patch, type WorkspaceState } from "~/lib/workspace-state"

const net = vi.hoisted(() => ({ answered: new Set<string>() }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const label = (value: string) => `label ${value}`

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const ok = new Response("{}")
  const GET = async (path: string, init?: { params?: { query?: Record<string, unknown> } }) => {
    const query = init?.params?.query ?? {}
    if (path === "/api/dataset") {
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 0 }
      const data = { datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] }
      return { data, response: ok }
    }
    if (path === "/api/terms") {
      const terms = ["T:9"].map((termId) => ({ field: "disease", termId, label: label(termId), ontology: "T", path: [], descendantCount: 0, count: 1, matchedSynonym: null, clauses: [] }))
      return { data: { field: "disease", query: "", populationQ: null, unit: "biosample", terms }, response: ok }
    }
    // The first answer of a view arrives; every later one stays on its way, as on a slow network.
    if (net.answered.has(path)) await new Promise(() => undefined)
    net.answered.add(path)
    const element = (value: string) => ({ value, label: label(value), clauses: [{ field: "disease", value }], count: 1 })
    if (path === "/api/trend") {
      const elements = String(query["elements"]).split(",")
      const point = { year: 2020, count: 1, clauses: [] }
      const series = elements.map((value) => ({ value, label: label(value), clauses: [], points: [point] }))
      const data = { datasetVersion: VERSION, q: null, unit: "biosample", facetSelfExclude: true, years: [2020], firstYear: 2020, lastYear: 2020, total: [point], allEntries: [point], totalPopulationQ: null, field: "disease", populationQ: null, series }
      return { data, response: ok }
    }
    if (path === "/api/crosstab") {
      const rows = String(query["rowElements"]).split(",").map((value) => ({ ...element(value), countExact: 0, countSelected: 0, hasChildren: false, parents: [] }))
      const data = { datasetVersion: VERSION, q: null, populationQ: null, rowField: "disease", colField: "library_strategy", unit: "biosample", facetSelfExclude: true, total: 1, rows, cols: [element("RNA-Seq")], cells: [] }
      return { data, response: ok }
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { HeatmapTab } from "~/features/workspace/heatmap/heatmap-tab"
import { TrendTab } from "~/features/workspace/trend/trend-tab"
import type { Condition } from "~/features/workspace/use-condition"

const condition = { isSelected: () => false, toggle: vi.fn(), toggleNarrow: vi.fn() } as unknown as Condition

type View = typeof TrendTab | typeof HeatmapTab

/** A view whose state lives here as it lives in the URL, so that every change of the view reaches the next render. */
const Harness = ({ View, initial, onUpdate, onAlert }: { View: View; initial: WorkspaceState; onUpdate: (patch: Patch) => void; onAlert: (message: string) => void }) => {
  const [state, setState] = useState(initial)
  const update = (patch: Patch) => {
    onUpdate(patch)
    setState((previous) => ({ ...previous, ...patch }))
  }
  return <View state={state} condition={condition} update={update} onAlert={onAlert} />
}

const FIVE = ["T:1", "T:2", "T:3", "T:4", "T:5"]

const renderView = (View: View, initial: Partial<WorkspaceState>) => {
  const onUpdate = vi.fn<(patch: Patch) => void>()
  const onAlert = vi.fn<(message: string) => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Harness View={View} initial={{ ...DEFAULTS, ...initial }} onUpdate={onUpdate} onAlert={onAlert} />
    </QueryClientProvider>,
  )
  return { onUpdate, onAlert }
}

const openTerms = async (user: ReturnType<typeof userEvent.setup>, axis: string) => {
  await user.click(await within(screen.getByRole("group", { name: axis })).findByRole("button", { name: /^\d+ terms$/ }))
  return screen.getByRole("dialog")
}

beforeEach(() => {
  net.answered.clear()
})

describe("TrendTab while the trend of the new terms is on its way", () => {
  it("adds a term after another was taken off, counting the terms that the URL names", async () => {
    const user = userEvent.setup()
    const { onUpdate, onAlert } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: FIVE })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(await within(dialog).findByRole("button", { name: /label T:9/ }))
    expect(onAlert).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenLastCalledWith({ trendTerms: ["T:2", "T:3", "T:4", "T:5", "T:9"] })
  })

  it("keeps a term that was taken off off when another is taken off", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: FIVE })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(within(dialog).getByRole("button", { name: "Remove label T:2" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ trendTerms: ["T:3", "T:4", "T:5"] })
  })
})

describe("HeatmapTab while the cross-tabulation of the new terms is on its way", () => {
  it("keeps a row that was taken off off when another is taken off", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(within(dialog).getByRole("button", { name: "Remove label T:2" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["T:3", "T:4", "T:5"] })
  })
})
