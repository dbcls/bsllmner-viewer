import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  apiRequestsFor,
  crosstabAxes,
  crosstabParams,
  distributionFields,
  distributionParams,
  entriesParams,
  projectsParams,
  trendParams,
} from "~/features/workspace/view-requests"
import { apiUrl } from "~/lib/api/client"
import { crosstabQuery, distributionQuery, entriesQuery, projectsQuery, trendQuery } from "~/lib/api/queries"
import { DEFAULTS, readState, type Tab, TABS, type WorkspaceState } from "~/lib/workspace-state"

describe("crosstabAxes", () => {
  it("draws a row and a column that differ when the URL names a column that the dataset lacks", () => {
    const axes = crosstabAxes(readState(new URLSearchParams("tab=heatmap&row=cell_line&col=bogus")), ["cell_line", "tissue", "disease"])
    expect(axes.row).toBe("cell_line")
    expect(axes.col).not.toBe(axes.row)
  })

  it("keeps the column and takes another row when the URL names a row that the dataset lacks", () => {
    const axes = crosstabAxes(readState(new URLSearchParams("tab=heatmap&row=bogus&col=cell_line")), ["cell_line", "tissue"])
    expect(axes.col).toBe("cell_line")
    expect(axes.row).not.toBe("cell_line")
  })
})

const FIELDS = ["disease", "cell_line", "tissue", "drug"]

const only = (state: WorkspaceState, fields: string[] | null = FIELDS): URL => {
  const requests = apiRequestsFor(state, fields)
  expect(requests).toHaveLength(1)
  return new URL(requests[0] ?? "", "http://localhost")
}

const TABS_WITH_SELF_EXCLUSION: Tab[] = ["heatmap", "trend", "projects"]

describe("apiRequestsFor", () => {
  it.each(TABS_WITH_SELF_EXCLUSION)("always includes facetSelfExclude=true on the %s tab", (tab) => {
    expect(only({ ...DEFAULTS, tab, q: "a:b" }).searchParams.get("facetSelfExclude")).toBe("true")
  })

  it("omits facetSelfExclude on the samples tab, whose entries match the condition itself", () => {
    expect(only({ ...DEFAULTS, tab: "samples", q: "a:b" }).searchParams.has("facetSelfExclude")).toBe(false)
  })

  it("requests the BioSample entries with the page and the rows per page of the samples tab", () => {
    const url = only({ ...DEFAULTS, tab: "samples", page: 2, perPage: 100 })
    expect(url.pathname).toBe("/api/entries/biosample")
    expect(url.searchParams.get("perPage")).toBe("100")
    expect(url.searchParams.get("page")).toBe("2")
  })

  it("lists one request per card of the Distribution tab in the order of the dataset fields, each with the unit and the limit", () => {
    const state = { ...DEFAULTS, tab: "distribution" as const, unit: "sra-experiment" as const, q: "a:b" }
    const requests = apiRequestsFor(state, ["tissue", "drug", "disease"])
    const urls = requests.map((request) => new URL(request, "http://localhost"))
    expect(urls.map((url) => url.searchParams.get("field"))).toEqual(["tissue", "drug", "disease"])
    for (const url of urls) {
      expect(url.pathname).toBe("/api/distribution")
      expect(url.searchParams.get("unit")).toBe("sra-experiment")
      expect(url.searchParams.get("q")).toBe("a:b")
      expect(url.searchParams.get("facetSelfExclude")).toBe("true")
      expect(url.searchParams.get("limit")).toBe("10")
    }
  })

  it("lists no request on the Distribution tab before the dataset is known", () => {
    expect(apiRequestsFor({ ...DEFAULTS, tab: "distribution" }, null)).toEqual([])
  })

  it("requests the trend with the years of the Trend tab, and without them when the tab has no limits", () => {
    const limited = only({ ...DEFAULTS, tab: "trend", trendField: "disease", trendTerms: ["A:1"], trendFrom: 2010, trendTo: 2020 })
    expect(limited.pathname).toBe("/api/trend")
    expect(limited.searchParams.get("yearFrom")).toBe("2010")
    expect(limited.searchParams.get("yearTo")).toBe("2020")
    expect(limited.searchParams.get("elements")).toBe("A:1")
    expect(limited.searchParams.get("limit")).toBe("5")
    const whole = only({ ...DEFAULTS, tab: "trend" })
    expect(whole.searchParams.get("field")).toBe(DEFAULTS.trendField)
    expect(whole.searchParams.has("yearFrom")).toBe(false)
    expect(whole.searchParams.has("yearTo")).toBe(false)
  })

  it("shows the same field as the page for a URL whose trend field is not in the dataset", () => {
    const state = readState(new URLSearchParams("tab=trend&trend_field=foo"))
    expect(only(state).searchParams.get("field")).toBe("disease")
    expect(only({ ...state, trendField: "disease" }, ["cell_line", "tissue"]).searchParams.get("field")).toBe("cell_line")
  })

  it("keeps a trend field that is not an annotation field but is offered, such as the assay", () => {
    expect(only({ ...DEFAULTS, tab: "trend", trendField: "library_strategy" }).searchParams.get("field")).toBe("library_strategy")
  })

  it("replaces a Heatmap row that the dataset lacks with the first dimension that the dataset offers", () => {
    const url = only({ ...DEFAULTS, tab: "heatmap" }, ["disease", "tissue"])
    expect(url.searchParams.get("row")).toBe("disease")
    expect(url.searchParams.get("col")).toBe("library_strategy")
  })

  it("does not name the Heatmap terms of a replaced row", () => {
    const url = only({ ...DEFAULTS, tab: "heatmap", rowTerms: ["A:1"], colTerms: ["B"] }, ["disease"])
    expect(url.searchParams.has("rowElements")).toBe(false)
    expect(url.searchParams.get("colElements")).toBe("B")
  })

  it("replaces a Heatmap row with a dimension other than the column", () => {
    const state = { ...DEFAULTS, tab: "heatmap" as const, row: "gone", col: "disease" }
    const url = only(state, ["disease", "tissue"])
    expect(url.searchParams.get("row")).toBe("tissue")
    expect(url.searchParams.get("col")).toBe("disease")
  })

  it("requests the projects with the sort, the page, and the rows per page of the Projects tab", () => {
    const url = only({ ...DEFAULTS, tab: "projects", sort: "experimentCount:asc", page: 3, perPage: 50 })
    expect(url.pathname).toBe("/api/projects")
    expect(url.searchParams.get("sort")).toBe("experimentCount:asc")
    expect(url.searchParams.get("page")).toBe("3")
    expect(url.searchParams.get("perPage")).toBe("50")
  })
})

const text = fc.string({ maxLength: 12 })
const terms = fc.option(fc.array(fc.stringMatching(/^[A-Z]{1,3}:\d{1,4}$/), { minLength: 1, maxLength: 6 }), { nil: null })
const fieldNames = fc.array(fc.constantFrom("disease", "cell_line", "tissue", "drug", "foo", "chip_antigen"), { maxLength: 6 }).map((names) => [...new Set(names)])

const stateArb: fc.Arbitrary<WorkspaceState> = fc
  .record({
    q: fc.option(text, { nil: null }),
    tab: fc.constantFrom(...TABS),
    unit: fc.constantFrom("biosample", "sra-experiment", "bioproject" as const),
    page: fc.integer({ min: 1, max: 50 }),
    perPage: fc.constantFrom(20, 50, 100 as const),
    sort: fc.constantFrom("biosampleCount:desc", "biosampleCount:asc", "experimentCount:desc", "experimentCount:asc" as const),
    row: fc.constantFrom("cell_line", "disease", "gone", "organism_id"),
    col: fc.constantFrom("library_strategy", "disease", "date_published", "tissue"),
    rowTerms: terms,
    colTerms: terms,
    trendField: fc.constantFrom("disease", "foo", "library_strategy", "tissue"),
    trendTerms: terms,
    trendFrom: fc.option(fc.integer({ min: 1990, max: 2030 }), { nil: null }),
    trendTo: fc.option(fc.integer({ min: 1990, max: 2030 }), { nil: null }),
  })
  .map((patch) => ({ ...DEFAULTS, ...patch }) as WorkspaceState)

describe("apiRequestsFor properties", () => {
  it("builds the query that the tab passes to its hook, for any state and dataset", () => {
    fc.assert(
      fc.property(stateArb, fc.option(fieldNames, { nil: null }), (state, fields) => {
        const expected: Record<Tab, string[]> = {
          samples: [apiUrl("/api/entries/biosample", entriesQuery(entriesParams(state)))],
          distribution: distributionFields(fields ?? []).map((field) => apiUrl("/api/distribution", distributionQuery(distributionParams(state, field)))),
          heatmap: [apiUrl("/api/crosstab", crosstabQuery(crosstabParams(state, fields)))],
          trend: [apiUrl("/api/trend", trendQuery(trendParams(state, fields)))],
          projects: [apiUrl("/api/projects", projectsQuery(projectsParams(state)))],
        }
        expect(apiRequestsFor(state, fields)).toEqual(expected[state.tab])
      }),
    )
  })

  it("always sends the limit of an aggregation", () => {
    fc.assert(
      fc.property(stateArb, fieldNames, (state, fields) => {
        if (!["distribution", "heatmap", "trend"].includes(state.tab)) return
        for (const request of apiRequestsFor(state, fields)) {
          expect(new URL(request, "http://localhost").searchParams.has("limit")).toBe(true)
        }
      }),
    )
  })
})
