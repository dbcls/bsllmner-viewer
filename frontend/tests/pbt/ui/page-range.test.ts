import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { pageCount, pageRange } from "~/ui/page-range"

const list = fc.tuple(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 1, max: 100 }))

describe("page ranges", () => {
  test.prop([list])("cover the items of the list once, page after page", ([total, perPage]) => {
    const count = pageCount(total, perPage)
    if (total === 0) {
      expect(count).toBe(1)
      expect(pageRange(1, perPage, total)).toBeNull()
      return
    }
    expect(pageRange(1, perPage, total)?.from).toBe(1)
    expect(pageRange(count, perPage, total)?.to).toBe(total)
    expect(pageRange(count + 1, perPage, total)).toBeNull()
  })

  test.prop([list.chain(([total, perPage]) => fc.tuple(fc.constant(total), fc.constant(perPage), fc.integer({ min: 1, max: pageCount(total, perPage) })))])(
    "hold at most one page of items, starting right after the previous page",
    ([total, perPage, page]) => {
      const range = pageRange(page, perPage, total)
      if (total === 0) return
      expect(range).not.toBeNull()
      expect((range?.to ?? 0) - (range?.from ?? 0) + 1).toBeLessThanOrEqual(perPage)
      expect(range?.from).toBe(page === 1 ? 1 : (pageRange(page - 1, perPage, total)?.to ?? 0) + 1)
    },
  )
})
