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

  it("reads an empty term list as the default and does not write one", () => {
    const state = readState(new URLSearchParams("row_terms=&col_terms=,&trend_terms="))
    expect([state.rowTerms, state.colTerms, state.trendTerms]).toEqual([null, null, null])
    const params = writeState({ ...DEFAULTS, rowTerms: [], colTerms: [], trendTerms: [] })
    expect([params.has("row_terms"), params.has("col_terms"), params.has("trend_terms")]).toEqual([false, false, false])
  })

  it("reads only four-digit years for the trend", () => {
    const years = (text: string) => readState(new URLSearchParams(text)).trendFrom
    expect(years("trend_from=2010")).toBe(2010)
    expect(years("trend_from=99999999")).toBeNull()
    expect(years("trend_from=999")).toBeNull()
    expect(years("trend_from=1000000")).toBeNull()
  })

  it("reads a page that is not a safe positive integer as the first page", () => {
    const page = (text: string) => readState(new URLSearchParams(`page=${text}`)).page
    expect(page("3")).toBe(3)
    for (const bad of ["1e21", "0x10", "9007199254740993", "-1", "0", "1.5", "abc", ""]) expect(page(bad)).toBe(1)
  })

  it("reads at most five trend terms", () => {
    const terms = readState(new URLSearchParams("trend_terms=a,b,c,d,e,f,g")).trendTerms
    expect(terms).toEqual(["a", "b", "c", "d", "e"])
  })

  it("keeps the names of the parameters", () => {
    const search = workspaceSearch({
      rowTerms: ["A:1"],
      trendField: "tissue",
      trendFrom: 2010,
      trendTo: 2020,
      trendCondition: false,
      trendAll: true,
      trendLabels: true,
      termIds: true,
    })
    const params = new URLSearchParams(search)
    expect([...params.keys()].sort()).toEqual(["row_terms", "term_ids", "trend_all", "trend_condition", "trend_field", "trend_from", "trend_labels", "trend_to"])
    expect(params.get("term_ids")).toBe("on")
    expect(params.get("trend_condition")).toBe("off")
    expect(params.get("trend_all")).toBe("on")
    expect(params.get("trend_labels")).toBe("on")
  })

  it("draws the lines of the diseases with the line of the condition, without the whole dataset and data labels, by default", () => {
    const state = readState(new URLSearchParams(""))
    expect(state.trendField).toBe("disease")
    expect(state.trendCondition).toBe(true)
    expect(state.trendAll).toBe(false)
    expect(state.trendLabels).toBe(false)
    expect(writeState(state).has("trend_field")).toBe(false)
  })

  it("reads a value of the trend switches other than off and on as the default", () => {
    const state = readState(new URLSearchParams("trend_condition=0&trend_all=1&trend_labels=1"))
    expect(state.trendCondition).toBe(true)
    expect(state.trendAll).toBe(false)
    expect(state.trendLabels).toBe(false)
  })

  it("hides the term IDs of the charts by default, and for a value other than on", () => {
    expect(readState(new URLSearchParams("")).termIds).toBe(false)
    expect(readState(new URLSearchParams("term_ids=1")).termIds).toBe(false)
    expect(readState(new URLSearchParams("term_ids=on")).termIds).toBe(true)
    expect(writeState(DEFAULTS).has("term_ids")).toBe(false)
  })

  it("reads an old URL that turned self-exclusion off as any other URL, and does not write the parameter back", () => {
    const state = readState(new URLSearchParams("se=0&unit=bioproject"))
    expect(state).toEqual({ ...DEFAULTS, unit: "bioproject" })
    expect(writeState(state).has("se")).toBe(false)
  })
})
