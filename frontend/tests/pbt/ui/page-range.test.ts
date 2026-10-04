import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { pageAfterLast, pageCount, pageRange } from "~/ui/page-range"

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

  test.prop([list.chain(([total, perPage]) => fc.tuple(fc.constant(total), fc.constant(perPage), fc.integer({ min: 1, max: pageCount(total, perPage) })))])(
    "fill every page before the last one with exactly perPage items",
    ([total, perPage, page]) => {
      if (total === 0 || page === pageCount(total, perPage)) return
      const range = pageRange(page, perPage, total)
      expect(range).not.toBeNull()
      expect((range?.to ?? 0) - (range?.from ?? 0) + 1).toBe(perPage)
    },
  )
})

describe("pageAfterLast", () => {
  test.prop([list, fc.integer({ min: 1, max: 1_000_000 })])("gives a page that holds items, or the empty first page, for a page past the end", ([total, perPage], page) => {
    const last = pageAfterLast(page, total, perPage)
    if (page <= pageCount(total, perPage)) {
      expect(last).toBeNull()
      return
    }
    expect(last).toBe(pageCount(total, perPage))
    expect(pageAfterLast(last ?? 0, total, perPage)).toBeNull()
  })
})
