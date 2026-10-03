import { describe, expect, it } from "vitest"

import { segmentText } from "~/features/sample/evidence"

describe("segmentText", () => {
  it("returns the whole text as one plain run without spans, also for an empty text", () => {
    expect(segmentText("hello", [])).toEqual([{ text: "hello", matched: false, active: false }])
    expect(segmentText("", [])).toEqual([{ text: "", matched: false, active: false }])
  })

  it("reads the spans as code points and does not split a character outside the BMP", () => {
    const text = "ChIPseq for HP1\u{1d6fe} in WT_Rep1"
    expect(segmentText(text, [{ start: 12, end: 16 }])).toEqual([
      { text: "ChIPseq for ", matched: false, active: false },
      { text: "HP1\u{1d6fe}", matched: true, active: false },
      { text: " in WT_Rep1", matched: false, active: false },
    ])
  })

  it("clamps spans that start before the text or end after it", () => {
    expect(segmentText("a\u{1d6fe}b", [{ start: 1, end: 99 }, { start: -5, end: 0 }])).toEqual([
      { text: "a", matched: false, active: false },
      { text: "\u{1d6fe}b", matched: true, active: false },
    ])
  })

  it("marks only the evidence of the active field when two fields have evidence in one value", () => {
    const text = "E-MTAB-13151:ChIP_ETO2_DMSO_rep1"
    const antigen = { start: 18, end: 22 }
    const drug = { start: 23, end: 27 }
    expect(segmentText(text, [antigen, drug], [antigen])).toEqual([
      { text: "E-MTAB-13151:ChIP_", matched: false, active: false },
      { text: "ETO2", matched: true, active: true },
      { text: "_", matched: false, active: false },
      { text: "DMSO", matched: true, active: false },
      { text: "_rep1", matched: false, active: false },
    ])
  })

  it("marks the overlap of an active span and another span as active, and the rest of the other span as matched", () => {
    expect(segmentText("abcdefgh", [{ start: 0, end: 4 }, { start: 2, end: 6 }], [{ start: 2, end: 6 }])).toEqual([
      { text: "ab", matched: true, active: false },
      { text: "cdef", matched: true, active: true },
      { text: "gh", matched: false, active: false },
    ])
  })

  it("splits touching spans of an active and another field at the point where they touch", () => {
    expect(segmentText("abcdef", [{ start: 0, end: 3 }, { start: 3, end: 6 }], [{ start: 3, end: 6 }])).toEqual([
      { text: "abc", matched: true, active: false },
      { text: "def", matched: true, active: true },
    ])
  })

  it("joins touching spans of the same kind into one run", () => {
    expect(segmentText("abcdef", [{ start: 0, end: 3 }, { start: 3, end: 5 }])).toEqual([
      { text: "abcde", matched: true, active: false },
      { text: "f", matched: false, active: false },
    ])
  })

  it("clamps spans that reach beyond the text, and ignores empty and reversed spans", () => {
    expect(segmentText("hi", [{ start: 0, end: 50 }])).toEqual([{ text: "hi", matched: true, active: false }])
    expect(segmentText("hello", [{ start: 2, end: 2 }, { start: 4, end: 1 }])).toEqual([{ text: "hello", matched: false, active: false }])
  })
})
