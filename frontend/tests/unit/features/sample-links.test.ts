import { describe, expect, it } from "vitest"

import { backHref, bioprojectHref, termHref } from "~/features/sample/links"
import { readState, workspaceSearch } from "~/lib/workspace-state"

describe("backHref", () => {
  it("returns to the entries page with the search string of the list the sample was opened from", () => {
    const from = workspaceSearch({ q: 'disease:"MONDO:0007254"', unit: "sra-experiment", tab: "distribution" })
    const href = backHref(from)
    expect(href.startsWith("/entries?")).toBe(true)
    const state = readState(new URL(href, "http://localhost").searchParams)
    expect(state).toMatchObject({ q: 'disease:"MONDO:0007254"', unit: "sra-experiment", tab: "distribution" })
  })

  it("returns to the bare entries page without a search string", () => {
    expect(backHref(null)).toBe("/entries")
    expect(backHref("")).toBe("/entries")
  })
})

describe("termHref and bioprojectHref", () => {
  it("point at the entries page with the term or the project as the condition", () => {
    const term = new URL(termHref("disease", "MONDO:0007254"), "http://localhost")
    expect(term.pathname).toBe("/entries")
    expect(term.searchParams.get("q")).toBe('disease:"MONDO:0007254"')
    expect(bioprojectHref("PRJNA1")).toBe("/entries?q=bioproject:PRJNA1")
  })
})
