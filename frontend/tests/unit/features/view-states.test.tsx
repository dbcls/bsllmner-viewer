import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

type Mode = "ok" | "empty" | "pastEnd" | "held" | 400 | 500 | "network"

const net = vi.hoisted(() => ({ mode: "ok" as Mode, dataset: "ok" as "ok" | 500, requests: [] as string[], release: undefined as undefined | (() => void) }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const element = (value: string) => ({ value, label: `label ${value}`, clauses: [{ field: "disease", value }], count: 3 })

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok, failure } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: { q?: string } } }) => {
    if (path === "/api/dataset") {
      if (net.dataset === 500) return failure(500)
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 1 }
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    net.requests.push(path)
    if (net.mode === "network") throw new TypeError("Failed to fetch")
    if (net.mode === 400 || net.mode === 500) return failure(net.mode, "too many")
    if (net.mode === "pastEnd") return ok({ items: [], pagination: { page: 9, perPage: 20, total: 41 } })
    if (net.mode === "held") {
      const item = (identifier: string) => ({ identifier, title: "t", organism: null, libraryStrategy: [], bioprojects: [], datePublished: null, annotations: {} })
      if (init?.params?.query?.q === "c:d") {
        await new Promise<void>((resolve) => {
          net.release = resolve
        })
        return ok({ items: [item("SAMD9")], pagination: { page: 9, perPage: 20, total: 5000 } })
      }
      return ok({ items: [item("SAMD1")], pagination: { page: 1, perPage: 20, total: 41 } })
    }
    const empty = net.mode === "empty"
    const pagination = { page: 1, perPage: 20, total: empty ? 0 : 1 }
    if (path === "/api/entries/{type}") {
      const item = { identifier: "SAMD1", title: "t", organism: null, libraryStrategy: [], bioprojects: [], datePublished: null, annotations: {} }
      return ok({ items: empty ? [] : [item], pagination })
    }
    if (path === "/api/projects") {
      const item = { identifier: "PRJ1", title: "p", biosampleCount: 1, experimentCount: 1, assays: [], clauses: [] }
      return ok({ items: empty ? [] : [item], pagination })
    }
    if (path === "/api/distribution") return ok({ datasetVersion: VERSION, q: null, unit: "biosample", total: empty ? 0 : 3, withoutTerm: null, elements: empty ? [] : [element("A")] })
    if (path === "/api/crosstab") {
      return ok({ datasetVersion: VERSION, q: null, populationQ: null, total: empty ? 0 : 3, rows: empty ? [] : [{ ...element("A"), hasChildren: false, parents: [] }], cols: empty ? [] : [element("B")], cells: empty ? [] : [{ row: "A", col: "B", count: 3, expected: null, ratio: null, residual: null, classification: null }] })
    }
    if (path === "/api/trend") {
      const points = empty ? [] : [{ year: 2020, count: 3, clauses: [] }]
      return ok({ datasetVersion: VERSION, q: null, populationQ: null, unit: "biosample", firstYear: empty ? null : 2020, lastYear: empty ? null : 2020, years: empty ? [] : [2020], total: points, allEntries: points, series: [] })
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { DistributionTab } from "~/features/workspace/distribution/distribution-tab"
import { HeatmapTab } from "~/features/workspace/heatmap/heatmap-tab"
import { ProjectsTab } from "~/features/workspace/projects/projects-tab"
import { SamplesTab } from "~/features/workspace/samples/samples-tab"
import { TrendTab } from "~/features/workspace/trend/trend-tab"
import type { Condition } from "~/features/workspace/use-condition"

const condition = { isSelected: () => false, selected: [], toggle: vi.fn(), toggleNarrow: vi.fn() } as unknown as Condition
const noop = vi.fn()

const views: { name: string; target: string; loaded: string; empty: string; render: () => void }[] = [
  {
    name: "Samples",
    loaded: "SAMD1",
    target: "Could not load the BioSamples.",
    empty: "No BioSamples match this condition.",
    render: () => renderWithQuery(<MemoryRouter><SamplesTab state={DEFAULTS} onPage={noop} onPerPage={noop} onPastEnd={noop} search="" /></MemoryRouter>),
  },
  {
    name: "Projects",
    loaded: "PRJ1",
    target: "Could not load the BioProjects.",
    empty: "No BioProjects match this condition.",
    render: () => renderWithQuery(<ProjectsTab state={{ ...DEFAULTS, tab: "projects" }} condition={condition} onPage={noop} onSort={noop} onPerPage={noop} onPastEnd={noop} />),
  },
  {
    name: "Heatmap",
    loaded: "label A",
    target: "Could not load the heatmap.",
    empty: "No BioSamples match this condition.",
    render: () =>
      renderWithQuery(
        <HeatmapTab state={{ ...DEFAULTS, tab: "heatmap", row: "disease", col: "library_strategy" }} condition={condition} update={noop} latest={() => DEFAULTS} replacing={false} setReplacing={noop} onAlert={noop} />,
      ),
  },
  {
    name: "Trend",
    loaded: "2020",
    target: "Could not load the trend.",
    empty: "No BioSamples with a publication year match this condition.",
    render: () =>
      renderWithQuery(
        <TrendTab state={{ ...DEFAULTS, tab: "trend" }} condition={condition} update={noop} latest={() => DEFAULTS} replacing={false} setReplacing={noop} onAlert={noop} />,
      ),
  },
]

beforeEach(() => {
  net.mode = "ok"
  net.dataset = "ok"
  localStorage.clear()
  net.requests.length = 0
  net.release = undefined
})

describe.each(views)("$name", ({ target, loaded, empty, render }) => {
  it("shows the detail of the api and no Try again when the request is refused (400)", async () => {
    net.mode = 400
    render()
    expect(await screen.findByText(`${target.slice(0, -1)}: too many`)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Try again/ })).toBeNull()
  })

  it.each([500, "network"] as const)("shows a notice with Try again where the content was when the request fails (%s), and loads again when pressed", async (mode) => {
    net.mode = mode
    render()
    expect(await screen.findByText(target)).toBeInTheDocument()
    expect(screen.getAllByRole("status")).toHaveLength(1)
    net.mode = "ok"
    await userEvent.click(screen.getByRole("button", { name: /^Try again/ }))
    expect((await screen.findAllByText(loaded)).length).toBeGreaterThan(0)
    expect(screen.queryByText(target)).toBeNull()
  })

  it("says that nothing matches the condition when there are no results", async () => {
    net.mode = "empty"
    render()
    expect(await screen.findByText(empty)).toBeInTheDocument()
  })
})

describe("Distribution", () => {
  const renderDistribution = () => renderWithQuery(<DistributionTab state={{ ...DEFAULTS, tab: "distribution" }} condition={condition} onUnit={noop} onTermIds={noop} onAlert={noop} />)

  it("shows a notice with Try again in the card when the request fails", async () => {
    net.mode = 500
    renderDistribution()
    const notice = await screen.findByText("Could not load the Disease distribution.")
    expect(within(notice.closest("[role=status]") as HTMLElement).getByRole("button", { name: /^Try again/ })).toBeInTheDocument()
  })

  it("shows one notice that the dataset could not be loaded, not cards that wait for it", async () => {
    net.dataset = 500
    renderDistribution()
    expect(await screen.findByText("Could not load the dataset.")).toBeInTheDocument()
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0)
  })

  it("says that nothing matches the condition in the unit of the count when there are no results", async () => {
    net.mode = "empty"
    renderWithQuery(<DistributionTab state={{ ...DEFAULTS, tab: "distribution", unit: "bioproject" }} condition={condition} onUnit={noop} onTermIds={noop} onAlert={noop} />)
    expect(await screen.findByText("No BioProjects match this condition.")).toBeInTheDocument()
  })
})

describe("the page of a table", () => {
  it("is replaced with the last page when it is past the last page", async () => {
    const onPastEnd = vi.fn()
    net.mode = "empty"
    renderWithQuery(
      <MemoryRouter>
        <SamplesTab state={{ ...DEFAULTS, page: 4 }} onPage={noop} onPerPage={noop} onPastEnd={onPastEnd} search="" />
      </MemoryRouter>,
    )
    await vi.waitFor(() => expect(onPastEnd).toHaveBeenCalledWith(1, { q: null, page: 4 }))
  })

  it("does not say that nothing matches while the answer for a page past the end has a count, and moves to the last page", async () => {
    const onPastEnd = vi.fn()
    net.mode = "pastEnd"
    renderWithQuery(
      <MemoryRouter>
        <SamplesTab state={{ ...DEFAULTS, page: 9 }} onPage={noop} onPerPage={noop} onPastEnd={onPastEnd} search="" />
      </MemoryRouter>,
    )
    await vi.waitFor(() => expect(onPastEnd).toHaveBeenCalledWith(3, { q: null, page: 9 }))
    expect(screen.queryByText("No BioSamples match this condition.")).toBeNull()
  })

  it("waits for the count of its own request, not of the rows that stand in from the previous request", async () => {
    const onPastEnd = vi.fn()
    net.mode = "held"
    const tab = (q: string, page: number) => (
      <MemoryRouter>
        <SamplesTab state={{ ...DEFAULTS, q, page }} onPage={noop} onPerPage={noop} onPastEnd={onPastEnd} search="" />
      </MemoryRouter>
    )
    const { rerender } = renderWithQuery(tab("a:b", 1))
    await screen.findByText("SAMD1")
    rerender(tab("c:d", 9))
    await vi.waitFor(() => expect(net.release).toBeDefined())
    expect(onPastEnd).not.toHaveBeenCalled()
    net.release?.()
    await screen.findByText("SAMD9")
    expect(onPastEnd).not.toHaveBeenCalled()
  })

  it("of BioProjects is replaced with the last page when it is past the last page", async () => {
    const onPastEnd = vi.fn()
    net.mode = "empty"
    renderWithQuery(<ProjectsTab state={{ ...DEFAULTS, tab: "projects", page: 4 }} condition={condition} onPage={noop} onSort={noop} onPerPage={noop} onPastEnd={onPastEnd} />)
    await vi.waitFor(() => expect(onPastEnd).toHaveBeenCalledWith(1, { q: null, page: 4 }))
  })

  it("is left as it is when it holds results", async () => {
    const onPastEnd = vi.fn()
    renderWithQuery(
      <MemoryRouter>
        <SamplesTab state={DEFAULTS} onPage={noop} onPerPage={noop} onPastEnd={onPastEnd} search="" />
      </MemoryRouter>,
    )
    await screen.findByText("SAMD1")
    expect(onPastEnd).not.toHaveBeenCalled()
  })
})

describe("Heatmap that could not be loaded", () => {
  it("counts the terms that the URL names, not zero, and lists them in the dialog so that they can be removed", async () => {
    net.mode = 500
    renderWithQuery(
      <HeatmapTab state={{ ...DEFAULTS, tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: ["A", "B", "C"] }} condition={condition} update={noop} latest={() => DEFAULTS} replacing={false} setReplacing={noop} onAlert={noop} />,
    )
    await screen.findByText("Could not load the heatmap.")
    await userEvent.click(within(screen.getByRole("group", { name: "Rows" })).getByRole("button", { name: /terms$/ }))
    expect(within(screen.getByRole("group", { name: "Rows" })).getByRole("button", { name: /3 terms/ })).toBeInTheDocument()
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove B" })).toBeInTheDocument()
  })
})

describe("Heatmap and Trend whose terms are not known", () => {
  it("show a dash, not 0 terms or values, for an axis that names none when the request failed", async () => {
    net.mode = 500
    renderWithQuery(
      <HeatmapTab state={{ ...DEFAULTS, tab: "heatmap", row: "disease", col: "library_strategy" }} condition={condition} update={noop} latest={() => DEFAULTS} replacing={false} setReplacing={noop} onAlert={noop} />,
    )
    await screen.findByText("Could not load the heatmap.")
    expect(within(screen.getByRole("group", { name: "Rows" })).getByRole("button", { name: /terms$/ })).toHaveTextContent("– terms")
    expect(within(screen.getByRole("group", { name: "Columns" })).getByRole("button", { name: /values$/ })).toHaveTextContent("– values")
  })

  it("names the dialog of an axis that is not an annotation field after its values", async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <HeatmapTab state={{ ...DEFAULTS, tab: "heatmap", row: "disease", col: "library_strategy" }} condition={condition} update={noop} latest={() => DEFAULTS} replacing={false} setReplacing={noop} onAlert={noop} />,
    )
    await user.click(await within(screen.getByRole("group", { name: "Columns" })).findByRole("button", { name: "1 value" }))
    expect(screen.getByRole("dialog", { name: "Column values" })).toBeInTheDocument()
  })
})
