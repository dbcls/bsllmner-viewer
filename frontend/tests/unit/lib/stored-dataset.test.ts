// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import { storedDataset } from "~/lib/api/queries"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("storedDataset where the build draws the HTML", () => {
  it("returns nothing and does not read the storage", () => {
    const getItem = vi.fn(() => {
      throw new Error("the storage was read")
    })
    vi.stubGlobal("localStorage", { getItem })
    expect(typeof window).toBe("undefined")
    expect(storedDataset()).toBeUndefined()
    expect(getItem).not.toHaveBeenCalled()
  })
})
