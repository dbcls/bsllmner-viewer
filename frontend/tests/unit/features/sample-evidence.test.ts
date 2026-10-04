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
})
