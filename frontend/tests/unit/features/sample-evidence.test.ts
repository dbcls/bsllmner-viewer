import { describe, expect, it } from "vitest"

import { evidenceContext, mergeSpans, segmentText } from "~/features/sample/evidence"

describe("mergeSpans", () => {
  it("empty_returnsEmptyArray", () => {
    expect(mergeSpans([])).toEqual([])
  })

  it("overlappingSpans_mergesIntoOneRange", () => {
    expect(mergeSpans([{ start: 0, end: 5 }, { start: 3, end: 8 }])).toEqual([{ start: 0, end: 8 }])
  })

  it("adjacentSpans_mergesIntoOneRange", () => {
    expect(mergeSpans([{ start: 0, end: 5 }, { start: 5, end: 9 }])).toEqual([{ start: 0, end: 9 }])
  })

  it("disjointSpans_keepsSeparateRangesSortedByStart", () => {
    expect(mergeSpans([{ start: 10, end: 15 }, { start: 0, end: 3 }])).toEqual([{ start: 0, end: 3 }, { start: 10, end: 15 }])
  })

  it("spanFullyContainedInAnother_collapsesIntoOuterRange", () => {
    expect(mergeSpans([{ start: 0, end: 10 }, { start: 2, end: 4 }])).toEqual([{ start: 0, end: 10 }])
  })

  it("singleSpan_isReturnedUnchanged", () => {
    expect(mergeSpans([{ start: 2, end: 4 }])).toEqual([{ start: 2, end: 4 }])
  })
})

describe("segmentText", () => {
  it("noSpans_returnsWholeTextUnmatched", () => {
    expect(segmentText("hello", [])).toEqual([{ text: "hello", matched: false }])
  })

  it("emptyText_returnsSingleEmptyUnmatchedSegment", () => {
    expect(segmentText("", [])).toEqual([{ text: "", matched: false }])
  })

  it("spanCoveringWholeText_returnsSingleMatchedSegment", () => {
    expect(segmentText("hello", [{ start: 0, end: 5 }])).toEqual([{ text: "hello", matched: true }])
  })

  it("spanInMiddle_splitsIntoUnmatchedThenMatchedRuns", () => {
    expect(segmentText("hello world", [{ start: 6, end: 11 }])).toEqual([
      { text: "hello ", matched: false },
      { text: "world", matched: true },
    ])
  })

  it("overlappingSpans_areMergedBeforeSegmenting", () => {
    expect(segmentText("hello world", [{ start: 0, end: 3 }, { start: 2, end: 5 }])).toEqual([
      { text: "hello", matched: true },
      { text: " world", matched: false },
    ])
  })

  it("spanBeyondTextLength_clampsToTextLength", () => {
    expect(segmentText("hi", [{ start: 0, end: 50 }])).toEqual([{ text: "hi", matched: true }])
  })
})

describe("evidenceContext", () => {
  it("shortSurroundingText_isReturnedWithoutTruncation", () => {
    expect(evidenceContext("Vastus lateralis muscle, healthy volunteer", 17, 23)).toEqual({
      pre: "Vastus lateralis ",
      match: "muscle",
      post: ", healthy volunteer",
    })
  })

  it("longSurroundingText_isClippedToFortyCharactersWithEllipsis", () => {
    const pre = "a".repeat(60)
    const post = "b".repeat(60)
    const result = evidenceContext(`${pre}MATCH${post}`, 60, 65)
    expect(result.match).toBe("MATCH")
    expect(result.pre).toBe(`…${"a".repeat(40)}`)
    expect(result.post).toBe(`${"b".repeat(40)}…`)
  })
})
