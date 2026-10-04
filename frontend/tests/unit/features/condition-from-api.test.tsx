import { fc, test } from "@fast-check/vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import type { AstNode, Clause } from "~/lib/api/types"

import { wrapper } from "../query"

type Body = { q: string | null; clauses?: Clause[]; keyword?: string }
type Parsed = { ast: AstNode | null; labels: Record<string, string>; selected: Clause[]; keyword: string }

const state = vi.hoisted(() => ({
  parse: { ast: null, labels: {}, selected: [], keyword: "" } as Parsed,
  /** The conditions that the select and keyword requests answered with. */
  answers: [] as string[],
}))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (_path: string, init: { params: { query: { q: string } } }) => ok({ q: init.params.query.q, ...state.parse })
  // The answer is marked, so that a condition that the frontend builds from a request is told from the answer.
  const POST = async (path: string, _init: { body: Body }) => {
    const dsl = `<${path} answer ${state.answers.length}>`
    state.answers.push(dsl)
    return ok({ dsl, ast: null, labels: {}, selected: [], keyword: "" })
  }
  return { ...original, api: { GET, POST } }
})

import { useCondition } from "~/features/workspace/use-condition"
import { DEFAULTS } from "~/lib/workspace-state"

const RNA: Clause = { field: "library_strategy", value: "RNA-Seq" }
const START = "disease:MONDO:1 AND library_strategy:RNA-Seq"

beforeEach(() => {
  state.parse = { ast: null, labels: {}, selected: [], keyword: "" }
  state.answers = []
})

/** A hook for the condition START, whose parse answers with the clause RNA as selected. */
const mount = () => {
  state.parse = { ast: null, labels: {}, selected: [RNA], keyword: "" }
  const update = vi.fn()
  const { result } = renderHook(() => useCondition(START, update, () => ({ ...DEFAULTS, q: START })), { wrapper })
  return { result, update }
}

describe("useCondition writes", () => {
  it.each<[string, (condition: ReturnType<typeof useCondition>) => unknown]>([
    ["toggle", (condition) => condition.toggle([{ field: "disease", value: "MONDO:2" }])],
    ["remove", (condition) => condition.remove([RNA])],
    ["removeField", (condition) => condition.removeField("library_strategy")],
    ["replaceField", (condition) => condition.replaceField("library_strategy", { field: "library_strategy", value: "ChIP-Seq" })],
    ["toggleNarrow", (condition) => condition.toggleNarrow("disease:MONDO:1", [{ field: "cell_type", value: "CL:1" }], START)],
    ["setKeyword", (condition) => condition.setKeyword("liver AND kidney")],
  ])("writes the condition of the API answer, and nothing else, to the URL after %s", async (_name, operation) => {
    const { result, update } = mount()
    await waitFor(() => expect(result.current.selected).toEqual([RNA]))
    await act(async () => {
      await operation(result.current)
    })
    expect(state.answers.length).toBeGreaterThan(0)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ q: state.answers[state.answers.length - 1] })
  })
})

const text = fc.string({ maxLength: 12 })
const clause: fc.Arbitrary<Clause> = fc.record({ field: text, value: text })
const parsed: fc.Arbitrary<Parsed> = fc.record({
  ast: fc.option(fc.record({ field: text, op: fc.constant("eq"), value: text }) as fc.Arbitrary<AstNode>, { nil: null }),
  labels: fc.dictionary(text, text, { maxKeys: 4 }),
  selected: fc.array(clause, { maxLength: 4 }),
  keyword: text,
})
/** Conditions that no parser reads: free text, text of the DSL that does not agree with the response, and an unbalanced quote. */
const q = fc.oneof(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.constantFrom('disease:"MONDO:1', "(((", "NOT NOT", "library_strategy:RNA-Seq AND keyword:abc", 'x:"a b" OR y:z'),
)

describe("useCondition reads", () => {
  test.prop([q, parsed], { numRuns: 25 })("the AST, the labels, the selected clauses, and the keyword text only from the parse response", async (condition, response) => {
    state.parse = response
    const update = vi.fn()
    const { result, unmount } = renderHook(() => useCondition(condition, update, () => ({ ...DEFAULTS, q: condition })), { wrapper })
    try {
      await waitFor(() => expect(result.current.parsing).toBe(false))
      expect(result.current.ast).toEqual(response.ast)
      expect(result.current.labels).toEqual(response.labels)
      expect(result.current.selected).toEqual(response.selected)
      expect(result.current.keywordText).toBe(response.keyword)
      for (const each of response.selected) expect(result.current.isSelected([each])).toBe(true)
      expect(update).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it("does not select a clause that the text of q names and the parse response lacks", async () => {
    state.parse = { ast: null, labels: {}, selected: [], keyword: "" }
    const { result } = renderHook(() => useCondition(START, vi.fn(), () => ({ ...DEFAULTS, q: START })), { wrapper })
    await waitFor(() => expect(result.current.parsing).toBe(false))
    expect(result.current.isSelected([RNA])).toBe(false)
    expect(result.current.keywordText).toBe("")
  })
})
