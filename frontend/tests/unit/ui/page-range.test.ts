import { describe, expect, it } from "vitest"

import { pageAfterLast, pageCount, pageRange } from "~/ui/page-range"

describe("pageCount", () => {
  it("gives an empty list one page and rounds a partial page up", () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
  })
})

describe("pageRange", () => {
  it("gives the positions of the first and the last item of a page", () => {
    expect(pageRange(1, 25, 10)).toEqual({ from: 1, to: 10 })
    expect(pageRange(2, 25, 30)).toEqual({ from: 26, to: 30 })
  })

  it("gives null for an empty list and for a page after the last one", () => {
    expect(pageRange(1, 25, 0)).toBeNull()
    expect(pageRange(3, 25, 30)).toBeNull()
  })
})

describe("pageAfterLast", () => {
  it("gives the last page for a page past it and null otherwise", () => {
    expect(pageAfterLast(6, 100, 20)).toBe(5)
    expect(pageAfterLast(5, 100, 20)).toBeNull()
    expect(pageAfterLast(2, 21, 20)).toBeNull()
    expect(pageAfterLast(3, 21, 20)).toBe(2)
  })

  it("gives page 1 for an empty list", () => {
    expect(pageAfterLast(2, 0, 20)).toBe(1)
    expect(pageAfterLast(1, 0, 20)).toBeNull()
  })
})
