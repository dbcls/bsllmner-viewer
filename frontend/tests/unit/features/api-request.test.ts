import { describe, expect, it } from "vitest"

import { apiRequestFor } from "~/features/workspace/overlays"
import { DEFAULTS, type Tab,TABLE_PER_PAGE } from "~/lib/workspace-state"

const TABS_WITH_SELF_EXCLUSION: Tab[] = ["distribution", "heatmap", "trend"]

describe("apiRequestFor", () => {
  it.each(TABS_WITH_SELF_EXCLUSION)("includes facetSelfExclude=true on the %s tab when self-exclusion is on", (tab) => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab, q: "a:b" }), "http://localhost")
    expect(url.searchParams.get("facetSelfExclude")).toBe("true")
  })

  it.each(TABS_WITH_SELF_EXCLUSION)("omits facetSelfExclude on the %s tab when self-exclusion is off", (tab) => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab, selfExclusion: false }), "http://localhost")
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

  it.each([true, false])("includes facetSelfExclude=true on the projects tab whatever the self-exclusion toggle is (%s)", (selfExclusion) => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "projects", q: "a:b", selfExclusion }), "http://localhost")
    expect(url.searchParams.get("facetSelfExclude")).toBe("true")
  })
})
