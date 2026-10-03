import { fireEvent, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
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

describe("SamplesTab", () => {
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn() })
  afterEach(() => vi.restoreAllMocks())

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
