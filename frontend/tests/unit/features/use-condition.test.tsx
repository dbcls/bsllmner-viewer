import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

type SelectBody = { q: string | null; clauses: Record<string, string>[]; mode: string }

const OLD_RANGE = { field: "date_created", from: "2015-01-01", to: "2016-12-31" }
const NEW_RANGE = { field: "date_created", from: "2018-01-01", to: "2019-12-31" }
const Q = "date_created:[2015-01-01 TO 2016-12-31]"

const state = vi.hoisted(() => ({
  selects: [] as SelectBody[],
  releaseParse: undefined as (() => void) | undefined,
}))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const GET = async (_path: string, init: { params: { query: { q: string } } }) => {
    // The parse answers only when the test releases it, as a slow network would.
    await new Promise<void>((resolve) => {
      state.releaseParse = resolve
    })
    const ast = init.params.query.q === Q ? { field: "date_created", op: "between", from: OLD_RANGE.from, to: OLD_RANGE.to } : null
    return { data: { q: init.params.query.q, ast, labels: {} }, response: new Response("{}") }
  }
  const POST = async (_path: string, init: { body: SelectBody }) => {
    state.selects.push(init.body)
    const removed = init.body.clauses.some((c) => c["from"] === OLD_RANGE.from)
    const dsl = removed ? null : "date_created:[2018-01-01 TO 2019-12-31]"
    return { data: { dsl, ast: null, labels: {} }, response: new Response("{}") }
  }
  return { ...original, api: { GET, POST } }
})

import { useCondition } from "~/features/workspace/use-condition"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)

beforeEach(() => {
  state.selects.length = 0
})

describe("useCondition replaceField", () => {
  it("removes the field's present clauses even when the parsed condition is still loading", async () => {
    const update = vi.fn()
    const { result } = renderHook(() => useCondition(Q, update), { wrapper })
    expect(result.current.ast).toBeNull()

    let replaced: Promise<void> = Promise.resolve()
    act(() => {
      replaced = result.current.replaceField("date_created", NEW_RANGE)
    })
    await act(async () => {
      state.releaseParse?.()
      await replaced
    })

    expect(state.selects.map((s) => s.clauses)).toEqual([[OLD_RANGE], [NEW_RANGE]])
    expect(state.selects[1]?.q).toBeNull()
    expect(update).toHaveBeenCalledWith({ q: "date_created:[2018-01-01 TO 2019-12-31]" })
  })

  it("adds the clause directly when the condition has no clause on the field", async () => {
    const update = vi.fn()
    const { result } = renderHook(() => useCondition("organism_id:9606", update), { wrapper })

    let replaced: Promise<void> = Promise.resolve()
    act(() => {
      replaced = result.current.replaceField("date_created", NEW_RANGE)
    })
    await act(async () => {
      state.releaseParse?.()
      await replaced
    })

    expect(state.selects.map((s) => s.clauses)).toEqual([[NEW_RANGE]])
    expect(state.selects[0]?.q).toBe("organism_id:9606")
  })
})
