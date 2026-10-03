import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { yearChoices } from "~/features/workspace/trend/years"

const span = fc.tuple(fc.integer({ min: 1990, max: 2030 }), fc.integer({ min: 0, max: 30 })).map(([first, length]) => ({ first, last: first + length }))
const chosen = fc.option(fc.integer({ min: 1980, max: 2040 }), { nil: null })

describe("yearChoices", () => {
  test.prop({ span, from: chosen, to: chosen })(
    "offers every year with a match and the chosen years, each once and in order",
    ({ span: { first, last }, from, to }) => {
      const choices = yearChoices(first, last, from, to)
      for (const list of [choices.from, choices.to]) {
        expect(list).toEqual([...list].sort((a, b) => a - b))
        expect(new Set(list).size).toBe(list.length)
        list.forEach((year, index) => index > 0 && expect(year).toBe((list[index - 1] ?? 0) + 1))
      }
      const start = from ?? first
      const end = to ?? last
      expect(choices.from).toContain(start)
      expect(choices.to).toContain(end)
      if (first <= Math.max(start, end)) expect(choices.from).toContain(first)
      if (last >= Math.min(start, end)) expect(choices.to).toContain(last)
    },
  )

  test.prop({ span, from: chosen, to: chosen })(
    "offers no first year after the last year and no last year before the first year that are chosen, unless the URL reverses them",
    ({ span: { first, last }, from, to }) => {
      const start = from ?? first
      const end = to ?? last
      const choices = yearChoices(first, last, from, to)
      if (start <= end) {
        expect(Math.max(...choices.from)).toBe(end)
        expect(Math.min(...choices.to)).toBe(start)
      }
    },
  )
})
