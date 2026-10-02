import { describe, expect, it } from "vitest"

import { expectedElements } from "~/features/workspace/expected-elements"
import type { DatasetResponse } from "~/lib/api/types"

const dataset = {
  targetAssays: ["RNA-Seq", "ChIP-Seq", "ATAC-seq"],
  organisms: Array.from({ length: 12 }, (_, index) => ({ identifier: String(index), name: `organism ${index}`, biosampleCount: 1 })),
} as unknown as DatasetResponse

describe("expectedElements", () => {
  it("expects the named elements when the view names them", () => {
    expect(expectedElements("disease", dataset, 10, ["MONDO:1", "MONDO:2"])).toBe(2)
  })

  it("expects the target assays and up to the limit of the organisms of the dataset", () => {
    expect(expectedElements("library_strategy", dataset, 10)).toBe(3)
    expect(expectedElements("organism_id", dataset, 10)).toBe(10)
    expect(expectedElements("organism_id", dataset, 20)).toBe(12)
  })

  it("expects the limit for the other dimensions and before the dataset is known", () => {
    expect(expectedElements("disease", dataset, 10)).toBe(10)
    expect(expectedElements("date_created", dataset, 10)).toBe(10)
    expect(expectedElements("library_strategy", undefined, 10)).toBe(10)
  })
})
