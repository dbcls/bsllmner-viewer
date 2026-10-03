import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { segmentText, type Span } from "~/features/sample/evidence"

const span: fc.Arbitrary<Span> = fc.record({ start: fc.integer({ min: -3, max: 30 }), end: fc.integer({ min: -3, max: 30 }) })
const input = fc.record({
  text: fc.string({ maxLength: 25 }),
  spans: fc.array(span, { maxLength: 6 }),
  active: fc.array(span, { maxLength: 3 }),
})
/** An input together with its spans in another order. */
const reordered = input.chain((value) =>
  fc.record({
    input: fc.constant(value),
    shuffled: fc.shuffledSubarray(value.spans, { minLength: value.spans.length, maxLength: value.spans.length }),
  }),
)

const covers = (spans: Span[], at: number): boolean => spans.some((s) => s.start <= at && at < s.end)

describe("segmentText", () => {
  test.prop({ input })("keeps the text, and marks each character as a span and an active span cover it", ({ input: { text, spans, active } }) => {
    const segments = segmentText(text, spans, active)
    expect(segments.map((segment) => segment.text).join("")).toBe(text)
    let at = 0
    for (const segment of segments) {
      for (let offset = 0; offset < segment.text.length; offset++) {
        expect(segment.active).toBe(covers(active, at + offset))
        expect(segment.matched).toBe(covers(active, at + offset) || covers(spans, at + offset))
      }
      at += segment.text.length
    }
  })

  test.prop({ input })("returns the longest runs: no empty run, and no two neighbors alike", ({ input: { text, spans, active } }) => {
    const segments = segmentText(text, spans, active)
    if (text.length > 0) expect(segments.every((segment) => segment.text.length > 0)).toBe(true)
    for (let index = 1; index < segments.length; index++) {
      const [before, after] = [segments[index - 1], segments[index]]
      expect(before?.matched === after?.matched && before?.active === after?.active).toBe(false)
    }
  })

  test.prop({ reordered })("does not depend on the order of the spans", ({ reordered: { input: { text, spans, active }, shuffled } }) => {
    expect(segmentText(text, shuffled, active)).toEqual(segmentText(text, spans, active))
  })
})
