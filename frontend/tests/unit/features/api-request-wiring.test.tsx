import { QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { newQueryClient } from "../query"

type Init = { params?: { path?: Record<string, string>; query?: Record<string, string | number | boolean | undefined> } }
const sent = vi.hoisted(() => [] as string[])

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const resolve = (path: string, init?: Init) => path.replace(/\{(\w+)\}/g, (_, name: string) => init?.params?.path?.[name] ?? "")
  const GET = async (path: string, init?: Init) => {
    sent.push(original.apiUrl(resolve(path, init), init?.params?.query ?? {}))
    if (path === "/api/dataset") {
      const field = (name: string) => ({ name, multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 1 })
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field("disease"), field("cell_type")], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    if (path === "/api/dsl/parse") {
      return ok({ q: init?.params?.query?.["q"], ast: { field: "disease", op: "eq", value: "X:1" }, labels: {}, selected: [{ field: "disease", value: "X:1" }], keyword: "" })
    }
    // Every other request never answers. The test reads only the requests.
    return new Promise(() => undefined)
  }
  const POST = async (path: string, init?: Init) => {
    sent.push(resolve(path, init))
    return new Promise(() => undefined)
  }
  return { ...original, api: { ...original.api, GET, POST } }
})

import { apiRequestsFor } from "~/features/workspace/view-requests"
import { WorkspacePage } from "~/features/workspace/workspace-page"
import { DEFAULTS, readState, TABS, workspaceSearch, type WorkspaceState } from "~/lib/workspace-state"

const FIELDS = ["disease", "cell_type"]

/** The pathname and the sorted query of a request, so that the order of the parameters does not matter. */
const normalized = (request: string): string => {
  const url = new URL(request, "http://localhost")
  return `${url.pathname}?${[...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&")}`
}

beforeEach(() => {
  sent.length = 0
})

const STATES: [string, Partial<WorkspaceState>][] = [
  ["samples", { tab: "samples", q: "disease:X:1", page: 2, perPage: 50 }],
  ["samples without a condition", { tab: "samples", q: null, page: 1, perPage: 100 }],
  ["distribution", { tab: "distribution", q: "disease:X:1", unit: "bioproject" }],
  ["distribution of experiments", { tab: "distribution", q: 'cell_type:"a b" OR disease:X:2', unit: "sra-experiment" }],
  ["heatmap", { tab: "heatmap", q: "disease:X:1", unit: "bioproject", row: "disease", col: "cell_type", rowTerms: ["X:1"] }],
  ["heatmap with terms on both axes", { tab: "heatmap", q: null, unit: "sra-experiment", row: "cell_type", col: "disease", rowTerms: ["A:1", "A:2"], colTerms: ["X:1"] }],
  ["heatmap with an axis that the dataset lacks", { tab: "heatmap", q: "disease:X:1", row: "no_such_field", col: "cell_type", rowTerms: ["X:1"] }],
  ["trend", { tab: "trend", q: "disease:X:1", unit: "sra-experiment", trendField: "cell_type", trendFrom: 2010, trendTo: 2020 }],
  ["trend with terms", { tab: "trend", q: null, trendField: "disease", trendTerms: ["X:1", "X:2"], trendFrom: null, trendTo: 2020 }],
  ["projects", { tab: "projects", q: "disease:X:1", sort: "experimentCount:asc", page: 3, perPage: 50 }],
  ["projects without a condition", { tab: "projects", q: null, sort: "biosampleCount:asc", page: 1, perPage: 100 }],
]

describe("the API dialog", () => {
  it("is checked for every tab", () => {
    const tabs = new Set(STATES.map(([, patch]) => patch.tab))
    expect([...tabs].sort()).toEqual([...TABS].sort())
  })

  it.each(STATES)("names the requests that the view of the URL makes (%s)", async (_name, patch) => {
    const search = workspaceSearch({ ...DEFAULTS, ...patch })
    render(
      <QueryClientProvider client={newQueryClient()}>
        <MemoryRouter initialEntries={[`/entries${search}`]}>
          <WorkspacePage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const expected = apiRequestsFor(readState(new URLSearchParams(search)), FIELDS).map(normalized)
    expect(expected.length).toBeGreaterThan(0)
    await vi.waitFor(() => {
      const made = sent.map(normalized)
      for (const request of expected) expect(made).toContain(request)
    })
  })
})
