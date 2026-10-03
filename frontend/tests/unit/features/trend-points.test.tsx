import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const year = (value: number) => [{ field: "date_published", from: `${value}-01-01`, to: `${value}-12-31` }]
const points = (counts: number[]) => counts.map((count, index) => ({ year: 2019 + index, count, clauses: year(2019 + index) }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string) => {
    if (path === "/api/dataset") {
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 0 }
      const data = { datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] }
      return ok(data)
    }
    if (path === "/api/trend") {
      const series = [{ value: "D:1", label: "disease one", clauses: [{ field: "disease", value: "D:1" }], points: points([0, 4, 0]) }]
      const data = {
        datasetVersion: VERSION,
        q: "disease:D:1",
        unit: "biosample",
        facetSelfExclude: true,
        years: [2019, 2020, 2021],
        firstYear: 2019,
        lastYear: 2021,
        total: points([0, 4, 7]),
        allEntries: points([0, 9, 12]),
        totalPopulationQ: "disease:D:1",
        field: "disease",
        populationQ: "disease:D:1",
        series,
      }
      return ok(data)
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { TrendTab } from "~/features/workspace/trend/trend-tab"
import type { Condition } from "~/features/workspace/use-condition"

const renderTrend = () => {
  const toggle = vi.fn()
  const toggleNarrow = vi.fn()
  const condition = { isSelected: () => false, toggle, toggleNarrow } as unknown as Condition
  renderWithQuery(
    <TrendTab state={{ ...DEFAULTS, tab: "trend", q: "disease:D:1", trendField: "disease", trendAll: true, trendCondition: true }} condition={condition} update={vi.fn()} latest={() => DEFAULTS} replacing={false} setReplacing={vi.fn()} onAlert={vi.fn()} />,
  )
  return { toggle, toggleNarrow }
}

describe("TrendTab points", () => {
  it("adds the year of a point with a count of 0 on the Condition line and on the All entries line", async () => {
    const user = userEvent.setup()
    const { toggle } = renderTrend()
    await user.click(await screen.findByRole("button", { name: /^Condition, 2019: 0 BioSamples/ }))
    await user.click(screen.getByRole("button", { name: /^All entries, 2019: 0 BioSamples/ }))
    expect(toggle).toHaveBeenNthCalledWith(1, year(2019))
    expect(toggle).toHaveBeenNthCalledWith(2, year(2019))
  })

  it("adds the year of a point with a count on the All entries line as the Condition line does", async () => {
    const user = userEvent.setup()
    const { toggle } = renderTrend()
    await user.click(await screen.findByRole("button", { name: /^All entries, 2020: 9 BioSamples/ }))
    expect(toggle).toHaveBeenLastCalledWith(year(2020))
  })

  it("does not narrow the condition by a point of a line of the Lines with a count of 0", async () => {
    const user = userEvent.setup()
    const { toggleNarrow } = renderTrend()
    await screen.findByRole("button", { name: /^Condition, 2019/ })
    expect(screen.queryByRole("button", { name: /^disease one, 2019/ })).toBeNull()
    expect(screen.getByRole("img", { name: /^disease one, 2019: 0 BioSamples/ })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^disease one, 2020: 4 BioSamples/ }))
    expect(toggleNarrow).toHaveBeenCalledTimes(1)
  })
})
