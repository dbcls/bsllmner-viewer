import { describe, expect, it } from "vitest"

import type { TermHit } from "~/lib/api/types"
import { termDetail } from "~/lib/terms"

const hit = (overrides: Partial<TermHit>): TermHit => ({
  field: "tissue",
  termId: "UBERON:0002107",
  label: "liver",
  ontology: "uberon",
  path: [],
  descendantCount: 0,
  count: 1,
  clauses: [],
  ...overrides,
})

describe("termDetail", () => {
  it("is empty for a term without ancestors or descendants, and never names the ontology", () => {
    expect(termDetail(hit({ ontology: "ncbigene", termId: "NCBIGene:7157", label: "TP53" }))).toBe("")
  })

  it("shows the whole path when it is short, ending with the term", () => {
    expect(termDetail(hit({ path: ["organ", "gland"] }))).toBe("organ › gland › liver")
  })

  it("keeps only the two nearest ancestors of a long path", () => {
    expect(termDetail(hit({ path: ["entity", "organ", "gland"] }))).toBe("… › organ › gland › liver")
  })

  it("adds the number of descendant terms after the path", () => {
    expect(termDetail(hit({ path: ["gland"], descendantCount: 1234 }))).toBe("gland › liver · includes 1,234 descendant terms")
  })

  it("uses the term ID when the term has no label", () => {
    expect(termDetail(hit({ path: ["gland"], label: null }))).toBe("gland › UBERON:0002107")
  })
})
