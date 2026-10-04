import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { apiRequestsFor } from "~/features/workspace/view-requests"
import { DEFAULTS, readState, TABS, workspaceSearch, writeState } from "~/lib/workspace-state"

const FIELDS = ["disease", "cell_type"]
const SYMBOLS = ['"', "'", "(", ")", ":", "&", "=", "+", "%", "#", "?", "/", "\\", ",", " ", "AND", "OR", "NOT", "é", "日本", "😀"]

/** A q with symbols, quotes, and Unicode, without white space at the ends, which the URL reader trims. */
const q = fc
  .array(fc.oneof(fc.constantFrom(...SYMBOLS), fc.string({ unit: "grapheme", maxLength: 6 })), { minLength: 1, maxLength: 12 })
  .map((parts) => parts.join(""))
  .filter((text) => text.trim() !== "" && text === text.trim())

describe("q of the URL", () => {
  test.prop([q, fc.constantFrom(...TABS)], { numRuns: 300 })("is the q of every API request that the tab makes, unchanged", (text, tab) => {
    const written = writeState({ ...DEFAULTS, tab, q: text })
    expect(readState(written).q).toBe(text)
    // The URL as the browser carries it, so that the encoding of the characters is in the path of the q.
    const state = readState(new URLSearchParams(workspaceSearch({ tab, q: text })))
    expect(state.q).toBe(text)
    const requests = apiRequestsFor(state, FIELDS)
    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) expect(new URL(request, "http://localhost").searchParams.get("q")).toBe(text)
  })
})
