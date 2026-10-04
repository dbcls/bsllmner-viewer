import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { formatPercent } from "~/lib/format"

describe("formatPercent", () => {
  const valueAndTotal = fc.integer({ min: 1, max: 1_000_000 }).chain((total) => fc.tuple(fc.integer({ min: 0, max: total }), fc.constant(total)))

  test.prop([valueAndTotal])("writes 0% and 100% only for 0 and the whole", ([value, total]) => {
    const text = formatPercent(value, total)
    expect(text === "0%").toBe(value === 0)
    expect(text === "100%").toBe(value === total)
  })
})
