import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { DEFAULTS, PROJECT_SORTS, readState, TABS, type WorkspaceState, writeState } from "~/lib/workspace-state"

const term = fc.stringMatching(/^[A-Z]{2,5}:[0-9]{3,7}$/)
const state: fc.Arbitrary<WorkspaceState> = fc.record({
  q: fc.option(fc.stringMatching(/^[a-z_]+:"?[A-Za-z0-9:.-]+"?( AND [a-z_]+:[A-Za-z0-9]+)*$/), { nil: null }),
  tab: fc.constantFrom(...TABS),
  unit: fc.constantFrom("biosample", "sra-experiment", "bioproject"),
  selfExclusion: fc.boolean(),
  page: fc.integer({ min: 1, max: 9999 }),
  sort: fc.constantFrom(...PROJECT_SORTS),
  row: fc.constantFrom("cell_line", "disease", "library_strategy"),
  col: fc.constantFrom("tissue", "drug", "date_created"),
  rowTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 5 }), { nil: null }),
  colTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 5 }), { nil: null }),
  color: fc.constantFrom("count", "residual"),
  trendField: fc.option(fc.constantFrom("disease", "tissue"), { nil: null }),
  trendTerms: fc.option(fc.uniqueArray(term, { minLength: 1, maxLength: 3 }), { nil: null }),
  expandedStatus: fc.boolean(),
  expanded: fc.uniqueArray(fc.tuple(fc.constantFrom("disease", "tissue"), term).map(([f, t]) => `${f}:${t}`), { maxLength: 4 }),
})

describe("workspace state in the URL", () => {
  test.prop({ state })("survives a write and read round trip", ({ state: original }) => {
    expect(readState(writeState(original))).toEqual(original)
  })

  test.prop({ state })("omits every default from the URL", ({ state: original }) => {
    const params = writeState(original)
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (original[key as keyof WorkspaceState] === value) {
        expect(params.has(key === "selfExclusion" ? "se" : key)).toBe(false)
      }
    }
  })

  test.prop({ tab: fc.string(), unit: fc.string(), page: fc.string(), sort: fc.string() })(
    "falls back to defaults for unknown values",
    ({ tab, unit, page, sort }) => {
      const params = new URLSearchParams({ tab, unit, page, sort })
      const parsed = readState(params)
      expect(TABS).toContain(parsed.tab)
      expect(["biosample", "sra-experiment", "bioproject"]).toContain(parsed.unit)
      expect(parsed.page).toBeGreaterThanOrEqual(1)
      expect(PROJECT_SORTS).toContain(parsed.sort)
    },
  )
})
