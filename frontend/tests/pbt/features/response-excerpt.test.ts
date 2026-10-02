import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { responseExcerpt } from "~/features/workspace/overlays"

const LIMIT = 2500
const MARK = "\n  …"

const body = fc.dictionary(fc.string(), fc.jsonValue()).filter((rest) => !Object.hasOwn(rest, "datasetVersion"))

describe("responseExcerpt", () => {
  test.prop([body, fc.jsonValue()])("shows the body without datasetVersion, cut at the limit with a mark", (rest, version) => {
    const excerpt = responseExcerpt(JSON.stringify({ datasetVersion: version, ...rest }))
    const expected = JSON.stringify(rest, null, 2)
    if (expected.length <= LIMIT) {
      expect(excerpt).toBe(expected)
    } else {
      expect(excerpt).toBe(`${expected.slice(0, LIMIT)}${MARK}`)
    }
  })

  test.prop([fc.string({ maxLength: 4000 })])("never shows more than the limit and its mark", (text) => {
    expect(responseExcerpt(text).length).toBeLessThanOrEqual(LIMIT + MARK.length)
  })
})
