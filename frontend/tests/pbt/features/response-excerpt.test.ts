import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { responseExcerpt } from "~/features/workspace/overlays"

const LIMIT = 2500
const MARK = "\n  …"

/** A value that alone makes the body longer than the limit or nearly so. A run of one character keeps the shrinking fast. */
const longString = fc.tuple(fc.integer({ min: 1000, max: 4000 }), fc.constantFrom("x", "😀")).map(([length, unit]) => unit.repeat(length))
const body = fc.dictionary(fc.string(), fc.oneof(fc.jsonValue(), longString)).filter((rest) => !Object.hasOwn(rest, "datasetVersion"))

/** A body that JSON.parse refuses, since no JSON text starts with "<", of a length around the limit. */
const notJson = fc.tuple(fc.string(), fc.integer({ min: 0, max: 2 * LIMIT })).map(([text, length]) => `<${text}`.padEnd(length, "x"))

/** A body of a non-JSON prefix and astral characters, so that the cut meets a surrogate pair at either parity. */
const notJsonWithPairs = fc.tuple(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 2 * LIMIT })).map(([lead, pairs]) => `<${"x".repeat(lead)}${"😀".repeat(pairs)}`)

/** The first LIMIT UTF-16 units of the text, or one unit fewer when the cut is inside a surrogate pair. */
const cutAtLimit = (text: string) => {
  const inPair = /[\uD800-\uDBFF]/.test(text[LIMIT - 1] ?? "") && /[\uDC00-\uDFFF]/.test(text[LIMIT] ?? "")
  return text.slice(0, inPair ? LIMIT - 1 : LIMIT)
}

describe("responseExcerpt", () => {
  test.prop([body, fc.jsonValue()])("shows the body without datasetVersion, cut at the limit with a mark", (rest, version) => {
    const excerpt = responseExcerpt(JSON.stringify({ datasetVersion: version, ...rest }))
    const expected = JSON.stringify(rest, null, 2)
    expect(excerpt).toBe(expected.length <= LIMIT ? expected : `${cutAtLimit(expected)}${MARK}`)
  })

  test.prop([notJson])("shows a body that is not JSON as it is, cut at the limit without a mark", (text) => {
    expect(responseExcerpt(text)).toBe(cutAtLimit(text))
  })

  test.prop([notJsonWithPairs])("never leaves a lone high surrogate at the end of the cut", (text) => {
    const excerpt = responseExcerpt(text)
    expect(excerpt).toBe(cutAtLimit(text))
    expect(/[\uD800-\uDBFF]$/.test(excerpt)).toBe(false)
  })
})
