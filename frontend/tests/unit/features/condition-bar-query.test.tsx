import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

const net = vi.hoisted(() => ({ parses: [] as string[] }))

/** The parse of the api: a text that starts with "bad" is not a valid condition, and any other text is its own parse. */
vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok, failure } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: { q?: string } } }) => {
    if (path === "/api/dsl/parse") {
      const q = init?.params?.query?.q ?? ""
      net.parses.push(q)
      if (q.startsWith("bad")) return failure(400, "unexpected character at column 1")
      return ok({ datasetVersion: null, q: q.trim(), ast: null, labels: {}, selected: [], keyword: "" })
    }
    // Every other request never answers, so the test sees only the parse.
    return new Promise(() => undefined)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { ConditionBar } from "~/features/workspace/condition-bar"
import type { Condition } from "~/features/workspace/use-condition"

beforeEach(() => {
  net.parses.length = 0
})

const fakeCondition = () =>
  ({
    ast: null,
    selected: [],
    keywordText: "",
    parseError: null,
    parsing: false,
    clear: vi.fn(),
    applyText: vi.fn(),
    retryParse: vi.fn(),
  }) as unknown as Condition

const bar = (q: string | null, condition: Condition) => (
  <MemoryRouter>
    <ConditionBar q={q} condition={condition} onShare={async () => true} onApi={() => undefined} exportMenu={null} />
  </MemoryRouter>
)

/** Renders the bar with the Query display, where the condition is a text box. */
const renderQuery = async (q: string | null) => {
  const condition = fakeCondition()
  const view = renderWithQuery(bar(q, condition))
  await userEvent.click(screen.getByRole("radio", { name: "Query" }))
  const box = screen.getByRole("textbox", { name: "Condition" })
  return { condition, box, rerender: (next: string | null) => view.rerender(bar(next, condition)) }
}

describe("the Query display of the condition bar", () => {
  it("applies the parse of the typed text when Apply is pressed", async () => {
    const { condition, box } = await renderQuery(null)
    await userEvent.type(box, "  organism_id:9606 ")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    await vi.waitFor(() => expect(condition.applyText).toHaveBeenCalledWith("organism_id:9606"))
    expect(condition.applyText).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says why a text that is not a valid condition cannot be applied, and applies nothing", async () => {
    const { condition, box } = await renderQuery(null)
    await userEvent.type(box, "bad(")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected character at column 1")
    expect(condition.applyText).not.toHaveBeenCalled()
  })

  it("removes the message of a failed Apply when the next Apply succeeds", async () => {
    const { condition, box } = await renderQuery(null)
    await userEvent.type(box, "bad(")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    await screen.findByRole("alert")
    await userEvent.clear(box)
    await userEvent.type(box, "organism_id:9606")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    await vi.waitFor(() => expect(condition.applyText).toHaveBeenCalledWith("organism_id:9606"))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("clears the condition without a parse when the text is only white space", async () => {
    const { condition, box } = await renderQuery("organism_id:9606")
    await userEvent.clear(box)
    await userEvent.type(box, "   ")
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(condition.clear).toHaveBeenCalledTimes(1)
    expect(condition.applyText).not.toHaveBeenCalled()
    expect(net.parses).toEqual([])
  })

  it("shows the condition of the URL in the text box, and replaces the typed text when the condition changes", async () => {
    const { box, rerender } = await renderQuery("organism_id:9606")
    expect(box).toHaveValue("organism_id:9606")
    await userEvent.type(box, " AND x")
    rerender("organism_id:10090")
    expect(screen.getByRole("textbox", { name: "Condition" })).toHaveValue("organism_id:10090")
    rerender(null)
    expect(screen.getByRole("textbox", { name: "Condition" })).toHaveValue("")
  })

  it("keeps the typed text while the condition stays the same", async () => {
    const { box, rerender } = await renderQuery("organism_id:9606")
    await userEvent.type(box, " AND x")
    rerender("organism_id:9606")
    expect(screen.getByRole("textbox", { name: "Condition" })).toHaveValue("organism_id:9606 AND x")
  })
})
