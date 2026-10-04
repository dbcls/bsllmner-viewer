import { fireEvent, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string) => {
    if (path === "/api/entries/{type}") {
      const item = { identifier: "SAMD1", title: "t", organism: null, libraryStrategy: [], bioprojects: [], datePublished: null, annotations: {} }
      return ok({ items: [item], pagination: { page: 1, perPage: 20, total: 1 } })
    }
    return ok({ fields: [], totals: { biosample: 1 }, ontologies: [], targetAssays: [] })
  }
  return { ...original, api: { ...original.api, GET } }
})

import { SamplesTab } from "~/features/workspace/samples/samples-tab"

const LocationState = () => <p data-testid="back">{JSON.stringify(useLocation().state)}</p>

const renderRoutes = () =>
  renderWithQuery(
    <MemoryRouter initialEntries={["/entries"]}>
      <Routes>
        <Route path="/entries" element={<SamplesTab state={DEFAULTS} onPage={vi.fn()} onPastEnd={vi.fn()} onPerPage={vi.fn()} search="?q=x" />} />
        <Route path="/entries/:accession" element={<LocationState />} />
      </Routes>
    </MemoryRouter>,
  )

describe("SamplesTab", () => {
  afterEach(() => vi.restoreAllMocks())

  it("opens the sample page in the same tab, with the state for the back link, when a row is clicked", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    renderRoutes()
    await userEvent.click(await screen.findByText("t"))
    expect(await screen.findByTestId("back")).toHaveTextContent("?q=x")
    expect(open).not.toHaveBeenCalled()
  })

  it.each(["ctrlKey", "metaKey"] as const)("opens the sample page in a new tab when a row is clicked with %s", async (key) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    renderRoutes()
    fireEvent.click(await screen.findByText("t"), { [key]: true })
    expect(open).toHaveBeenCalledWith("/entries/SAMD1", "_blank", "noopener")
    expect(screen.queryByTestId("back")).toBeNull()
  })

  it("does not open the sample page when the middle button presses an external link of the row", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    renderWithQuery(
      <MemoryRouter>
        <SamplesTab state={DEFAULTS} onPage={vi.fn()} onPastEnd={vi.fn()} onPerPage={vi.fn()} search="" />
      </MemoryRouter>,
    )
    const link = (await screen.findByText("DDBJ")).closest("a") as HTMLElement
    fireEvent.mouseDown(link, { button: 1 })
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }))
    expect(open).not.toHaveBeenCalled()
    fireEvent(screen.getByText("t"), new MouseEvent("auxclick", { bubbles: true, button: 1 }))
    expect(open).toHaveBeenCalledTimes(1)
  })
})
