import { QueryClientProvider } from "@tanstack/react-query"
import { act, render } from "@testing-library/react"
import { createMemoryRouter, RouterProvider, useLocation } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { newQueryClient } from "../query"

type Body = { q: string | null; clauses?: { field: string; value: string }[]; keyword?: string }

/** Every select and keyword request waits until the test releases it, as a slow network would. A failing release answers 500. */
const pending = vi.hoisted(() => [] as { path: string; body: Body; release: (failure?: boolean) => void }[])

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const TERM = /^(\w+):(\w+)$/
  /** The clauses of a condition of the form `a:b AND c:d`. */
  const clausesOf = (q: string | null) => (q ?? "").split(" AND ").flatMap((part) => {
    const match = TERM.exec(part)
    return match ? [{ field: match[1] as string, value: match[2] as string }] : []
  })
  const condition = (dsl: string | null) => ({ dsl, ast: null, labels: {}, selected: clausesOf(dsl), keyword: "" })
  const POST = async (path: string, init: { body: Body }) => {
    const failure = await new Promise<boolean>((resolve) => pending.push({ path, body: init.body, release: (failed = false) => resolve(failed) }))
    if (failure) throw new Error("the api failed")
    const { q, clauses, keyword } = init.body
    if (path === "/api/dsl/select") {
      // A clause that the condition has is removed, and any other is added.
      let parts = (q ?? "").split(" AND ").filter(Boolean)
      for (const clause of clauses ?? []) {
        const text = `${clause.field}:${clause.value}`
        parts = parts.includes(text) ? parts.filter((part) => part !== text) : [...parts, text]
      }
      return ok(condition(parts.join(" AND ") || null))
    }
    return ok(condition([q, keyword].filter(Boolean).join(" AND ") || null))
  }
  const GET = async (_path: string, init: { params: { query: { q: string } } }) => ok({ q: init.params.query.q, ast: null, labels: {}, selected: clausesOf(init.params.query.q), keyword: "" })
  return { ...original, api: { GET, POST } }
})

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

type Hook = ReturnType<typeof useCondition> & { update: ReturnType<typeof useWorkspaceState>[1]; search: string }
const hook = { current: null as unknown as Hook }

const Probe = () => {
  const [state, update, latest] = useWorkspaceState()
  const condition = useCondition(state.q, update, latest)
  hook.current = { ...condition, update, search: useLocation().search }
  return null
}

const mount = (url: string) => {
  const router = createMemoryRouter([{ path: "/entries", element: <Probe /> }], { initialEntries: [url] })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })

const release = async (index: number, ...done: Promise<unknown>[]) => {
  await act(async () => pending[index]?.release())
  await act(async () => {
    await Promise.all(done)
  })
  await flush()
}

const RNA = { field: "assay", value: "RNA" }
const CHIP = { field: "assay", value: "ChIP" }
const params = (search: string) => new URLSearchParams(search)

beforeEach(() => {
  pending.length = 0
})

describe("useWorkspaceState update", () => {
  it("keeps both changes when update is called twice before a render", async () => {
    const router = mount("/entries?q=A")
    await flush()
    act(() => {
      hook.current.update({ tab: "trend" })
      hook.current.update({ unit: "sra-experiment" })
    })
    expect(params(router.state.location.search).get("tab")).toBe("trend")
    expect(params(router.state.location.search).get("unit")).toBe("sra-experiment")
  })

  it("writes a change made by an update of an earlier render on top of the latest URL", async () => {
    const router = mount("/entries?q=A")
    await flush()
    const stale = hook.current.update
    act(() => hook.current.update({ tab: "trend" }))
    act(() => stale({ unit: "sra-experiment" }))
    expect(params(router.state.location.search).get("tab")).toBe("trend")
    expect(params(router.state.location.search).get("unit")).toBe("sra-experiment")
  })
})

describe("useCondition operations", () => {
  it("keeps a tab that the user chose while a select was pending", async () => {
    const router = mount("/entries?q=A")
    await flush()
    let toggled: Promise<unknown> = Promise.resolve()
    act(() => {
      toggled = hook.current.toggle([RNA])
    })
    await flush()
    act(() => hook.current.update({ tab: "trend" }))
    await release(0, toggled)
    const search = params(router.state.location.search)
    expect(search.get("tab")).toBe("trend")
    expect(search.get("q")).toBe("A AND assay:RNA")
  })

  it("sends the request of replaceField from the latest q when replaceField is called on a hook value from before the toggle", async () => {
    mount("/entries?q=A")
    await flush()
    const stale = hook.current
    let first: Promise<unknown> = Promise.resolve()
    act(() => {
      first = hook.current.toggle([RNA])
    })
    await flush()
    await release(0, first)
    let replaced: Promise<unknown> = Promise.resolve()
    act(() => {
      replaced = stale.replaceField("date_published", { field: "date_published", from: "2020-01-01", to: "2020-12-31" })
    })
    await flush()
    expect(pending[1]?.body.q).toBe("A AND assay:RNA")
    await release(1, replaced)
  })

  it("sends the second of two toggles from the q that the first one made", async () => {
    const router = mount("/entries?q=A")
    await flush()
    let first: Promise<unknown> = Promise.resolve()
    let second: Promise<unknown> = Promise.resolve()
    act(() => {
      first = hook.current.toggle([RNA])
      second = hook.current.toggle([CHIP])
    })
    await flush()
    expect(pending).toHaveLength(1)
    await release(0, first)
    expect(pending).toHaveLength(2)
    expect(pending[1]?.body.q).toBe("A AND assay:RNA")
    await release(1, second)
    expect(params(router.state.location.search).get("q")).toBe("A AND assay:RNA AND assay:ChIP")
  })

  it("runs a keyword change after a toggle that was pressed first", async () => {
    const router = mount("/entries?q=A")
    await flush()
    let toggled: Promise<unknown> = Promise.resolve()
    let typed: Promise<unknown> = Promise.resolve()
    act(() => {
      toggled = hook.current.toggle([RNA])
      typed = hook.current.setKeyword("liver")
    })
    await flush()
    await release(0, toggled)
    await release(1, typed)
    expect(params(router.state.location.search).get("q")).toBe("A AND assay:RNA AND liver")
  })

  it("drops a narrowing whose condition changed while it waited", async () => {
    const router = mount("/entries?q=A")
    await flush()
    let toggled: Promise<unknown> = Promise.resolve()
    let narrowed: Promise<unknown> = Promise.resolve()
    act(() => {
      toggled = hook.current.toggle([RNA])
      narrowed = hook.current.toggleNarrow("A", [CHIP], "A")
    })
    await flush()
    await release(0, toggled, narrowed)
    expect(pending).toHaveLength(1)
    expect(params(router.state.location.search).get("q")).toBe("A AND assay:RNA")
  })

  it("runs the next operation from the q of the failed one after it failed", async () => {
    const router = mount("/entries?q=A")
    await flush()
    let failed: Promise<unknown> = Promise.resolve()
    let next: Promise<unknown> = Promise.resolve()
    act(() => {
      failed = hook.current.toggle([RNA])
      next = hook.current.toggle([CHIP])
    })
    const settled = expect(failed).resolves.toBeUndefined()
    await flush()
    await act(async () => {
      pending[0]?.release(true)
      await settled
    })
    await flush()
    expect(pending).toHaveLength(2)
    expect(pending[1]?.body.q).toBe("A")
    await release(1, next)
    expect(params(router.state.location.search).get("q")).toBe("A AND assay:ChIP")
  })
})

describe("useCondition operations that remove clauses", () => {
  it("keeps a clause removed when it is removed twice before the first answer", async () => {
    const router = mount("/entries?q=A AND assay:RNA")
    await flush()
    let first: Promise<unknown> = Promise.resolve()
    let second: Promise<unknown> = Promise.resolve()
    act(() => {
      first = hook.current.remove([RNA])
      second = hook.current.remove([RNA])
    })
    await flush()
    await release(0, first)
    await flush()
    expect(pending).toHaveLength(1)
    await act(async () => {
      await second
    })
    expect(params(router.state.location.search).get("q")).toBe("A")
  })

  it("removes a field after a replacement of the field, and does not restore a clause of the field", async () => {
    const router = mount("/entries?q=A AND date_published:old")
    await flush()
    let replaced: Promise<unknown> = Promise.resolve()
    let removed: Promise<unknown> = Promise.resolve()
    act(() => {
      replaced = hook.current.replaceField("date_published", { field: "date_published", value: "new" })
      removed = hook.current.removeField("date_published")
    })
    await flush()
    await release(0)
    await release(1, replaced)
    await release(2, removed)
    expect(params(router.state.location.search).get("q")).toBe("A")
  })
})

describe("useCondition when the condition changes while an operation waits", () => {
  it("does not restore a condition that Clear all cleared", async () => {
    const router = mount("/entries?q=A")
    await flush()
    let toggled: Promise<unknown> = Promise.resolve()
    act(() => {
      toggled = hook.current.toggle([RNA])
    })
    await flush()
    act(() => hook.current.clear())
    await release(0, toggled)
    expect(params(router.state.location.search).get("q")).toBeNull()
  })

  it("does not restore a keyword change over a condition that was applied as text", async () => {
    const router = mount("/entries?q=A")
    await flush()
    let typed: Promise<unknown> = Promise.resolve()
    act(() => {
      typed = hook.current.setKeyword("liver")
    })
    await flush()
    act(() => hook.current.applyText("B"))
    await release(0, typed)
    expect(params(router.state.location.search).get("q")).toBe("B")
  })

  it("does not write a response over the condition that a Back went to", async () => {
    const router = mount("/entries?q=A")
    await flush()
    act(() => hook.current.update({ q: "B" }))
    let toggled: Promise<unknown> = Promise.resolve()
    act(() => {
      toggled = hook.current.toggle([RNA])
    })
    await flush()
    await act(async () => {
      await router.navigate(-1)
    })
    await release(0, toggled)
    expect(params(router.state.location.search).get("q")).toBe("A")
  })

  it("does not narrow with the population of a table that was drawn for an older condition", async () => {
    mount("/entries?q=A AND assay:RNA")
    await flush()
    let narrowed: Promise<unknown> = Promise.resolve()
    act(() => {
      narrowed = hook.current.toggleNarrow("A", [CHIP], "A")
    })
    await narrowed
    expect(pending).toHaveLength(0)
  })
})

describe("useWorkspaceState update without a change", () => {
  it("adds no history entry when the patch writes the URL that is already there", async () => {
    const router = mount("/entries?q=B")
    await flush()
    await act(async () => {
      await router.navigate("/entries?q=A")
    })
    act(() => hook.current.update({ tab: "samples", page: 1 }))
    act(() => hook.current.update({ tab: "samples", page: 1 }))
    await act(async () => {
      await router.navigate(-1)
    })
    expect(router.state.location.search).toBe("?q=B")
  })
})
