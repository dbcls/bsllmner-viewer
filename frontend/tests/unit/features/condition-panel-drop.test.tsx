import { QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { newQueryClient } from "../query"

type Body = { q: string | null; clauses?: { field: string; value?: string }[]; keyword?: string }
const pending = vi.hoisted(() => [] as { path: string; body: Body; release: () => void }[])

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const kw = (dsl: string | null) => (dsl ?? "").split(" AND ").filter((p) => p && !p.includes(":")).join(" ")
  const selectedOf = (dsl: string | null) => (dsl ? dsl.split(" AND ") : []).filter((p) => p.includes(":")).map((p) => ({ field: p.slice(0, p.indexOf(":")), value: p.slice(p.indexOf(":") + 1) }))
  const condition = (dsl: string | null) => ({ dsl, ast: dsl ? { field: "x", op: "eq", value: dsl } : null, labels: {}, selected: selectedOf(dsl), keyword: kw(dsl) })
  const POST = async (path: string, init: { body: Body }) => {
    await new Promise<void>((release) => pending.push({ path, body: init.body, release }))
    const { q, keyword, clauses } = init.body
    const parts = (q ? q.split(" AND ") : []).filter((p) => p.includes(":"))
    const added = (clauses ?? []).map((c) => `${c.field}:${c.value ?? "range"}`)
    return ok(condition([...parts, ...added, ...(keyword ? [keyword] : [])].join(" AND ") || null))
  }
  const GET = async (path: string, init?: { params?: { query?: { q?: string } } }) => {
    if (path === "/api/dataset") {
      return ok({ datasetVersion: { name: "test" }, fields: [], targetAssays: [], assays: [], organisms: [], ontologies: [], totals: { biosample: 1, experiment: 0, bioproject: 0 } })
    }
    if (path === "/api/dsl/parse") {
      const q = init?.params?.query?.q ?? null
      return ok({ ...condition(q), q })
    }
    return ok({ elements: [], total: 0 })
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

const hook = { clear: () => undefined as unknown }
const Page = () => {
  const [state, update, latest] = useWorkspaceState()
  const condition = useCondition(state.q, update, latest)
  hook.clear = condition.clear
  return <ConditionPanel q={state.q} condition={condition} onAddTerm={() => undefined} />
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })

const mount = async () => {
  const router = createMemoryRouter([{ path: "/entries", element: <Page /> }], { initialEntries: ["/entries?q=assay:RNA"] })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await flush()
  return router
}

const clearAndRelease = async () => {
  act(() => hook.clear())
  await act(async () => pending[0]?.release())
}

beforeEach(() => {
  pending.length = 0
})

describe("Keyword box when its change is dropped", () => {
  it("shows the latest keywords again after Clear all came before the answer, and sends a later edit again", async () => {
    const router = await mount()
    const box = await screen.findByRole("textbox", { name: "Keyword" })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: "liver" } })
    fireEvent.blur(box)
    await waitFor(() => expect(pending).toHaveLength(1))
    await clearAndRelease()
    expect(new URLSearchParams(router.state.location.search).get("q")).toBeNull()
    await waitFor(() => expect(box).toHaveValue(""))
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: "liver" } })
    fireEvent.blur(box)
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[1]?.body.keyword).toBe("liver")
  })
})

describe("Publication date when its change is dropped", () => {
  it("shows the dates of the latest condition again after Clear all came before the answer, and sends the same dates again", async () => {
    const router = await mount()
    const from = screen.getByLabelText("Published from")
    const to = screen.getByLabelText("Published to")
    fireEvent.change(from, { target: { value: "2020-01-01" } })
    fireEvent.change(to, { target: { value: "2020-12-31" } })
    fireEvent.blur(to)
    await waitFor(() => expect(pending).toHaveLength(1))
    await clearAndRelease()
    expect(new URLSearchParams(router.state.location.search).get("q")).toBeNull()
    await waitFor(() => expect(from).toHaveValue(""))
    expect(to).toHaveValue("")
    fireEvent.change(from, { target: { value: "2020-01-01" } })
    fireEvent.change(to, { target: { value: "2020-12-31" } })
    fireEvent.blur(to)
    await waitFor(() => expect(pending).toHaveLength(2))
  })
})
