import { describe, expect, it } from "vitest"

import { backHref, backLinkState } from "~/lib/back-link"

describe("backHref", () => {
  it("returns to the bare entries page for a page opened by its URL", () => {
    expect(backHref(null)).toBe("/entries")
    expect(backHref(undefined)).toBe("/entries")
  })

  it("returns to the bare entries page for an empty search string or a lone question mark", () => {
    expect(backHref(backLinkState(""))).toBe("/entries")
    expect(backHref(backLinkState("?"))).toBe("/entries")
  })

  it("ignores a search string that does not start with a question mark", () => {
    expect(backHref({ from: "/../../elsewhere" })).toBe("/entries")
    expect(backHref({ from: "//example.org" })).toBe("/entries")
    expect(backHref({ from: "q=a" })).toBe("/entries")
  })

  it("ignores a state of another shape", () => {
    expect(backHref({ from: 1 })).toBe("/entries")
    expect(backHref({ usr: { from: "?q=a" } })).toBe("/entries")
    expect(backHref("?q=a")).toBe("/entries")
  })
})
