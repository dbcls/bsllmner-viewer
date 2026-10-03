import { act, fireEvent, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

const state = vi.hoisted(() => ({ queries: [] as string[] }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: { query?: string } } }) => {
    if (path === "/api/terms") {
      const query = init?.params?.query?.query ?? ""
      state.queries.push(query)
      const term = { field: "tissue", termId: "T:1", label: `hit ${query}`, ontology: "uberon", path: [], descendantCount: 0, count: 1, matchedSynonym: null, clauses: [] }
      return ok({ field: null, query, populationQ: null, unit: "biosample", terms: [term] })
    }
    return ok({ fields: [{ name: "tissue", count: 1 }], totals: { biosample: 1 }, ontologies: [] })
  }
  return { ...original, api: { ...original.api, GET } }
})

import { TermSearch } from "~/features/landing/term-search"

describe("TermSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.queries.length = 0
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
})
