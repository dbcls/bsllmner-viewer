import { describe, expect, it, vi } from "vitest"

import { replaceIfCurrent } from "~/features/workspace/use-past-end"
import { DEFAULTS } from "~/lib/workspace-state"

describe("replaceIfCurrent", () => {
  it("replaces the page when the URL still has the condition and the page that the count was for", () => {
    const update = vi.fn()
    replaceIfCurrent(() => ({ ...DEFAULTS, q: "a:b", page: 9 }), update)(3, { q: "a:b", page: 9 })
    expect(update).toHaveBeenCalledWith({ page: 3 }, { replace: true })
  })

  it("leaves the URL alone when the condition or the page changed since", () => {
    const update = vi.fn()
    replaceIfCurrent(() => ({ ...DEFAULTS, q: "c:d", page: 1 }), update)(3, { q: "a:b", page: 9 })
    replaceIfCurrent(() => ({ ...DEFAULTS, q: "a:b", page: 2 }), update)(3, { q: "a:b", page: 9 })
    expect(update).not.toHaveBeenCalled()
  })

  it("does not write the URL when only the condition changed since the count", () => {
    const update = vi.fn()
    replaceIfCurrent(() => ({ ...DEFAULTS, q: "c:d", page: 9 }), update)(3, { q: "a:b", page: 9 })
    replaceIfCurrent(() => ({ ...DEFAULTS, q: null, page: 9 }), update)(3, { q: "a:b", page: 9 })
    expect(update).not.toHaveBeenCalled()
  })

  it("writes the page when the URL and the count both have no condition", () => {
    const update = vi.fn()
    replaceIfCurrent(() => ({ ...DEFAULTS, q: null, page: 9 }), update)(3, { q: null, page: 9 })
    expect(update).toHaveBeenCalledWith({ page: 3 }, { replace: true })
  })
})
