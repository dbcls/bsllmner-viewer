import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { newQueryClient, wrapper, wrapperFor } from "../query"

type SelectBody = { q: string | null; clauses: Record<string, string>[]; mode: string }

const OLD_RANGE = { field: "date_published", from: "2015-01-01", to: "2016-12-31" }
const NEW_RANGE = { field: "date_published", from: "2018-01-01", to: "2019-12-31" }
const Q = "date_published:[2015-01-01 TO 2016-12-31]"
const HUMAN = { field: "organism_id", value: "9606" }
const HUMAN_Q = "organism_id:9606"
const HUMAN_Q_UNSELECTED = "organism_id:9606 OR organism_id:9606"

const state = vi.hoisted(() => ({
  selects: [] as SelectBody[],
  releaseParse: undefined as (() => void) | undefined,
}))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (_path: string, init: { params: { query: { q: string } } }) => {
    // The parse answers only when the test releases it, as a slow network would.
    await new Promise<void>((resolve) => {
      state.releaseParse = resolve
    })
    const q = init.params.query.q
    if (q === HUMAN_Q_UNSELECTED) {
      // The api does not name the clause as selected, whatever the AST looks like.
      return ok({ q, ast: { field: HUMAN.field, op: "eq", value: HUMAN.value }, labels: {}, selected: [], keyword: "" })
    }
    const isOld = q === Q
    const ast = isOld ? { field: "date_published", op: "between", from: OLD_RANGE.from, to: OLD_RANGE.to } : null
    return ok({ q, ast, labels: {}, selected: isOld ? [OLD_RANGE] : [], keyword: "" })
  }
  const POST = async (_path: string, init: { body: SelectBody }) => {
    state.selects.push(init.body)
    if (init.body.clauses[0]?.["field"] === HUMAN.field) {
      const ast = { field: HUMAN.field, op: "eq", value: HUMAN.value }
      return ok({ dsl: HUMAN_Q, ast, labels: { "9606": "Homo sapiens" }, selected: [HUMAN], keyword: "" })
    }
    const removed = init.body.clauses.some((c) => c["from"] === OLD_RANGE.from)
    const dsl = removed ? null : "date_published:[2018-01-01 TO 2019-12-31]"
    return ok({ dsl, ast: null, labels: {}, selected: [], keyword: "" })
  }
  return { ...original, api: { GET, POST } }
})

import { useCondition } from "~/features/workspace/use-condition"
import { DEFAULTS } from "~/lib/workspace-state"

beforeEach(() => {
  state.selects.length = 0
})

describe("useCondition replaceField", () => {
  it("removes the field's present clauses even when the parsed condition is still loading", async () => {
    const update = vi.fn()
    const { result } = renderHook(() => useCondition(Q, update, () => ({ ...DEFAULTS, q: Q })), { wrapper })
    expect(result.current.ast).toBeNull()

    let replaced: Promise<unknown> = Promise.resolve()
    act(() => {
      replaced = result.current.replaceField("date_published", NEW_RANGE)
    })
    await act(async () => {
      state.releaseParse?.()
      await replaced
    })

    expect(state.selects.map((s) => s.clauses)).toEqual([[OLD_RANGE], [NEW_RANGE]])
    expect(state.selects[1]?.q).toBeNull()
    expect(update).toHaveBeenCalledWith({ q: "date_published:[2018-01-01 TO 2019-12-31]" })
  })

  it("adds the clause directly when the condition has no clause on the field", async () => {
    const update = vi.fn()
    const { result } = renderHook(() => useCondition("organism_id:9606", update, () => ({ ...DEFAULTS, q: "organism_id:9606" })), { wrapper })

    let replaced: Promise<unknown> = Promise.resolve()
    act(() => {
      replaced = result.current.replaceField("date_published", NEW_RANGE)
    })
    await act(async () => {
      state.releaseParse?.()
      await replaced
    })

    expect(state.selects.map((s) => s.clauses)).toEqual([[NEW_RANGE]])
    expect(state.selects[0]?.q).toBe("organism_id:9606")
  })
})

describe("useCondition toggle", () => {
  it("shows the changed condition as soon as q changes, before a parse of the new q answers", async () => {
    // One client for every render, so that the cache outlives the rerender.
    const own = wrapperFor(newQueryClient())
    let q: string | null = null
    const update = vi.fn((patch: { q?: string | null }) => {
      q = patch.q ?? null
    })
    const { result, rerender } = renderHook(() => useCondition(q, update, () => ({ ...DEFAULTS, q })), { wrapper: own })

    await act(async () => {
      await result.current.toggle([HUMAN])
    })
    rerender()

    expect(q).toBe(HUMAN_Q)
    expect(result.current.isSelected([HUMAN])).toBe(true)
    expect(result.current.labels).toEqual({ "9606": "Homo sapiens" })
  })
})

describe("useCondition toggleNarrow", () => {
  it("narrows the condition to the element's clauses when the condition does not have them", async () => {
    const update = vi.fn()
    const { result } = renderHook(() => useCondition(null, update, () => ({ ...DEFAULTS, q: null })), { wrapper })

    await act(async () => {
      await result.current.toggleNarrow(null, [HUMAN], null)
    })

    expect(state.selects).toEqual([{ q: null, clauses: [HUMAN], mode: "narrow" }])
    expect(update).toHaveBeenLastCalledWith({ q: HUMAN_Q })
  })

  it("widens the condition back to the population when the condition has the element's clauses", async () => {
    const own = wrapperFor(newQueryClient())
    let q: string | null = null
    const update = vi.fn((patch: { q?: string | null }) => {
      q = patch.q ?? null
    })
    const { result, rerender } = renderHook(() => useCondition(q, update, () => ({ ...DEFAULTS, q })), { wrapper: own })
    await act(async () => {
      await result.current.toggleNarrow(null, [HUMAN], null)
    })
    rerender()
    expect(result.current.isSelected([HUMAN])).toBe(true)

    await act(async () => {
      await result.current.toggleNarrow(Q, [HUMAN], HUMAN_Q)
    })

    expect(state.selects).toHaveLength(1)
    expect(q).toBe(Q)
  })
})

describe("useCondition isSelected", () => {
  it("follows the selected clauses of the api, not the AST", async () => {
    const { result } = renderHook(() => useCondition(HUMAN_Q_UNSELECTED, vi.fn(), () => ({ ...DEFAULTS, q: HUMAN_Q_UNSELECTED })), { wrapper })
    await act(async () => {
      state.releaseParse?.()
    })
    await waitFor(() => expect(result.current.ast).not.toBeNull())

    expect(result.current.isSelected([HUMAN])).toBe(false)
  })

  it("is false for no clauses", () => {
    const { result } = renderHook(() => useCondition(null, vi.fn(), () => ({ ...DEFAULTS, q: null })), { wrapper })
    expect(result.current.isSelected([])).toBe(false)
  })
})
