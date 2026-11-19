import { QueryClientProvider } from "@tanstack/react-query"
import { act, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { newQueryClient } from "../query"

const DATASET = {
  datasetVersion: { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" },
  version: {},
  targetAssays: ["RNA-Seq"],
  assays: [],
  fields: [],
  dslFields: [],
  statuses: {},
  totals: { biosample: 1234, experiment: 1, bioproject: 1 },
  organisms: [],
  ontologies: [],
}

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  // The footer requests the dataset, and this mock never answers. A test that needs the dataset puts it in the storage.
  const GET = () => new Promise(() => undefined)
  return { ...original, api: { ...original.api, GET } }
})

import { DATASET_STORAGE_KEY } from "~/lib/api/queries"
import { HydrateFallback } from "~/root"
import { ShellLayout } from "~/shell"

/** What the root layout draws in the body: the shell around the placeholder of the built HTML, or around a page. */
const body = (children: ReactNode) => (
  <MemoryRouter>
    <QueryClientProvider client={newQueryClient()}>
      <ShellLayout>{children}</ShellLayout>
    </QueryClientProvider>
  </MemoryRouter>
)

/** The HTML that the build writes, in an element of the document. */
const builtHtml = () => {
  const container = document.createElement("div")
  container.innerHTML = renderToString(body(<HydrateFallback />))
  document.body.append(container)
  return container
}

const skipLink = (container: HTMLElement) => within(container).getByRole("link", { name: "Skip to main content" })
const datasetLine = (container: HTMLElement) => within(container).getByRole("contentinfo").querySelector("p")

let container: HTMLElement | null = null
let root: Root | null = null

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe("the HTML that the build makes", () => {
  it("has the skip link, the header with its links, and the footer with its fixed lines", () => {
    container = builtHtml()
    const page = within(container)
    expect(skipLink(container)).toHaveAttribute("href", "#main")
    expect(page.getByRole("link", { name: "bsllmner-viewer" })).toHaveAttribute("href", "/")
    const primary = within(page.getByRole("navigation", { name: "Primary" }))
    expect(primary.getAllByRole("link")).toHaveLength(4)
    const datasets = primary.getByRole("link", { name: "Datasets" })
    expect(datasets).toHaveAttribute("href", "/datasets")
    expect(datasets).not.toHaveAttribute("target")
    const footer = page.getByRole("contentinfo")
    expect(within(footer).getByText(/NIG supercomputer/)).toBeInTheDocument()
    expect(within(footer).queryByText(/RO-Crate/)).toBeNull()
    expect(within(footer).getAllByRole("img")).toHaveLength(4)
  })

  it("leaves the page between the header and the footer empty", () => {
    container = builtHtml()
    expect(within(container).queryByRole("main")).toBeNull()
    expect(within(container).queryByRole("heading")).toBeNull()
  })

  it("keeps the place of the dataset line without a sentence about loading", () => {
    container = builtHtml()
    expect(datasetLine(container)?.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(within(container).queryByText(/loading/i)).toBeNull()
  })

  it("keeps the place of the dataset line when the browser has the dataset of the last visit", () => {
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(DATASET))
    container = builtHtml()
    expect(datasetLine(container)?.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(datasetLine(container)).not.toHaveTextContent("Dataset")
  })
})

describe("the app that takes over the built HTML", () => {
  /** Hydrates the built HTML, and returns the errors that React reports while the app draws. */
  const takeOver = async (built: HTMLElement) => {
    const errors: unknown[] = []
    const logged = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args))
    await act(async () => {
      root = hydrateRoot(built, body(<HydrateFallback />), { onRecoverableError: (error) => void errors.push(error) })
      await Promise.resolve()
    })
    return { errors, logged }
  }

  it("draws what the HTML has in its first render, and then the dataset of the last visit", async () => {
    // The build has no storage, and the browser that opens the HTML has the dataset of the last visit.
    container = builtHtml()
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(DATASET))
    const { errors } = await takeOver(container)
    expect(errors).toEqual([])
    expect(datasetLine(container)).toHaveTextContent("Dataset: BioSamples with RNA-Seq experiments")
    expect(datasetLine(container)).toHaveTextContent("1,234 BioSamples")
  })

  it("keeps the elements of the shell, and the focus of a link that had it before the app ran", async () => {
    container = builtHtml()
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(DATASET))
    const skip = skipLink(container)
    const header = within(container).getByRole("banner")
    const footer = within(container).getByRole("contentinfo")
    skip.focus()
    expect(document.activeElement).toBe(skip)

    const { errors } = await takeOver(container)
    expect(errors).toEqual([])
    expect(skipLink(container)).toBe(skip)
    expect(document.activeElement).toBe(skip)

    // The router replaces the placeholder with the page inside the same shell.
    await act(async () => {
      root?.render(body(<main id="main">page</main>))
      await Promise.resolve()
    })
    expect(within(container).getByRole("main")).toHaveTextContent("page")
    expect(skipLink(container)).toBe(skip)
    expect(within(container).getByRole("banner")).toBe(header)
    expect(within(container).getByRole("contentinfo")).toBe(footer)
    expect(document.activeElement).toBe(skip)
    expect(errors).toEqual([])
  })
})
