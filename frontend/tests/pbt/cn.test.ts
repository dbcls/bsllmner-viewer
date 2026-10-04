import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { cn } from "~/ui/cn"

const token = fc.string({
  unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
  minLength: 1,
  maxLength: 12,
})

const space = fc.constantFrom("", " ", "  ", "\t", "\n")
const padded = fc.tuple(space, token, space).map(([before, word, after]) => before + word + after)
const blank = fc.constantFrom(" ", "  ")

describe("cn", () => {
  test.prop({ inputs: fc.array(fc.oneof(padded, blank), { maxLength: 20 }) })(
    "joins the trimmed string inputs in order with one space and drops inputs of white space only",
    ({ inputs }) => {
      expect(cn(...inputs)).toBe(
        inputs
          .map((input) => input.trim())
          .filter((input) => input !== "")
          .join(" "),
      )
    },
  )
})
