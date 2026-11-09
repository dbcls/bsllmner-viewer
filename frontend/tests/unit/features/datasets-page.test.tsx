import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { archivePath, CRATE_AUTHORS, CRATE_PARTS, crateFilePath, CRATES, downloadCommands, partPath } from "~/lib/crate"
import { formatSize } from "~/lib/format"

import { newQueryClient, renderWithQuery, wrapperFor } from "../query"

/** The model of the served dataset, or the status of a failed request for the dataset. */
const net = vi.hoisted(() => ({ dataset: "qwen3.8:27b" as string | 500 }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok, failure } = await import("../query")
  const GET = async (path: string) => {
    if (path === "/api/dataset") {
      if (typeof net.dataset === "number") return failure(net.dataset)
      const datasetVersion = { name: "test", createdAt: "2026-10-30T00:00:00Z", model: net.dataset, digest: "0000000000000000" }
      return ok({ datasetVersion, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    return new Promise(() => undefined)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { DatasetsPage } from "~/features/datasets/datasets-page"

const MARK = "Shown in this viewer"

const renderPage = () =>
  renderWithQuery(
    <MemoryRouter initialEntries={["/datasets"]}>
      <DatasetsPage />
    </MemoryRouter>,
  )

/** Renders the page under a client that the test keeps, and resolves when the request for the dataset has settled. */
const renderSettled = async () => {
  const client = newQueryClient()
  render(
    <MemoryRouter initialEntries={["/datasets"]}>
      <DatasetsPage />
    </MemoryRouter>,
    { wrapper: wrapperFor(client) },
  )
  await waitFor(() => expect(["success", "error"]).toContain(client.getQueryState(["dataset"])?.status))
  return client
}

/** The card of an RO-Crate, found by its model in its heading. */
const card = (model: string): HTMLElement => {
  const heading = screen.getByRole("heading", { level: 2, name: model })
  const found = heading.closest<HTMLElement>("[id]")
  if (!found) throw new Error(`no card for ${model}`)
  return found
}

/** The JSON-LD of the page, read as the search engines read it. */
const jsonLd = () => [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) => JSON.parse(script.textContent ?? "") as unknown)

const setClipboard = (writeText: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
}

beforeEach(() => {
  net.dataset = "qwen3.8:27b"
  localStorage.clear()
})

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard")
})

describe("DatasetsPage", () => {
  it("is titled Datasets, described, and listed at /datasets", async () => {
    renderPage()
    await waitFor(() => expect(document.title).toBe("Datasets | bsllmner-viewer"))
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe(new URL("/datasets", window.location.origin).href)
    expect(document.head.querySelector('meta[name="description"]')).not.toBeNull()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Datasets")
  })

  it("lists every RO-Crate under its fragment, with its archive and the commands that unpack the same archive and check it", () => {
    renderPage()
    for (const crate of CRATES) {
      const element = card(crate.model)
      expect(element.id).toBe(crate.id)
      const archive = within(element).getByRole("link", { name: `Download archive (${formatSize(crate.archiveBytes)})` })
      expect(archive).toHaveAttribute("href", archivePath(crate))
      expect(archive).toHaveAttribute("download")
      const commands = within(element).getByRole("region", { name: `Commands that download ${crate.model}` })
      expect(commands.textContent).toBe(downloadCommands(crate, window.location.origin))
      expect(commands.textContent).toContain(new URL(archivePath(crate), window.location.origin).href)
      expect(commands.textContent).toContain("sha256sum -c provenance/checksums.sha256")
    }
  })

  it("offers the archive of each directory of every RO-Crate, with its size", () => {
    renderPage()
    for (const crate of CRATES) {
      const element = card(crate.model)
      for (const part of CRATE_PARTS) {
        const link = within(element).getByRole("link", { name: `${part}.tar.gz` })
        expect(link).toHaveAttribute("href", partPath(crate, part))
        expect(link).toHaveAttribute("download")
        expect(link.closest("li")).toHaveTextContent(formatSize(crate.partBytes[part]))
      }
    }
  })

  it("explains how to check the files of an archive of a directory, which the commands of the whole RO-Crate do not do", () => {
    renderPage()
    const crate = CRATES[0]
    if (!crate) throw new Error("no RO-Crate")
    fireEvent.click(within(card(crate.model)).getByRole("button", { name: `About the archive of a directory of ${crate.model}` }))
    expect(within(card(crate.model)).getByText(/sha256sum -c --ignore-missing provenance\/checksums\.sha256/)).toBeInTheDocument()
  })

  it("links to the files that a reader opens first, under the release of each RO-Crate", () => {
    renderPage()
    for (const crate of CRATES) {
      for (const path of ["README.md", "ro-crate-metadata.json", "provenance/checksums.sha256"]) {
        expect(within(card(crate.model)).getByRole("link", { name: new RegExp(`^${path}`) })).toHaveAttribute("href", crateFilePath(crate, path))
      }
    }
  })

  it("marks the RO-Crate whose model is the model of the served dataset, and no other", async () => {
    const [served, ...others] = CRATES
    if (!served) throw new Error("no RO-Crate")
    net.dataset = served.model
    await renderSettled()
    expect(within(card(served.model)).getByText(MARK)).toBeInTheDocument()
    for (const crate of others) expect(within(card(crate.model)).queryByText(MARK)).toBeNull()
    expect(screen.getAllByText(MARK)).toHaveLength(1)
  })

  it("moves the mark to the RO-Crate of another model when the served dataset is of that model", async () => {
    const other = CRATES.at(-1)
    if (!other || other === CRATES[0]) throw new Error("fewer than two RO-Crates")
    net.dataset = other.model
    await renderSettled()
    expect(within(card(other.model)).getByText(MARK)).toBeInTheDocument()
    expect(screen.getAllByText(MARK)).toHaveLength(1)
  })

  it("marks no RO-Crate, and still lists them all, when no RO-Crate has the model of the served dataset", async () => {
    net.dataset = "qwen3.8"
    const client = await renderSettled()
    expect(client.getQueryState(["dataset"])?.status).toBe("success")
    expect(screen.queryByText(MARK)).toBeNull()
    expect(screen.getAllByRole("link", { name: /Download archive/ })).toHaveLength(CRATES.length)
  })

  it("marks no RO-Crate, and shows no error, when the dataset cannot be loaded", async () => {
    net.dataset = 500
    const client = await renderSettled()
    expect(client.getQueryState(["dataset"])?.status).toBe("error")
    expect(screen.queryByText(MARK)).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getAllByRole("link", { name: /Download archive/ })).toHaveLength(CRATES.length)
  })

  it("describes each RO-Crate in a schema.org Dataset, with its archive as its download and its authors by their ORCID", () => {
    renderPage()
    const [schemas] = jsonLd()
    expect(jsonLd()).toHaveLength(1)
    expect(schemas).toHaveLength(CRATES.length)
    for (const [index, crate] of CRATES.entries()) {
      const schema = (schemas as Record<string, unknown>[])[index]
      expect(schema).toMatchObject({
        "@type": "Dataset",
        url: new URL(`/datasets#${crate.id}`, window.location.origin).href,
        datePublished: crate.datePublished,
        distribution: [{ "@type": "DataDownload", contentUrl: new URL(archivePath(crate), window.location.origin).href, contentSize: formatSize(crate.archiveBytes) }],
      })
      expect((schema?.["creator"] as { "@id": string }[]).map((person) => person["@id"])).toEqual(CRATE_AUTHORS.map((author) => author.orcid))
      expect(String(schema?.["name"])).toContain(crate.model)
    }
  })

  it("copies the commands of an RO-Crate as they are shown", async () => {
    const writeText = vi.fn(async () => undefined)
    setClipboard(writeText)
    renderPage()
    const crate = CRATES[0]
    if (!crate) throw new Error("no RO-Crate")
    await act(async () => {
      fireEvent.click(within(card(crate.model)).getByRole("button", { name: "Copy" }))
    })
    expect(writeText).toHaveBeenCalledWith(downloadCommands(crate, window.location.origin))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says that the copy failed when the clipboard refuses the commands", async () => {
    setClipboard(async () => {
      throw new Error("denied")
    })
    renderPage()
    const crate = CRATES[0]
    if (!crate) throw new Error("no RO-Crate")
    await act(async () => {
      fireEvent.click(within(card(crate.model)).getByRole("button", { name: "Copy" }))
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Copy failed.")
  })
})
