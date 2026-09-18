import { describe, expect, it } from "vitest"

import { cn } from "~/ui/cn"

describe("cn", () => {
  it("stringInputs_joinsWithSingleSpace", () => {
    expect(cn("a", "b", "c")).toBe("a b c")
  })

  it("falsyInputs_areOmitted", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b")
  })

  it("objectInput_keepsOnlyTruthyKeys", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c")
  })

  it("nestedArrays_areFlattened", () => {
    expect(cn(["a", ["b", ["c", null]], false])).toBe("a b c")
  })

  it("noInputs_returnsEmptyString", () => {
    expect(cn()).toBe("")
  })
})
