import { describe, expect, it } from "vitest"

import type { TermHit, TermResponse } from "~/lib/api/types"
import { termHitRowProps, termPanelDetails } from "~/lib/terms"

describe("termHitRowProps", () => {
  const hit: TermHit = { field: "disease", termId: "MONDO:1", label: null, ontology: "MONDO", path: [], descendantCount: 0, count: 1234, matchedSynonym: null, clauses: [] }

  it("names the field only for a search of every field, and shows the term ID for a term without a label", () => {
    expect("field" in termHitRowProps(hit, false, "x")).toBe(false)
    expect(termHitRowProps(hit, true, "x")).toMatchObject({ field: "Disease", label: "MONDO:1", id: "MONDO:1", count: "1,234", highlight: "x" })
  })
})

describe("termPanelDetails", () => {
  it("names a parent without a label by its term ID", () => {
    const term = { termId: "B:1", label: "b", ontology: null, synonyms: [], parents: [{ termId: "A:1", label: null }], url: null } as unknown as TermResponse
    expect(termPanelDetails(term).parents).toEqual(["A:1"])
  })
})
