import { QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { newQueryClient } from "../query"

const posts = vi.hoisted(() => [] as { path: string; body: { q: string | null } }[])
const DATE = { field: "date_published", from: "2019-01-01", to: "2019-12-31" }

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: { q?: string } } }) => {
    if (path === "/api/dataset") {
      return ok({ datasetVersion: { name: "test" }, fields: [], targetAssays: [], assays: [], organisms: [], ontologies: [], totals: { biosample: 1, experiment: 0, bioproject: 0 } })
    }
    if (path === "/api/dsl/parse") {
      const q = init?.params?.query?.q ?? null
      return ok({ q, ast: null, labels: {}, selected: [DATE], keyword: "" })
    }
    return ok({ elements: [], total: 0 })
  }
  const POST = async (path: string, init: { body: { q: string | null } }) => {
    posts.push({ path, body: init.body })
    return ok({ dsl: init.body.q, ast: null, labels: {}, selected: [], keyword: "" })
  }
  return { ...original, api: { GET, POST } }
})

import { ConditionPanel } from "~/features/workspace/condition-panel"
import { useWorkspaceState } from "~/features/workspace/state"
import { useCondition } from "~/features/workspace/use-condition"

// The data router builds each Request with the AbortSignal of jsdom. The Request of Node (undici) accepts only its own
// AbortSignal and throws a TypeError. The Request class below drops the signal, so the data router can build its requests.
const NativeRequest = globalThis.Request
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal: _signal, ...rest } = init ?? {}
    super(input, rest)
  }
}

const Page = () => {
  const [state, update, latest] = useWorkspaceState()
  const condition = useCondition(state.q, update, latest)
  return <ConditionPanel q={state.q} condition={condition} onAddTerm={() => undefined} />
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  posts.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

const mount = async (q?: string) => {
  const router = createMemoryRouter([{ path: "/entries", element: <Page /> }], { initialEntries: [q ? `/entries?q=${encodeURIComponent(q)}` : "/entries"] })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await advance(0)
}

const keywordPosts = (...keywords: string[]) => keywords.map((keyword) => ({ path: "/api/dsl/keyword", body: { q: null, keyword } }))

describe("Keyword box", () => {
  it("applies the typed words when the box loses focus before the typing pause ends", async () => {
    await mount()
    const box = screen.getByRole("textbox", { name: "Keyword" })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: "cancer" } })
    await advance(200)
    fireEvent.blur(box)
    await advance(0)
    expect(posts).toEqual(keywordPosts("cancer"))
    expect(box).toHaveValue("cancer")
    await advance(1000)
    expect(posts).toHaveLength(1)
  })

  it("applies the words once after a pause in typing, and not while the typing goes on", async () => {
    await mount()
    const box = screen.getByRole("textbox", { name: "Keyword" })
    fireEvent.focus(box)
    for (const text of ["l", "li", "liv", "live", "liver"]) {
      fireEvent.change(box, { target: { value: text } })
      await advance(400)
    }
    expect(posts).toEqual([])
    await advance(100)
    expect(posts).toEqual(keywordPosts("liver"))
    await advance(1000)
    expect(posts).toEqual(keywordPosts("liver"))
  })

  it("applies once when Enter comes before the typing pause ends", async () => {
    await mount()
    const box = screen.getByRole("textbox", { name: "Keyword" })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: "liver" } })
    fireEvent.keyDown(box, { key: "Enter" })
    await advance(1000)
    expect(posts).toEqual(keywordPosts("liver"))
  })

  it("waits for the end of a composition before the typing pause starts", async () => {
    await mount()
    const box = screen.getByRole("textbox", { name: "Keyword" })
    fireEvent.focus(box)
    fireEvent.compositionStart(box)
    fireEvent.change(box, { target: { value: "かんぞう" } })
    await advance(2000)
    expect(posts).toEqual([])
    fireEvent.compositionEnd(box)
    await advance(600)
    expect(posts).toEqual(keywordPosts("かんぞう"))
  })
})

describe("Publication date", () => {
  it("applies a finished range when a date box loses focus before the typing pause ends", async () => {
    await mount()
    const from = screen.getByLabelText("Published from")
    const to = screen.getByLabelText("Published to")
    fireEvent.focus(from)
    fireEvent.change(from, { target: { value: "2020-01-01" } })
    fireEvent.change(to, { target: { value: "2020-12-31" } })
    await advance(100)
    fireEvent.blur(to)
    await advance(0)
    const applied = [{ path: "/api/dsl/select", body: { q: null, clauses: [{ field: "date_published", from: "2020-01-01", to: "2020-12-31" }], mode: "toggle" } }]
    expect(posts).toEqual(applied)
    await advance(1000)
    expect(posts).toEqual(applied)
  })

  it("removes the date clauses of the condition when All is pressed", async () => {
    const q = "date_published:[2019-01-01 TO 2019-12-31]"
    await mount(q)
    fireEvent.click(screen.getByRole("button", { name: "All" }))
    await advance(0)
    expect(posts).toEqual([{ path: "/api/dsl/select", body: { q, clauses: [DATE], mode: "toggle" } }])
  })

  it("does not apply when the focus moves from one date box to the other", async () => {
    await mount()
    const from = screen.getByLabelText("Published from")
    const to = screen.getByLabelText("Published to")
    fireEvent.change(from, { target: { value: "2020-01-01" } })
    fireEvent.blur(from, { relatedTarget: to })
    expect(posts).toEqual([])
  })

  it("does not apply a reversed range on blur", async () => {
    await mount()
    const from = screen.getByLabelText("Published from")
    fireEvent.change(from, { target: { value: "2020-01-01" } })
    fireEvent.change(screen.getByLabelText("Published to"), { target: { value: "2019-01-01" } })
    fireEvent.blur(from)
    await advance(1000)
    expect(posts).toEqual([])
  })
})
