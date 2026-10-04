import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Link, MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params: { query?: { q?: string } } }) => {
    if (path === "/api/dataset") {
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    // The condition "a" has 13 entries. The count of any other condition stays on its way.
    if (path === "/api/entries/{type}" && init?.params.query?.q === "a") {
      return ok({ datasetVersion: VERSION, pagination: { page: 1, perPage: 1, total: 13 }, items: [] })
    }
    return new Promise(() => undefined)
  }
  const POST = () => new Promise(() => undefined)
  return { ...original, api: { ...original.api, GET, POST } }
})

import { WorkspacePage } from "~/features/workspace/workspace-page"

vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn() })

/** The texts of the entry exports in the Export menu, opened and closed again. */
const entryExports = async (user: ReturnType<typeof userEvent.setup>): Promise<string[]> => {
  await user.click(screen.getByRole("button", { name: "Export" }))
  const texts = screen.getAllByRole("menuitem").slice(0, 2).map((item) => item.textContent ?? "")
  await user.keyboard("{Escape}")
  return texts
}

describe("the Export menu of the workspace", () => {
  it("shows no size while the number of entries of a new condition is on its way, instead of the size of the condition before", async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <MemoryRouter initialEntries={["/entries?q=a"]}>
        <WorkspacePage />
        <Link to="/entries?q=b">Change the condition</Link>
      </MemoryRouter>,
    )
    await waitFor(async () => expect(await entryExports(user)).toEqual(["TSV~3.9 KB", "NDJSON~13 KB"]))
    await user.click(screen.getByRole("link", { name: "Change the condition" }))
    expect(await entryExports(user)).toEqual(["TSV", "NDJSON"])
  })
})
