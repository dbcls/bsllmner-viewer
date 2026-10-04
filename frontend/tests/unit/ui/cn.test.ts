import { describe, expect, it } from "vitest"

import { cn } from "~/ui/cn"

describe("cn", () => {
  it("omits falsy inputs", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b")
  })

  it("keeps only the keys with a truthy value in an object input", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c")
  })

  it("flattens nested arrays", () => {
    expect(cn(["a", ["b", ["c", null]], false])).toBe("a b c")
  })

  it("returns an empty string without inputs", () => {
    expect(cn()).toBe("")
  })
})
