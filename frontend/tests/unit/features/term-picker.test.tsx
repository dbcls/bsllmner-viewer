import { act, fireEvent, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

type TermsQuery = { query?: string; field?: string }

const state = vi.hoisted(() => ({ releaseSlow: undefined as (() => void) | undefined, requests: [] as string[] }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (_path: string, init: { params: { query: TermsQuery } }) => {
    const query = init.params.query.query ?? ""
    state.requests.push(query)
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

const renderPicker = () => {
  renderWithQuery(
    <TermPicker open onClose={vi.fn()} fields={["tissue", "disease"]} q={null} isSelected={() => false} onPick={vi.fn()} />,
  )
  const list = screen.getByRole("dialog").querySelector<HTMLElement>(".max-h-picker-list")
  if (!list) throw new Error("no result list")
  return list
}

describe("TermPicker", () => {
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
    const list = renderPicker()
    await screen.findByText("all 0")
    state.requests.length = 0
    vi.useFakeTimers()
    try {
      const input = screen.getByRole("textbox", { name: "Search terms by label, synonym, or ID" })
      for (const value of ["h", "hy", "hyp", " hyp "]) {
        fireEvent.change(input, { target: { value } })
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50)
        })
      }
      expect(state.requests).toEqual([])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(state.requests).toEqual(["hyp"])
    } finally {
      vi.useRealTimers()
    }
    expect(list).toBeInTheDocument()
  })
})
