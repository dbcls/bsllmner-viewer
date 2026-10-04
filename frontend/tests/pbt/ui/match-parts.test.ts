import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { matchParts } from "~/ui/term-row"

const chars = fc.constantFrom(..."aAbB .-()*+?^$|[]{}\\")
const texts = fc.string({ unit: chars, maxLength: 16 })
const queries = fc.string({ unit: chars, maxLength: 4 })

describe("matchParts", () => {
  test.prop([texts, queries])("joins back into the text, and marks exactly the occurrences of the query, compared without case", (text, query) => {
    const parts = matchParts(text, query)
    const needle = query.trim().toLowerCase()
    expect(parts.map((part) => part.text).join("")).toBe(text)
    expect(parts.every((part) => part.text !== "")).toBe(true)
    for (const part of parts) {
      if (part.match) expect(part.text.toLowerCase()).toBe(needle)
      else if (needle) expect(part.text.toLowerCase()).not.toContain(needle)
    }
    if (!needle) expect(parts.some((part) => part.match)).toBe(false)
  })
})
