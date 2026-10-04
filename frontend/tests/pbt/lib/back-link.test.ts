import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { backHref, backLinkState } from "~/lib/back-link"
import { DEFAULTS, readState, TABS, workspaceSearch, type WorkspaceState } from "~/lib/workspace-state"

const BASE = "http://localhost"

const list: fc.Arbitrary<Partial<WorkspaceState>> = fc.record(
  {
    q: fc.option(fc.string(), { nil: null }),
    tab: fc.constantFrom(...TABS),
    unit: fc.constantFrom("biosample", "sra-experiment", "bioproject"),
    page: fc.integer({ min: 1, max: 9999 }),
  },
  { requiredKeys: [] },
)

describe("backHref", () => {
  test.prop({ list })("returns to the workspace state of the list that the sample was opened from", ({ list: state }) => {
    const search = workspaceSearch(state)
    const back = new URL(backHref(backLinkState(search)), BASE)
    expect(back.pathname).toBe("/entries")
    expect(readState(back.searchParams)).toEqual(readState(new URLSearchParams(search)))
  })

  test.prop({ state: fc.oneof(fc.anything(), fc.record({ from: fc.string() }), fc.record({ from: fc.anything() })) })(
    "stays on the entries page of the same site for any history state",
    ({ state }) => {
      const back = new URL(backHref(state), BASE)
      expect(back.origin).toBe(BASE)
      expect(back.pathname).toBe("/entries")
    },
  )
})

describe("backLinkState", () => {
  test.prop({ search: fc.string() })("survives the structured clone of the history entry", ({ search }) => {
    expect(backHref(structuredClone(backLinkState(search)))).toBe(backHref(backLinkState(search)))
  })

  test("returns to the bare entries page for the state of the whole dataset", () => {
    expect(backHref(backLinkState(workspaceSearch(DEFAULTS)))).toBe("/entries")
  })
})
