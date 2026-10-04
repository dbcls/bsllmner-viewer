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
        const inside = list.filter((year) => first <= year && year <= last)
        inside.forEach((year, index) => index > 0 && expect(year).toBe((inside[index - 1] ?? 0) + 1))
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
    "offers both chosen years in each select, no first year after the later chosen year, and no last year before the earlier one",
    ({ span: { first, last }, from, to }) => {
      const start = from ?? first
      const end = to ?? last
      const choices = yearChoices(first, last, from, to)
      expect(choices.from).toEqual(expect.arrayContaining([start, end]))
      expect(choices.to).toEqual(expect.arrayContaining([start, end]))
      expect(Math.max(...choices.from)).toBe(Math.max(start, end))
      expect(Math.min(...choices.to)).toBe(Math.min(start, end))
    },
  )

  test.prop({ span, far: fc.integer({ min: 100_000, max: 1_000_000_000 }) })("does not list the years between the data and a far chosen year", ({ span: { first, last }, far }) => {
    const choices = yearChoices(first, last, far, null)
    expect(choices.from.length).toBeLessThanOrEqual(last - first + 2)
    expect(choices.to.length).toBeLessThanOrEqual(last - first + 2)
  })
})
