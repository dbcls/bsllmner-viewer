import { describe, expect, it } from "vitest"

import { apiRequestFor } from "~/features/workspace/overlays"
import { DEFAULTS, type Tab,TABLE_PER_PAGE } from "~/lib/workspace-state"

const TABS_WITH_SELF_EXCLUSION: Tab[] = ["distribution", "heatmap", "trend", "projects"]

describe("apiRequestFor", () => {
  it.each(TABS_WITH_SELF_EXCLUSION)("always includes facetSelfExclude=true on the %s tab", (tab) => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab, q: "a:b" }), "http://localhost")
    expect(url.searchParams.get("facetSelfExclude")).toBe("true")
  })

  it("omits facetSelfExclude on the samples tab, whose entries match the condition itself", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "samples", q: "a:b" }), "http://localhost")
    expect(url.searchParams.has("facetSelfExclude")).toBe(false)
  })

  it("requests the BioSample entries on the samples tab", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "samples", page: 2 }), "http://localhost")
    expect(url.pathname).toBe("/api/entries/biosample")
    expect(url.searchParams.get("perPage")).toBe(String(TABLE_PER_PAGE))
    expect(url.searchParams.get("page")).toBe("2")
  })

  it("passes the counting unit with the api value", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "distribution", unit: "sra-experiment" }), "http://localhost")
    expect(url.searchParams.get("unit")).toBe("sra-experiment")
  })

  it("requests the projects with the sort and the page of the Projects tab", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "projects", sort: "experimentCount:asc", page: 3 }), "http://localhost")
    expect(url.pathname).toBe("/api/projects")
    expect(url.searchParams.get("sort")).toBe("experimentCount:asc")
    expect(url.searchParams.get("page")).toBe("3")
    expect(url.searchParams.get("perPage")).toBe(String(TABLE_PER_PAGE))
  })
})
