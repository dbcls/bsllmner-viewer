import { describe, expect, it } from "vitest"

import { apiRequestFor } from "~/features/workspace/overlays"
import { DEFAULTS, type Tab } from "~/lib/workspace-state"

const TABS_WITH_SELF_EXCLUSION: Tab[] = ["distribution", "heatmap", "trend", "projects"]

describe("apiRequestFor", () => {
  it.each(TABS_WITH_SELF_EXCLUSION)("includes facetSelfExclude=true on the %s tab when self-exclusion is on", (tab) => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab, q: "a:b" }), "http://localhost")
    expect(url.searchParams.get("facetSelfExclude")).toBe("true")
  })

  it.each(TABS_WITH_SELF_EXCLUSION)("omits facetSelfExclude on the %s tab when self-exclusion is off", (tab) => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab, selfExclusion: false }), "http://localhost")
    expect(url.searchParams.has("facetSelfExclude")).toBe(false)
  })

  it("requests the entries of the row type on the samples tab", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "samples", rows: "sra-experiment", page: 2 }), "http://localhost")
    expect(url.pathname).toBe("/api/entries/sra-experiment")
    expect(url.searchParams.get("perPage")).toBe("25")
    expect(url.searchParams.get("page")).toBe("2")
  })

  it("passes the counting unit with the api value", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "distribution", unit: "sra-experiment" }), "http://localhost")
    expect(url.searchParams.get("unit")).toBe("sra-experiment")
  })

  it("sorts projects by the camelCase sort value", () => {
    const url = new URL(apiRequestFor({ ...DEFAULTS, tab: "projects" }), "http://localhost")
    expect(url.searchParams.get("sort")).toBe("biosampleCount:desc")
    expect(url.searchParams.get("compositionFields")).toBeTruthy()
  })
})
