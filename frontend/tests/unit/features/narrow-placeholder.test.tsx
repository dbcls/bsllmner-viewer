import { act, fireEvent, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS, type WorkspaceState } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

/** The answers for the condition NEW wait until the test opens the gate, so that the views show the table of OLD meanwhile. */
const net = vi.hoisted(() => ({ gate: null as Promise<void> | null }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const ROW = [{ field: "disease", value: "D:1" }]
const COL = [{ field: "library_strategy", value: "RNA-Seq" }]
const YEAR = [{ field: "date_published", from: "2020-01-01", to: "2020-12-31" }]

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: Record<string, unknown> } }) => {
    const q = String(init?.params?.query?.["q"] ?? "")
    if (path === "/api/dataset") {
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 0 }
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    if (q === "NEW") await net.gate
    const populationQ = `POP-${q}`
    if (path === "/api/crosstab") {
      const row = { value: "D:1", label: "disease one", clauses: ROW, count: 3, countExact: 0, countSelected: 0, hasChildren: false, parents: [] }
      const col = { value: "RNA-Seq", label: "RNA-Seq", clauses: COL, count: 3 }
      const cell = { row: "D:1", col: "RNA-Seq", count: 3, expected: null, ratio: null, classification: null }
      return ok({ datasetVersion: VERSION, q, populationQ, rowField: "disease", colField: "library_strategy", unit: "biosample", facetSelfExclude: true, total: 3, rows: [row], cols: [col], cells: [cell] })
    }
    if (path === "/api/trend") {
      const point = { year: 2020, count: 4, clauses: YEAR }
      const series = [{ value: "D:1", label: "disease one", clauses: ROW, points: [point] }]
      return ok({ datasetVersion: VERSION, q, unit: "biosample", facetSelfExclude: true, years: [2020], firstYear: 2020, lastYear: 2020, total: [point], allEntries: [point], totalPopulationQ: q, field: "disease", populationQ, series })
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { HeatmapTab } from "~/features/workspace/heatmap/heatmap-tab"
import { TrendTab } from "~/features/workspace/trend/trend-tab"
import type { Condition } from "~/features/workspace/use-condition"

const toggleNarrow = vi.fn()
const condition = { isSelected: () => false, toggle: vi.fn(), toggleNarrow } as unknown as Condition

type View = typeof HeatmapTab | typeof TrendTab

const Harness = ({ View, initial }: { View: View; initial: WorkspaceState }) => {
  const [q, setQ] = useState<string | null>(initial.q)
  const state = { ...initial, q }
  return (
    <>
      <button onClick={() => setQ("NEW")}>Change condition</button>
      <View state={state} condition={condition} update={vi.fn()} latest={() => state} replacing={false} setReplacing={vi.fn()} onAlert={vi.fn()} />
    </>
  )
}

const VIEWS: { name: string; View: View; state: Partial<WorkspaceState>; target: () => Promise<HTMLElement>; clauses: unknown[] }[] = [
  {
    name: "a cell of the Heatmap",
    View: HeatmapTab,
    state: { tab: "heatmap", row: "disease", col: "library_strategy" },
    target: () => screen.findByRole("button", { name: /Narrow the condition to this cell/ }),
    clauses: [...ROW, ...COL],
  },
  {
    name: "a point of a line of the Trend",
    View: TrendTab,
    state: { tab: "trend", trendField: "disease", trendCondition: false },
    target: () => screen.findByRole("button", { name: /^disease one, 2020: 4 BioSamples/ }),
    clauses: YEAR,
  },
]

beforeEach(() => {
  net.gate = null
  toggleNarrow.mockClear()
})

describe.each(VIEWS)("$name", ({ View, state, target, clauses }) => {
  const mount = () => renderWithQuery(<Harness View={View} initial={{ ...DEFAULTS, ...state, q: "OLD" }} />)

  it("narrows the condition with the population and the condition of its table", async () => {
    mount()
    fireEvent.click(await target())
    expect(toggleNarrow).toHaveBeenCalledExactlyOnceWith("POP-OLD", expect.arrayContaining(clauses), "OLD")
  })

  it("is not pressable while the table of the previous condition is shown, and narrows again with the new table", async () => {
    let open: () => void = () => undefined
    net.gate = new Promise<void>((resolve) => {
      open = resolve
    })
    mount()
    await target()
    fireEvent.click(screen.getByRole("button", { name: "Change condition" }))
    const shown = await target()
    expect(shown).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(shown)
    expect(toggleNarrow).not.toHaveBeenCalled()
    await act(async () => open())
    await vi.waitFor(async () => expect(await target()).not.toHaveAttribute("aria-disabled", "true"))
    fireEvent.click(await target())
    expect(toggleNarrow).toHaveBeenCalledExactlyOnceWith("POP-NEW", expect.arrayContaining(clauses), "NEW")
  })
})
