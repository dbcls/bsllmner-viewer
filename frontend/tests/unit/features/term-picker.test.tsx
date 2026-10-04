import { act, fireEvent, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

type TermsQuery = { query?: string; field?: string; facetSelfExclude?: boolean }

const state = vi.hoisted(() => ({ releaseSlow: undefined as (() => void) | undefined, requests: [] as string[], queries: [] as TermsQuery[] }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (_path: string, init: { params: { query: TermsQuery } }) => {
    const query = init.params.query.query ?? ""
    state.requests.push(query)
    state.queries.push(init.params.query)
    const field = init.params.query.field ?? null
    // The search for "slow" answers only when the test releases it, as a slow network would.
    if (query === "slow") {
      await new Promise<void>((resolve) => {
        state.releaseSlow = resolve
      })
    }
    const terms = Array.from({ length: 30 }, (_, index) => ({
      field: field ?? "tissue",
      termId: `T:${field ?? "all"}:${query}:${index}`,
      label: `${field ?? "all"} ${query} ${index}`,
      ontology: "uberon",
      path: [],
      descendantCount: 0,
      count: 30 - index,
      matchedSynonym: null,
      clauses: [],
    }))
    const data = { field, query, populationQ: null, unit: "biosample", terms }
    return ok(data)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { TermPicker } from "~/features/workspace/term-picker/term-picker"
import type { TermHit } from "~/lib/api/types"

/** The wait after the last keystroke that the search promises. It is written here so that a change of the wait fails the test. */
const DEBOUNCE_MS = 200

beforeEach(() => {
  state.requests = []
  state.queries = []
  state.releaseSlow = undefined
})

const renderPicker = (isSelected: (hit: TermHit) => boolean = () => false) => {
  renderWithQuery(
    <TermPicker open onClose={vi.fn()} fields={["tissue", "disease"]} q={null} isSelected={isSelected} onPick={vi.fn()} />,
  )
  const list = screen.getByRole("dialog").querySelector<HTMLElement>(".max-h-picker-list")
  if (!list) throw new Error("no result list")
  return list
}

describe("TermPicker", () => {
  it("searches terms with self-exclusion", async () => {
    renderPicker()
    await screen.findByText("all 0")
    fireEvent.change(screen.getByRole("textbox", { name: "Search terms by label, synonym, or ID" }), { target: { value: "liver" } })
    await screen.findByText((_, element) => element?.textContent === "all liver 0")
    expect(state.queries.length).toBeGreaterThanOrEqual(2)
    for (const query of state.queries) expect(query).toHaveProperty("facetSelfExclude", true)
  })

  it("opens with the focus in the search box", () => {
    renderPicker()
    expect(screen.getByRole("textbox", { name: "Search terms by label, synonym, or ID" })).toHaveFocus()
  })

  it("shows the results of another field from the top", async () => {
    const user = userEvent.setup()
    const list = renderPicker()
    await screen.findByText("all 0")
    list.scrollTop = 200

    await user.click(screen.getByRole("combobox", { name: "Field" }))
    await user.click(screen.getByRole("option", { name: "Tissue" }))
    await screen.findByText("tissue 0")
    expect(list.scrollTop).toBe(0)
  })

  it("keeps the place in the previous results until the results of a new query arrive, and then shows them from the top", async () => {
    const list = renderPicker()
    await screen.findByText("all 0")
    list.scrollTop = 200

    fireEvent.change(screen.getByRole("textbox", { name: "Search terms by label, synonym, or ID" }), { target: { value: "slow" } })
    await vi.waitFor(() => expect(state.releaseSlow).toBeDefined())
    expect(screen.getByText("all 0")).toBeInTheDocument()
    expect(list.scrollTop).toBe(200)

    await act(async () => {
      state.releaseSlow?.()
    })
    // The label is split where the query is marked, so it is found by the text of the whole label.
    await screen.findByText((_, element) => element?.textContent === "all slow 0")
    expect(list.scrollTop).toBe(0)
  })

  it("searches once with the trimmed text, 200 ms after typing stops", async () => {
    renderPicker()
    await screen.findByText("all 0")
    state.requests.length = 0
    vi.useFakeTimers()
    try {
      const input = screen.getByRole("textbox", { name: "Search terms by label, synonym, or ID" })
      // Each millisecond is its own step, so that a request that starts earlier than the debounce is seen.
      for (const value of ["h", "hy", "hyp"]) {
        fireEvent.change(input, { target: { value } })
        for (let elapsed = 1; elapsed < DEBOUNCE_MS; elapsed++) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1)
          })
        }
      }
      // The trimmed text is the same, so the wait does not start again.
      fireEvent.change(input, { target: { value: " hyp " } })
      expect(state.requests).toEqual([])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(state.requests).toEqual(["hyp"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows the results of an emptied search immediately, without a wait for the debounce", async () => {
    renderPicker()
    await screen.findByText("all 0")
    const input = screen.getByRole("textbox", { name: "Search terms by label, synonym, or ID" })
    fireEvent.change(input, { target: { value: "liver" } })
    await screen.findByText((_, element) => element?.textContent === "all liver 0")
    vi.useFakeTimers()
    try {
      fireEvent.change(input, { target: { value: " " } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText("all 0")).toBeInTheDocument()
      expect(screen.queryByText((_, element) => element?.textContent === "all liver 0")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("marks a term that the condition already has", async () => {
    renderPicker((hit) => hit.termId === "T:all::0")
    const row = (await screen.findByText("all 0")).closest("button") as HTMLElement
    expect(row).toHaveTextContent("✓ in condition")
    expect(screen.getAllByText("✓ in condition")).toHaveLength(1)
  })
})
