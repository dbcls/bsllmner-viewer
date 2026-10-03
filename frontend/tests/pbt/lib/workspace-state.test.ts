import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { DEFAULTS, PROJECT_SORTS, readState, TABLE_PER_PAGES, TABS, type WorkspaceState, writeState } from "~/lib/workspace-state"

const term = fc.stringMatching(/^[A-Z]{2,5}:[0-9]{3,7}$/)
const state: fc.Arbitrary<WorkspaceState> = fc.record({
  q: fc.option(fc.stringMatching(/^[a-z_]+:"?[A-Za-z0-9:.-]+"?( AND [a-z_]+:[A-Za-z0-9]+)*$/), { nil: null }),
  tab: fc.constantFrom(...TABS),
  unit: fc.constantFrom("biosample", "sra-experiment", "bioproject"),
  page: fc.integer({ min: 1, max: 9999 }),
  perPage: fc.constantFrom(...TABLE_PER_PAGES),
  sort: fc.constantFrom(...PROJECT_SORTS),
  row: fc.constantFrom("cell_line", "disease", "library_strategy"),
  col: fc.constantFrom("tissue", "drug", "date_published"),
  rowTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 5 }), { nil: null }),
  colTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 5 }), { nil: null }),
  color: fc.constantFrom("count", "ratio"),
  trendField: fc.constantFrom("disease", "tissue", "library_strategy"),
  trendTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 3 }), { nil: null }),
  trendFrom: fc.option(fc.integer({ min: 1900, max: 2100 }), { nil: null }),
  trendTo: fc.option(fc.integer({ min: 1900, max: 2100 }), { nil: null }),
  trendCondition: fc.boolean(),
  trendAll: fc.boolean(),
  trendLabels: fc.boolean(),
  termIds: fc.boolean(),
})

describe("workspace state in the URL", () => {
  test.prop({ state })("survives a write and read round trip", ({ state: original }) => {
    expect(readState(writeState(original))).toEqual(original)
  })

  test.prop({ state })("omits every default from the URL", ({ state: original }) => {
    const params = writeState(original)
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (original[key as keyof WorkspaceState] === value) {
        expect(params.has(key)).toBe(false)
      }
    }
  })

  test.prop({ tab: fc.string(), unit: fc.string(), page: fc.string(), perPage: fc.string(), sort: fc.string() })(
    "falls back to defaults for unknown values",
    ({ tab, unit, page, perPage, sort }) => {
      const params = new URLSearchParams({ tab, unit, page, perPage, sort })
      const parsed = readState(params)
      expect(TABS).toContain(parsed.tab)
      expect(["biosample", "sra-experiment", "bioproject"]).toContain(parsed.unit)
      expect(parsed.page).toBeGreaterThanOrEqual(1)
      expect(TABLE_PER_PAGES).toContain(parsed.perPage)
      expect(PROJECT_SORTS).toContain(parsed.sort)
    },
  )

  /** Dimensions that include both defaults, so that a URL can name either default for both axes. */
  const dimension = fc.constantFrom(DEFAULTS.row, DEFAULTS.col, "disease", "tissue")

  test.prop({ row: fc.option(dimension, { nil: null }), col: fc.option(dimension, { nil: null }), colTerms: fc.uniqueArray(term, { minLength: 1, maxLength: 3 }) })(
    "never reads rows and columns of one dimension, and keeps the columns and their terms that the URL names otherwise",
    ({ row, col, colTerms }) => {
      const params = new URLSearchParams({ col_terms: colTerms.join(",") })
      if (row !== null) params.set("row", row)
      if (col !== null) params.set("col", col)
      const parsed = readState(params)
      expect(parsed.row).toBe(row ?? DEFAULTS.row)
      expect(parsed.col).not.toBe(parsed.row)
      const named = col ?? DEFAULTS.col
      if (named !== parsed.row) {
        expect(parsed.col).toBe(named)
        expect(parsed.colTerms).toEqual(colTerms)
      } else {
        expect([DEFAULTS.col, DEFAULTS.row]).toContain(parsed.col)
        expect(parsed.colTerms).toBeNull()
      }
    },
  )

  test.prop({ year: fc.oneof(fc.string(), fc.double().map(String)).filter((s) => !/^\d+$/.test(s)) })(
    "reads a year of the trend that is not a whole number as no limit",
    ({ year }) => {
      const parsed = readState(new URLSearchParams({ trend_from: year, trend_to: year }))
      expect(parsed.trendFrom).toBeNull()
      expect(parsed.trendTo).toBeNull()
    },
  )

  test.prop({ perPage: fc.integer({ min: -1000, max: 1000 }).filter((n) => !(TABLE_PER_PAGES as readonly number[]).includes(n)) })(
    "reads a number of rows per page that the tables do not offer as the default",
    ({ perPage }) => {
      expect(readState(new URLSearchParams({ perPage: String(perPage) })).perPage).toBe(DEFAULTS.perPage)
    },
  )
})
