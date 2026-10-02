import { describe, expect, it } from "vitest"

import { DEFAULTS, readState, workspaceSearch, writeState } from "~/lib/workspace-state"

describe("workspace state in the URL", () => {
  it("writes the counting unit with the value of the api", () => {
    const params = writeState({ ...DEFAULTS, unit: "sra-experiment" })
    expect(params.get("unit")).toBe("sra-experiment")
  })

  it("restores unit=sra-experiment from the URL", () => {
    const state = readState(new URLSearchParams("unit=sra-experiment"))
    expect(state.unit).toBe("sra-experiment")
  })

  it("falls back to the default for the value experiment", () => {
    const state = readState(new URLSearchParams("unit=experiment"))
    expect(state.unit).toBe(DEFAULTS.unit)
  })

  it("keeps the names of the parameters", () => {
    const search = workspaceSearch({ rowTerms: ["A:1"], trendField: "disease", selfExclusion: false })
    const params = new URLSearchParams(search)
    expect([...params.keys()].sort()).toEqual(["row_terms", "se", "trend_field"])
  })
})
