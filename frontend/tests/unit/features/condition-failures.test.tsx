import { act, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS } from "~/lib/workspace-state"

import { renderWithQuery, wrapper } from "../query"

const net = vi.hoisted(() => ({
  parseStatus: 400 as number,
  selectStatus: null as number | null,
  keywordStatus: null as number | null,
  requests: [] as string[],
}))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok, failure } = await import("../query")
  const GET = async (path: string) => {
    net.requests.push(path)
    if (path === "/api/dataset") {
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 1 }
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    if (path === "/api/dsl/parse") return failure(net.parseStatus, "unexpected character at column 1")
    // Every other request never answers, so the notices of the test are those of the condition.
    return new Promise(() => undefined)
  }
  const POST = async (path: string) => {
    if (path === "/api/dsl/keyword" && net.keywordStatus !== null) return failure(net.keywordStatus, "boom")
    if (net.selectStatus === 0) throw new TypeError("Failed to fetch")
    if (net.selectStatus !== null) return failure(net.selectStatus)
    return ok({ dsl: "a:b", ast: null, labels: {}, selected: [], keyword: "" })
  }
  return { ...original, api: { ...original.api, GET, POST } }
})

import { useCondition } from "~/features/workspace/use-condition"
import { WorkspacePage } from "~/features/workspace/workspace-page"

const CLAUSE = { field: "organism_id", value: "9606" }

beforeEach(() => {
  net.parseStatus = 400
  net.selectStatus = null
  net.keywordStatus = null
  net.requests.length = 0
})

describe("useCondition when an operation fails", () => {
  const setup = () => {
    const update = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useCondition(null, update, () => ({ ...DEFAULTS, q: null }), onError), { wrapper })
    return { result, update, onError }
  }

  it.each([500, 400])("reports it with the operation, leaves the condition as it is, and does not throw (%s)", async (status) => {
    net.selectStatus = status
    const { result, update, onError } = setup()
    await act(async () => {
      await result.current.toggle([CLAUSE])
      await result.current.toggleNarrow(null, [CLAUSE], null)
    })
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith("Could not update the condition.")
    expect(update).not.toHaveBeenCalled()
  })

  it("reports a network failure in the same words", async () => {
    const { result, onError } = setup()
    net.selectStatus = 0
    await act(async () => {
      await result.current.toggle([CLAUSE])
    })
    expect(onError).toHaveBeenCalledWith("Could not update the condition.")
  })

  it("still runs the operations that follow a failed one", async () => {
    const { result, update, onError } = setup()
    net.selectStatus = 500
    await act(async () => {
      await result.current.toggle([CLAUSE])
    })
    net.selectStatus = null
    await act(async () => {
      await result.current.toggle([CLAUSE])
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ q: "a:b" })
  })

  it("lets the keyword box show the failure under the box instead", async () => {
    net.keywordStatus = 500
    const { result, onError } = setup()
    await act(async () => {
      await expect(result.current.setKeyword("liver")).rejects.toThrow("boom")
    })
    expect(onError).not.toHaveBeenCalled()
  })
})

describe("the workspace with a condition in the URL that the api rejects", () => {
  const renderPage = () =>
    renderWithQuery(
      <MemoryRouter initialEntries={["/entries?q=%22"]}>
        <WorkspacePage />
      </MemoryRouter>,
    )

  it("says why in the condition bar and offers to clear it", async () => {
    renderPage()
    expect(await screen.findByText("The condition in the URL is not valid: unexpected character at column 1")).toBeInTheDocument()
    expect(screen.queryByText("No condition. All entries of the dataset are shown.")).toBeNull()
    expect(screen.getByText("Fix the condition to see results.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }))
    await vi.waitFor(() => expect(screen.queryByText(/The condition in the URL is not valid/)).toBeNull())
  })

  it("asks the api for nothing more once it knows that the condition is not valid", async () => {
    renderPage()
    await screen.findByText(/The condition in the URL is not valid/)
    const asked = net.requests.length
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(net.requests).toHaveLength(asked)
    expect(net.requests.filter((path) => path === "/api/dsl/parse")).toHaveLength(1)
  })

  it("shows no view while the condition in the URL is not valid", async () => {
    renderPage()
    await screen.findByText(/The condition in the URL is not valid/)
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("offers to try again, not a verdict on the condition, when the parse fails on the server", async () => {
    net.parseStatus = 500
    renderPage()
    expect(await screen.findByText("Could not load the condition.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Try again/ })).toBeInTheDocument()
    expect(screen.queryByText(/is not valid/)).toBeNull()
  })

  it("is not a verdict on the condition when the parse is refused for another reason than the syntax, as when the api is busy", async () => {
    net.parseStatus = 429
    renderPage()
    expect(await screen.findByText(/^Could not load the condition/)).toBeInTheDocument()
    expect(screen.queryByText(/is not valid/)).toBeNull()
    expect(screen.getByRole("button", { name: /^Try again/ })).toBeInTheDocument()
  })

  it("does not offer Add term, which would search with the condition that the api rejects", async () => {
    renderPage()
    await screen.findByText(/The condition in the URL is not valid/)
    expect(screen.getByRole("button", { name: "Add term" })).toBeDisabled()
  })
})
