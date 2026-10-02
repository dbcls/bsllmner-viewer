import { describe, expect, it } from "vitest"

import { DEFAULTS, readState, workspaceSearch, writeState } from "~/lib/workspace-state"

describe("workspace state in the URL", () => {
  it("writes the counting unit and the row type with the values of the api", () => {
    const params = writeState({ ...DEFAULTS, unit: "sra-experiment", rows: "sra-experiment" })
    expect(params.get("unit")).toBe("sra-experiment")
    expect(params.get("rows")).toBe("sra-experiment")
  })

  it("restores unit=sra-experiment and rows=sra-experiment from the URL", () => {
    const state = readState(new URLSearchParams("unit=sra-experiment&rows=sra-experiment"))
    expect(state.unit).toBe("sra-experiment")
    expect(state.rows).toBe("sra-experiment")
  })

  it("falls back to the defaults for the value experiment", () => {
    const state = readState(new URLSearchParams("unit=experiment&rows=experiment"))
    expect(state.unit).toBe(DEFAULTS.unit)
    expect(state.rows).toBe(DEFAULTS.rows)
  })

  it("keeps the names of the parameters", () => {
    const search = workspaceSearch({ rowTerms: ["A:1"], trendField: "disease", selfExclusion: false })
    const params = new URLSearchParams(search)
    expect([...params.keys()].sort()).toEqual(["row_terms", "se", "trend_field"])
  })
})
