import { describe, expect, it } from "vitest"

import { estimatedRows } from "~/features/workspace/condition-bar"

describe("estimatedRows", () => {
  it("counts each field that the condition names once", () => {
    expect(estimatedRows('(bioproject:PRJNA1 OR bioproject:PRJNA2) AND cell_type:"EFO:0004038"')).toBe(2)
    expect(estimatedRows("library_strategy:ATAC-seq AND organism_id:9606 AND date_published:[2016-10-02 TO 2026-10-02]")).toBe(3)
  })

  it("does not take a term ID for a field, in quotes or after a field", () => {
    expect(estimatedRows('disease:"MONDO:0007254"')).toBe(1)
    expect(estimatedRows("disease:MONDO:0007254")).toBe(1)
  })

  it("gives at least one row, also for keywords without a field", () => {
    expect(estimatedRows("liver cancer")).toBe(1)
  })
})
