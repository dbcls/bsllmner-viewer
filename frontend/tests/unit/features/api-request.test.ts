import { describe, expect, it } from "vitest"

import { apiRequestFor } from "~/features/workspace/overlays"
import { DEFAULTS, type Tab,TABLE_PER_PAGE } from "~/lib/workspace-state"

const TABS_WITH_SELF_EXCLUSION: Tab[] = ["distribution", "heatmap", "trend"]
const FIELDS = ["disease", "cell_line"]

describe("apiRequestFor", () => {
  it.each(TABS_WITH_SELF_EXCLUSION)("includes facetSelfExclude=true on the %s tab when self-exclusion is on", (tab) => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab, q: "a:b" }, FIELDS), "http://localhost")
    expect(url.searchParams.get("facetSelfExclude")).toBe("true")
  })

  it.each(TABS_WITH_SELF_EXCLUSION)("omits facetSelfExclude on the %s tab when self-exclusion is off", (tab) => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab, selfExclusion: false }, FIELDS), "http://localhost")
    expect(url.searchParams.has("facetSelfExclude")).toBe(false)
  })

  it("requests the entries of the row type on the samples tab", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "samples", rows: "sra-experiment", page: 2 }, FIELDS), "http://localhost")
    expect(url.pathname).toBe("/api/entries/sra-experiment")
    expect(url.searchParams.get("perPage")).toBe(String(TABLE_PER_PAGE))
    expect(url.searchParams.get("page")).toBe("2")
  })

  it("passes the counting unit with the api value", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "distribution", unit: "sra-experiment" }, FIELDS), "http://localhost")
    expect(url.searchParams.get("unit")).toBe("sra-experiment")
  })

  it("requests the projects with the sort and the composition fields of the Projects tab", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "projects", sort: "identifier:desc", page: 3 }, FIELDS), "http://localhost")
    expect(url.pathname).toBe("/api/projects")
    expect(url.searchParams.get("sort")).toBe("identifier:desc")
    expect(url.searchParams.get("page")).toBe("3")
    expect(url.searchParams.get("compositionFields")).toBe("disease,cell_line")
  })

  it("omits facetSelfExclude on the projects tab, which counts the full condition", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "projects", q: "a:b", selfExclusion: true }, FIELDS), "http://localhost")
    expect(url.searchParams.has("facetSelfExclude")).toBe(false)
  })
})
