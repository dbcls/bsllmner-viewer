import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

type Call = { path: string; query: Record<string, unknown>; pathParams: Record<string, unknown> }

const calls = vi.hoisted(() => [] as Call[])

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const GET = async (path: string, init: { params?: { query?: Record<string, unknown>; path?: Record<string, unknown> } }) => {
    calls.push({ path, query: init.params?.query ?? {}, pathParams: init.params?.path ?? {} })
    return { data: {}, response: new Response("{}") }
  }
  return { ...original, api: { GET } }
})

import { exportAccessionsUrl, exportEntriesUrl } from "~/lib/api/client"
import {
  useCrosstab,
  useDistribution,
  useEntries,
  useProjects,
  useTermChildren,
  useTerms,
  useTrend,
} from "~/lib/api/queries"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)

const lastCall = async (): Promise<Call> => {
  await waitFor(() => expect(calls.length).toBe(1))
  return calls[0] as Call
}

beforeEach(() => {
  calls.length = 0
})

describe.each([true, false])("queries with selfExclusion=%s", (selfExclusion) => {
  const expected = selfExclusion

  it("useDistribution sends facetSelfExclude", async () => {
    renderHook(() => useDistribution({ field: "disease", q: "a:b", unit: "sra-experiment", selfExclusion }), { wrapper })
    const url = await lastCall()
    expect(url.path).toBe("/api/distribution")
    expect(url.query["facetSelfExclude"]).toBe(expected)
    expect(url.query["unit"]).toBe("sra-experiment")
    expect("self_exclusion" in url.query).toBe(false)
  })

  it("useCrosstab sends facetSelfExclude and camelCase element parameters", async () => {
    renderHook(() => useCrosstab({ row: "a", col: "b", q: null, unit: "biosample", selfExclusion, rowElements: "x", colElements: "y" }), { wrapper })
    const url = await lastCall()
    expect(url.query["facetSelfExclude"]).toBe(expected)
    expect(url.query["rowElements"]).toBe("x")
    expect(url.query["colElements"]).toBe("y")
  })

  it("useTrend sends facetSelfExclude", async () => {
    renderHook(() => useTrend({ q: null, unit: "biosample", selfExclusion }), { wrapper })
    expect((await lastCall()).query["facetSelfExclude"]).toBe(expected)
  })

  it("useProjects sends facetSelfExclude, perPage, and compositionFields", async () => {
    renderHook(() => useProjects({ q: null, selfExclusion, sort: "identifier:asc", page: 2, perPage: 25, compositionFields: "disease" }), { wrapper })
    const url = await lastCall()
    expect(url.query["facetSelfExclude"]).toBe(expected)
    expect(url.query["sort"]).toBe("identifier:asc")
    expect(url.query["perPage"]).toBe(25)
    expect(url.query["compositionFields"]).toBe("disease")
  })

  it("useTerms sends facetSelfExclude", async () => {
    renderHook(() => useTerms({ query: "liver", q: null, unit: "biosample", selfExclusion }), { wrapper })
    expect((await lastCall()).query["facetSelfExclude"]).toBe(expected)
  })

  it("useTermChildren sends facetSelfExclude and termId", async () => {
    renderHook(() => useTermChildren({ field: "disease", termId: "MONDO:1", q: null, unit: "biosample", selfExclusion }), { wrapper })
    const url = await lastCall()
    expect(url.query["facetSelfExclude"]).toBe(expected)
    expect(url.query["termId"]).toBe("MONDO:1")
  })
})

describe("useEntries", () => {
  it("requests the list of the entry type with camelCase paging", async () => {
    renderHook(() => useEntries({ q: "a:b", type: "sra-experiment", page: 3, perPage: 25 }), { wrapper })
    const url = await lastCall()
    expect(url.path).toBe("/api/entries/{type}")
    expect(url.pathParams["type"]).toBe("sra-experiment")
    expect(url.query["perPage"]).toBe(25)
    expect(url.query["page"]).toBe(3)
  })
})

describe("export URLs", () => {
  it("name the entry type in the path and the format in the query", () => {
    expect(exportEntriesUrl("biosample", "a:b", "ndjson")).toBe("/api/export/entries/biosample?q=a%3Ab&format=ndjson")
    expect(exportEntriesUrl("sra-experiment", null, "tsv")).toBe("/api/export/entries/sra-experiment?format=tsv")
    expect(exportAccessionsUrl("sra-run", null)).toBe("/api/export/accessions/sra-run")
  })
})
