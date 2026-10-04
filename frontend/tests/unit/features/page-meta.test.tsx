import { render, screen, waitFor } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import type * as Router from "react-router"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { SITE_DESCRIPTION } from "~/lib/site"

import { renderWithQuery } from "../query"

type Mode = "ok" | "pending" | 404 | 500

const routeError = vi.hoisted(() => ({ value: undefined as unknown }))

vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof Router>()), useRouteError: () => routeError.value }))

const net = vi.hoisted(() => ({ entry: "ok" as Mode }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok, failure } = await import("../query")
  const GET = async (path: string, init?: { params: { path: { accession?: string } } }) => {
    if (path === "/api/dataset") {
      const field = { name: "cell_line", multiValued: false, ontologies: ["CLO"], mappedBiosampleCount: 1 }
      const datasetVersion = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
      return ok({ datasetVersion, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    if (path === "/api/entries/biosample/{accession}") {
      if (net.entry === "pending") return new Promise(() => undefined)
      if (net.entry !== "ok") return failure(net.entry)
      const annotation = { field: "cell_line", value: "MCF7", status: "mapped_exact", termId: "CVCL:0031", label: "MCF-7", clauses: [], evidence: [] }
      const organism = { identifier: "9606", name: "Homo sapiens" }
      return ok({ identifier: init?.params.path.accession, type: "biosample", title: "a sample", organism, datePublished: null, run: "run", metadata: [], annotations: [annotation], experiments: [], bioprojects: [] })
    }
    // Whatever else is asked for stays on its way: the tests look at the head of the document only.
    return new Promise(() => undefined)
  }
  const POST = () => new Promise(() => undefined)
  return { ...original, api: { ...original.api, GET, POST } }
})

import { LandingPage } from "~/features/landing/landing-page"
import { SamplePage } from "~/features/sample/sample-page"
import { WorkspacePage } from "~/features/workspace/workspace-page"
import { ErrorBoundary, HydrateFallback } from "~/root"

vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn() })

beforeEach(() => {
  net.entry = "ok"
  localStorage.clear()
})

const head = () => document.head
const canonical = () => head().querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null
const description = () => head().querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null
const robots = () => head().querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null
const titles = () => [...head().querySelectorAll("title")].map((title) => title.textContent)

/** The address of a path on the host of the test page. */
const address = (path: string) => new URL(path, window.location.origin).href

describe("the head of the HTML that the build makes", () => {
  const html = renderToString(
    <html lang="en">
      <head />
      <body>
        <MemoryRouter>
          <HydrateFallback />
        </MemoryRouter>
      </body>
    </html>,
  )
  const builtHead = html.slice(0, html.indexOf("</head>"))

  it("names the site in one title, and describes it, for every URL", () => {
    expect(builtHead.match(/<title>/g)).toHaveLength(1)
    expect(builtHead).toContain("<title>bsllmner-viewer</title>")
    expect(builtHead).toContain(`<meta name="description" content="${SITE_DESCRIPTION}"/>`)
  })

  it("gives the name and the description to the previews of shared links", () => {
    expect(builtHead).toContain('<meta property="og:title" content="bsllmner-viewer"/>')
    expect(builtHead).toContain(`<meta property="og:description" content="${SITE_DESCRIPTION}"/>`)
    expect(builtHead).toContain('<meta property="og:type" content="website"/>')
    expect(builtHead).toContain('<meta property="og:site_name" content="bsllmner-viewer"/>')
    expect(builtHead).toContain('<meta name="twitter:card" content="summary"/>')
  })

  it("names no canonical address and keeps every page open to search engines, as it is the same for every URL", () => {
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('name="robots"')
  })
})

describe("the top page", () => {
  const renderLanding = () =>
    renderWithQuery(
      <MemoryRouter initialEntries={["/?utm_source=x"]}>
        <LandingPage />
      </MemoryRouter>,
    )

  /** The JSON-LD of the page, read as the search engines read it. */
  const jsonLd = () => [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) => JSON.parse(script.textContent ?? "") as Record<string, unknown>)

  it("is titled with the name of the site, described, and listed at /", async () => {
    renderLanding()
    await waitFor(() => expect(titles()).toEqual(["bsllmner-viewer"]))
    expect(description()).toBe(SITE_DESCRIPTION)
    expect(canonical()).toBe(address("/"))
    expect(robots()).toBeNull()
  })

  it("asks crawlers not to follow its links to the workspace with a condition, which robots.txt keeps them away from", async () => {
    renderLanding()
    const toWorkspace = () => screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/entries?"))
    await waitFor(() => expect(toWorkspace().length).toBeGreaterThan(0))
    for (const link of toWorkspace()) expect(link).toHaveAttribute("rel", "nofollow")
  })

  it("describes the dataset in one schema.org Dataset when the dataset has loaded", async () => {
    renderLanding()
    await waitFor(() => expect(jsonLd()).toHaveLength(1))
    expect(jsonLd()[0]).toMatchObject({ "@type": "Dataset", version: "test", url: address("/") })
  })
})

describe("the workspace", () => {
  const renderWorkspace = (url: string) =>
    renderWithQuery(
      <MemoryRouter initialEntries={[url]}>
        <WorkspacePage />
      </MemoryRouter>,
    )

  it("is titled Entries and listed at /entries without a condition", async () => {
    renderWorkspace("/entries")
    await waitFor(() => expect(titles()).toEqual(["Entries | bsllmner-viewer"]))
    expect(canonical()).toBe(address("/entries"))
  })

  it("has the same title for every view and condition, and names no canonical address for them", async () => {
    renderWorkspace("/entries?tab=heatmap&q=organism_id%3A9606")
    await waitFor(() => expect(titles()).toEqual(["Entries | bsllmner-viewer"]))
    expect(canonical()).toBeNull()
  })
})

describe("the BioSample page", () => {
  const renderSample = (accession: string) =>
    renderWithQuery(
      <MemoryRouter initialEntries={[`/entries/${accession}`]}>
        <SamplePage accession={accession} />
      </MemoryRouter>,
    )

  it("is titled with the accession under Entries while the BioSample loads, and names no canonical address yet", async () => {
    net.entry = "pending"
    renderSample("SAMD1")
    await waitFor(() => expect(titles()).toEqual(["SAMD1 | Entries | bsllmner-viewer"]))
    expect(canonical()).toBeNull()
    expect(robots()).toBeNull()
  })

  it("is listed at the address of its accession, and described by its organism and the terms of its annotations", async () => {
    renderSample("SAMD1")
    await screen.findByText("a sample")
    expect(titles()).toEqual(["SAMD1 | Entries | bsllmner-viewer"])
    expect(canonical()).toBe(address("/entries/SAMD1"))
    expect(description()).toBe("Ontology terms of BioSample SAMD1 (Homo sapiens). Cell line: MCF-7.")
    expect(robots()).toBeNull()
  })

  it.each([404, 500] as const)("is kept out of search results when the BioSample cannot be shown (%s)", async (status) => {
    net.entry = status
    renderSample("SAMD1")
    await waitFor(() => expect(robots()).toBe("noindex"))
    expect(titles()).toEqual(["SAMD1 | Entries | bsllmner-viewer"])
    expect(canonical()).toBeNull()
  })
})

describe("the error page of the route", () => {
  const renderBoundary = (error: unknown) => {
    routeError.value = error
    render(
      <MemoryRouter>
        <ErrorBoundary />
      </MemoryRouter>,
    )
  }

  it("is titled Not Found and kept out of search results when the page does not exist", async () => {
    renderBoundary({ status: 404, statusText: "Not Found", internal: false, data: "" })
    await waitFor(() => expect(titles()).toEqual(["Not Found | bsllmner-viewer"]))
    expect(robots()).toBe("noindex")
  })

  it("is titled Error and kept out of search results for any other failure", async () => {
    renderBoundary(new Error("boom"))
    await waitFor(() => expect(titles()).toEqual(["Error | bsllmner-viewer"]))
    expect(robots()).toBe("noindex")
  })
})
