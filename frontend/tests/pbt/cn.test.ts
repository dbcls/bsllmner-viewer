import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { cn } from "~/ui/cn"

const token = fc.string({
  unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
  minLength: 1,
  maxLength: 12,
})

describe("cn", () => {
  test.prop({ tokens: fc.array(token, { maxLength: 20 }) })(
    "never produces leading, trailing, or doubled spaces",
    ({ tokens }) => {
      const result = cn(...tokens)
      expect(result.startsWith(" ")).toBe(false)
      expect(result.endsWith(" ")).toBe(false)
      expect(result.includes("  ")).toBe(false)
    },
  )

  test.prop({ tokens: fc.array(token, { minLength: 1, maxLength: 20 }) })(
    "keeps every non-empty input as a token",
    ({ tokens }) => {
      const resultTokens = cn(...tokens).split(" ")
      for (const item of tokens) {
        expect(resultTokens).toContain(item)
      }
    },
  )
})
