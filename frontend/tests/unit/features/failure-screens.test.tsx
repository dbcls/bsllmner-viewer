import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as Router from "react-router"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

type Mode = "ok" | 400 | 404 | 422 | 500 | "network"

const routeError = vi.hoisted(() => ({ value: undefined as unknown }))

vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof Router>()), useRouteError: () => routeError.value }))

const net = vi.hoisted(() => ({ dataset: "ok" as Mode, entry: "ok" as Mode, terms: "ok" as Mode }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok, failure } = await import("../query")
  const answer = <T,>(mode: Mode, data: T) => {
    if (mode === "network") throw new TypeError("Failed to fetch")
    return mode === "ok" ? ok(data) : failure(mode)
  }
  const GET = async (path: string) => {
    if (path === "/api/dataset") {
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 1 }
      return answer(net.dataset, { datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    if (path === "/api/terms") return answer(net.terms, { field: null, query: "liver", populationQ: null, unit: "biosample", terms: [] })
    if (path === "/api/entries/biosample/{accession}") {
      return answer(net.entry, { identifier: "SAMD1", type: "biosample", title: null, organism: null, datePublished: null, run: "run", metadata: [], annotations: [], experiments: [], bioprojects: [] })
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { SamplePage } from "~/features/sample/sample-page"
import { ApiModal } from "~/features/workspace/overlays"
import { TermPicker } from "~/features/workspace/term-picker/term-picker"
import { ErrorBoundary } from "~/root"
import { Footer } from "~/shell/footer"

vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn() })

beforeEach(() => {
  net.dataset = "ok"
  net.entry = "ok"
  net.terms = "ok"
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn() })
})

describe("the sample page", () => {
  const renderSample = () =>
    renderWithQuery(
      <MemoryRouter>
        <SamplePage accession="SAMD1" />
      </MemoryRouter>,
    )

  it.each([500, "network"] as const)("offers to try again when the BioSample cannot be loaded (%s)", async (mode) => {
    net.entry = mode
    renderSample()
    expect(await screen.findByText("Could not load this BioSample.")).toBeInTheDocument()
    net.entry = "ok"
    await userEvent.click(screen.getByRole("button", { name: /^Try again/ }))
    await vi.waitFor(() => expect(screen.queryByText("Could not load this BioSample.")).toBeNull())
  })

  it.each([404, 422, 400] as const)("says that a BioSample that the api does not take is not in the dataset, without offering to try again (%s)", async (status) => {
    net.entry = status as never
    renderSample()
    expect(await screen.findByText("BioSample SAMD1 is not in the dataset.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Try again/ })).toBeNull()
  })

  it("puts the notice in the main landmark, which the skip link of the shell targets", async () => {
    net.entry = 404 as never
    renderSample()
    const notice = await screen.findByText("BioSample SAMD1 is not in the dataset.")
    expect(screen.getByRole("main")).toHaveAttribute("id", "main")
    expect(screen.getByRole("main")).toContainElement(notice)
  })
})

describe("the term picker", () => {
  it("shows a notice with Try again in place of the results when the search fails", async () => {
    net.terms = 500
    renderWithQuery(<TermPicker open onClose={vi.fn()} fields={["disease"]} q={null} isSelected={() => false} onPick={vi.fn()} />)
    await userEvent.type(screen.getByRole("textbox", { name: "Search terms by label, synonym, or ID" }), "liver")
    expect(await screen.findByText("Could not search terms.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Try again/ })).toBeInTheDocument()
    net.terms = "ok"
    await userEvent.click(screen.getByRole("button", { name: /^Try again/ }))
    expect(await screen.findByText(/No matching term/)).toBeInTheDocument()
  })
})

describe("the footer", () => {
  it("shows no sentence about loading while the dataset loads", () => {
    renderWithQuery(<Footer />)
    expect(screen.queryByText(/loading/i)).toBeNull()
  })

  it("says that the dataset information is unavailable when it cannot be loaded", async () => {
    net.dataset = 500
    renderWithQuery(<Footer />)
    expect(await screen.findByText("Dataset information is unavailable")).toBeInTheDocument()
  })
})

describe("the API dialog", () => {
  const renderModal = () => renderWithQuery(<ApiModal open onClose={vi.fn()} state={DEFAULTS} onAlert={vi.fn()} />)

  it("shows no Loading text while the response is on its way", () => {
    vi.stubGlobal("fetch", () => new Promise(() => undefined))
    renderModal()
    expect(screen.queryByText(/loading/i)).toBeNull()
  })

  it("shows the status of a failed response in one line", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500 }), { status: 500 }))
    renderModal()
    expect(await screen.findByText("500 Internal Server Error")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Try again/ })).toBeInTheDocument()
  })

  it("says that the server could not be reached when the request fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch")
    })
    renderModal()
    expect(await screen.findByText("Could not reach the server.")).toBeInTheDocument()
  })

  it("offers Try again for a response of the server but not for a refused request", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ title: "Bad Request", status: 400 }), { status: 400 }))
    renderModal()
    expect(await screen.findByText("400 Bad Request")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Try again/ })).toBeNull()
  })

  it("shows the response of a successful request", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ total: 3 }), { status: 200 }))
    renderModal()
    expect(await screen.findByText(/"total": 3/)).toBeInTheDocument()
  })
})

describe("the error boundary of the route", () => {
  const renderBoundary = (error: unknown) => {
    routeError.value = error
    render(
      <MemoryRouter>
        <ErrorBoundary />
      </MemoryRouter>,
    )
  }

  it("links to the top page when the page does not exist", async () => {
    renderBoundary({ status: 404, statusText: "Not Found", internal: false, data: "" })
    expect(await screen.findByText("404 Not Found")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to the top page" })).toHaveAttribute("href", "/")
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull()
  })

  it("puts the message in the main landmark and offers a link that skips to it", async () => {
    renderBoundary({ status: 404, statusText: "Not Found", internal: false, data: "" })
    const main = await screen.findByRole("main")
    expect(main).toHaveAttribute("id", "main")
    expect(main).toHaveTextContent("404 Not Found")
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main")
  })

  it("offers to reload the page for any other failure", async () => {
    const reload = vi.fn()
    vi.stubGlobal("location", { ...window.location, reload })
    renderBoundary(new Error("boom"))
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Go to the top page" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Reload" }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
