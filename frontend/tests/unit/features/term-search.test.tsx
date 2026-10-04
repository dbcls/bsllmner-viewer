import { act, fireEvent, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { failure, renderWithQuery } from "../query"

const state = vi.hoisted(() => ({ queries: [] as string[], mode: "ok" as "ok" | "none" | 500 }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: { query?: string } } }) => {
    if (path === "/api/terms") {
      const query = init?.params?.query?.query ?? ""
      state.queries.push(query)
      if (state.mode === 500) return failure(500)
      const term = { field: "tissue", termId: "T:1", label: `hit ${query}`, ontology: "uberon", path: [], descendantCount: 0, count: 1, matchedSynonym: null, clauses: [{ field: "tissue", value: "T:1" }] }
      return ok({ field: null, query, populationQ: null, unit: "biosample", terms: state.mode === "none" ? [] : [term] })
    }
    return ok({ fields: [{ name: "tissue", count: 1 }], totals: { biosample: 1 }, ontologies: [] })
  }
  const POST = async (_path: string, init: { body: { clauses: { field: string; value: string }[] } }) => {
    const [clause] = init.body.clauses
    return ok({ dsl: `${clause?.field}:${clause?.value}`, ast: {}, labels: {} })
  }
  return { ...original, api: { ...original.api, GET, POST } }
})

import { TermSearch } from "~/features/landing/term-search"
import { TERM_SEARCH_DEBOUNCE_MS } from "~/lib/terms"

describe("TermSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.queries.length = 0
    state.mode = "ok"
  })
  afterEach(() => vi.useRealTimers())

  it("does not request the terms of an empty query while the typed text waits for the debounce", async () => {
    renderWithQuery(
      <MemoryRouter>
        <TermSearch />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "l" } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(state.queries).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(state.queries).toEqual(["l"])
  })

  const renderSearch = () =>
    renderWithQuery(
      <MemoryRouter>
        <TermSearch />
      </MemoryRouter>,
    )

  /** Types the text and lets the debounce, the search, and the request for the link of each term finish. */
  const search = async (text: string) => {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: text } })
    for (const ms of [TERM_SEARCH_DEBOUNCE_MS, 50, 50]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
    }
  }

  it("links each found term to the workspace with the condition of the term", async () => {
    renderSearch()
    await search("liver")
    expect(screen.getByRole("link", { name: /T:1/ })).toHaveAttribute("href", "/entries?q=tissue%3AT%3A1")
  })

  it("says that no term matches when the api finds none", async () => {
    state.mode = "none"
    renderSearch()
    await search("liver")
    expect(screen.getByText("No matching term. Try a synonym or a term ID.")).toBeInTheDocument()
  })

  it("shows a notice with Try again in place of the results when the search fails", async () => {
    state.mode = 500
    renderSearch()
    await search("liver")
    expect(screen.getByText("Could not search terms.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Try again/ })).toBeInTheDocument()
  })

  it("returns to the list of fields and empties the search box when the search is cleared", async () => {
    renderSearch()
    await search("liver")
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }))
    expect(screen.getByRole("textbox")).toHaveValue("")
    expect(screen.getByText("Annotation terms")).toBeInTheDocument()
  })
})
