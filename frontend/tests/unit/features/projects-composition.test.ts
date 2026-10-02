import { describe, expect, it } from "vitest"

import { compositionSegments, compositionSummary } from "~/features/workspace/projects/composition"
import type { Composition } from "~/lib/api/types"

const composition = (segments: Composition["segments"], total: number): Composition => ({
  field: "disease",
  total,
  segments,
})

describe("compositionSegments", () => {
  it("zeroTotal_returnsNoSegments", () => {
    expect(compositionSegments(composition([{ kind: "term", label: "breast cancer", termId: "MONDO:1", count: 5 }], 0))).toEqual([])
  })

  it("allFourKinds_ordersTermOtherUnmappedNoValue", () => {
    const result = compositionSegments(
      composition(
        [
          { kind: "no_value", label: null, termId: null, count: 10 },
          { kind: "unmapped", label: null, termId: null, count: 10 },
          { kind: "term", label: "breast cancer", termId: "MONDO:1", count: 70 },
          { kind: "other", label: null, termId: null, count: 10 },
        ],
        100,
      ),
    )
    expect(result.map((segment) => segment.kind)).toEqual(["term", "other", "unmapped", "no_value"])
  })

  it("missingKind_isOmittedFromSegments", () => {
    const result = compositionSegments(composition([{ kind: "term", label: "breast cancer", termId: "MONDO:1", count: 100 }], 100))
    expect(result).toEqual([{ kind: "term", pct: 100, title: "breast cancer 100%" }])
  })

  it("zeroCountSegment_isOmitted", () => {
    const result = compositionSegments(
      composition(
        [
          { kind: "term", label: "breast cancer", termId: "MONDO:1", count: 100 },
          { kind: "other", label: null, termId: null, count: 0 },
        ],
        100,
      ),
    )
    expect(result).toEqual([{ kind: "term", pct: 100, title: "breast cancer 100%" }])
  })

  it("nonTermKind_usesGenericLabelNotSegmentLabel", () => {
    const result = compositionSegments(composition([{ kind: "unmapped", label: "ignored", termId: null, count: 100 }], 100))
    expect(result).toEqual([{ kind: "unmapped", pct: 100, title: "unmapped 100%" }])
  })
})

describe("compositionSummary", () => {
  it("noTermSegment_returnsEmptyString", () => {
    expect(compositionSummary(composition([{ kind: "no_value", label: null, termId: null, count: 100 }], 100))).toBe("")
  })

  it("zeroTotal_returnsEmptyString", () => {
    expect(compositionSummary(composition([{ kind: "term", label: "breast cancer", termId: "MONDO:1", count: 0 }], 0))).toBe("")
  })

  it("otherShareBelowFourPercent_omitsOtherFromSummary", () => {
    const result = compositionSummary(
      composition(
        [
          { kind: "term", label: "breast cancer", termId: "MONDO:1", count: 97 },
          { kind: "other", label: null, termId: null, count: 3 },
        ],
        100,
      ),
    )
    expect(result).toBe("breast cancer 97%")
  })

  it("otherShareAtFourPercent_includesOtherInSummary", () => {
    const result = compositionSummary(
      composition(
        [
          { kind: "term", label: "breast cancer", termId: "MONDO:1", count: 96 },
          { kind: "other", label: null, termId: null, count: 4 },
        ],
        100,
      ),
    )
    expect(result).toBe("breast cancer 96% · other 4%")
  })
})
