import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { DEFAULTS, PROJECT_SORTS, readState, TABLE_PER_PAGES, TABS, type WorkspaceState, writeState } from "~/lib/workspace-state"

/** The URL parameter that stores each member. A record, so that the type checker reports a member that has no parameter here. */
const PARAM: Record<keyof WorkspaceState, string> = {
  q: "q",
  tab: "tab",
  unit: "unit",
  page: "page",
  perPage: "perPage",
  sort: "sort",
  row: "row",
  col: "col",
  rowTerms: "row_terms",
  colTerms: "col_terms",
  color: "color",
  trendField: "trend_field",
  trendTerms: "trend_terms",
  trendFrom: "trend_from",
  trendTo: "trend_to",
  trendCondition: "trend_condition",
  trendAll: "trend_all",
  trendLabels: "trend_labels",
  termIds: "term_ids",
}

/** Text without white space at the ends, which the URL reader trims. */
const trimmed = fc.string({ unit: "grapheme", minLength: 1 }).filter((s) => s === s.trim())
const term = trimmed.filter((s) => !s.includes(","))
const state: fc.Arbitrary<WorkspaceState> = fc
  .record({
    q: fc.option(trimmed, { nil: null }),
    tab: fc.constantFrom(...TABS),
    unit: fc.constantFrom("biosample", "sra-experiment", "bioproject"),
    page: fc.integer({ min: 1, max: 9999 }),
    perPage: fc.constantFrom(...TABLE_PER_PAGES),
    sort: fc.constantFrom(...PROJECT_SORTS),
    row: fc.constantFrom("cell_line", "disease", "library_strategy"),
    col: fc.constantFrom(DEFAULTS.col, "tissue", "drug", "date_published"),
    rowTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 5 }), { nil: null }),
    colTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 5 }), { nil: null }),
    color: fc.constantFrom("count", "ratio"),
    trendField: trimmed,
    trendTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 3 }), { nil: null }),
    trendFrom: fc.option(fc.integer({ min: 1000, max: 9999 }), { nil: null }),
    trendTo: fc.option(fc.integer({ min: 1000, max: 9999 }), { nil: null }),
    trendCondition: fc.boolean(),
    trendAll: fc.boolean(),
    trendLabels: fc.boolean(),
    termIds: fc.boolean(),
  })
  .filter((s) => s.row !== s.col)

describe("workspace state in the URL", () => {
  test.prop({ state }, { numRuns: 1000 })("survives a write and read round trip", ({ state: original }) => {
    expect(readState(writeState(original))).toEqual(original)
  })

  test.prop({ state }, { numRuns: 1000 })("writes a parameter for exactly the members that differ from the default", ({ state: original }) => {
    const expected = (Object.keys(PARAM) as (keyof WorkspaceState)[])
      .filter((key) => original[key] !== DEFAULTS[key])
      .map((key) => PARAM[key])
      .sort()
    expect([...writeState(original).keys()].sort()).toEqual(expected)
  })

  const urlEntries = fc.array(
    fc.tuple(fc.constantFrom(...Object.values(PARAM)), fc.oneof(fc.string(), fc.stringMatching(/^[0-9]{1,6}$/), fc.constantFrom("on", "off", "ratio", " a , b ,", "cell_line", "library_strategy"))),
    { maxLength: 8 },
  )

  test.prop([urlEntries], { numRuns: 2000 })("reads the same state again from the URL that it writes for the state of any URL", (entries) => {
    const read = readState(new URLSearchParams(entries))
    expect(readState(writeState(read))).toEqual(read)
  })

  const unoffered = (offered: readonly string[]) => fc.string().filter((s) => !offered.includes(s))

  test.prop({
    tab: unoffered(TABS),
    unit: unoffered(["biosample", "sra-experiment", "bioproject"]),
    page: fc.string().filter((s) => !/^\d+$/.test(s)),
    perPage: fc.string().filter((s) => !(TABLE_PER_PAGES as readonly number[]).includes(Number(s))),
    sort: unoffered(PROJECT_SORTS),
  })("reads a value that the workspace does not offer as the default", ({ tab, unit, page, perPage, sort }) => {
    const parsed = readState(new URLSearchParams({ tab, unit, page, perPage, sort }))
    expect([parsed.tab, parsed.unit, parsed.perPage, parsed.sort, parsed.page]).toEqual([DEFAULTS.tab, DEFAULTS.unit, DEFAULTS.perPage, DEFAULTS.sort, 1])
  })

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
