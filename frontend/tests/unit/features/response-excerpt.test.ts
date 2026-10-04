import { describe, expect, it } from "vitest"

import { responseExcerpt } from "~/features/workspace/overlays"

describe("responseExcerpt", () => {
  it("keeps a datasetVersion that is not at the top level", () => {
    const body = { items: [{ datasetVersion: "x" }] }
    expect(responseExcerpt(JSON.stringify(body))).toBe(JSON.stringify(body, null, 2))
  })

  it("keeps a JSON array or scalar as it is", () => {
    expect(responseExcerpt("[1,2]")).toBe(JSON.stringify([1, 2], null, 2))
    expect(responseExcerpt("null")).toBe("null")
    expect(responseExcerpt("3")).toBe("3")
  })

  it("does not mark a body of exactly 2500 characters as cut", () => {
    const value = "x".repeat(2500 - JSON.stringify({ q: "" }, null, 2).length)
    const excerpt = responseExcerpt(JSON.stringify({ q: value }))
    expect(excerpt.length).toBe(2500)
    expect(excerpt.endsWith("…")).toBe(false)
  })

  it("cuts a body that is not JSON without a mark", () => {
    expect(responseExcerpt("Internal Server Error")).toBe("Internal Server Error")
    expect(responseExcerpt("e".repeat(3000))).toBe("e".repeat(2500))
    expect(responseExcerpt("")).toBe("")
  })

  describe("a surrogate pair at the cut", () => {
    const MARK = "\n  …"
    /** The pretty-printed body of `{ q: value }` before the characters of the value. */
    const head = '{\n  "q": "'
    const body = (xs: number) => JSON.stringify({ q: `${"x".repeat(xs)}😀${"y".repeat(20)}` })

    it("cuts one unit earlier when the cut is inside the pair", () => {
      const excerpt = responseExcerpt(body(2499 - head.length))
      expect(excerpt).toBe(`${head}${"x".repeat(2499 - head.length)}${MARK}`)
    })

    it("keeps a pair that ends at the cut", () => {
      const excerpt = responseExcerpt(body(2498 - head.length))
      expect(excerpt).toBe(`${head}${"x".repeat(2498 - head.length)}😀${MARK}`)
    })

    it("cuts a body that is not JSON before a pair that the cut would split", () => {
      expect(responseExcerpt(`${"x".repeat(2499)}😀`)).toBe("x".repeat(2499))
      expect(responseExcerpt(`${"x".repeat(2498)}😀`)).toBe(`${"x".repeat(2498)}😀`)
    })
  })
})
