import { screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { ASSAY_ROWS } from "~/lib/assays"

import { renderWithQuery } from "../query"

type Clause = { field: string; value: string }

const net = vi.hoisted(() => ({ dataset: "ok" as "ok" | "pending" }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string) => {
    if (path !== "/api/dataset" || net.dataset === "pending") return new Promise(() => undefined)
    const datasetVersion = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
    // The api lists the assays and the organisms by their counts, largest first.
    const assays = [
      { name: "RNA-Seq", biosampleCount: 4000 },
      { name: "ChIP-Seq", biosampleCount: 300 },
      { name: "ATAC-seq", biosampleCount: 200 },
      { name: "Bisulfite-Seq", biosampleCount: 100 },
      { name: "OTHER", biosampleCount: 50 },
      { name: "DNase-Hypersensitivity", biosampleCount: 10 },
    ]
    const organisms = [
      { identifier: "9606", name: "Homo sapiens", biosampleCount: 3000 },
      { identifier: "10090", name: "Mus musculus", biosampleCount: 1500 },
      { identifier: "39442", name: "Mus musculus musculus", biosampleCount: 5 },
    ]
    const targetAssays = ["RNA-Seq", "ChIP-Seq", "ATAC-seq", "Bisulfite-Seq", "DNase-Hypersensitivity", "OTHER"]
    return ok({ datasetVersion, version: {}, targetAssays, assays, fields: [], dslFields: [], statuses: {}, totals: { biosample: 4500, experiment: 4700, bioproject: 90 }, organisms, ontologies: [] })
  }
  const POST = async (_path: string, init: { body: { clauses: Clause[] } }) => {
    const [clause] = init.body.clauses
    return ok({ dsl: `${clause?.field}:${clause?.value}`, ast: {}, labels: {} })
  }
  return { ...original, api: { ...original.api, GET, POST } }
})

import { LandingPage } from "~/features/landing/landing-page"

beforeEach(() => {
  net.dataset = "ok"
  localStorage.clear()
})

const renderLanding = () =>
  renderWithQuery(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  )

/** The card of the statistics: the parent of its heading. */
const statistics = (): HTMLElement => {
  const card = screen.getByRole("heading", { name: "Statistics" }).parentElement
  if (!card) throw new Error("the heading of the statistics has no parent")
  return card
}

/**
 * The bars of a field, as the texts of the links that open the workspace with only a clause on the field. A bar is a
 * link after the api returns its condition.
 */
const bars = (field: string): string[] => {
  const only = new RegExp(`^/entries\\?q=${field}%3A[^&]+$`)
  return [...statistics().querySelectorAll("a")].filter((link) => only.test(link.getAttribute("href") ?? "")).map((link) => link.textContent ?? "")
}

describe("the statistics of the landing page", () => {
  it("lists every target assay, in the order of the target assays and not of the counts", async () => {
    renderLanding()
    await waitFor(() => expect(bars("library_strategy")).toEqual(["RNA-Seq4,000", "ChIP-Seq300", "ATAC-seq200", "Bisulfite-Seq100", "DNase-Hypersensitivity10", "OTHER50"]))
  })

  it("lists the two organisms with the most BioSamples", async () => {
    renderLanding()
    await waitFor(() => expect(bars("organism_id")).toEqual(["Homo sapiens3,000", "Mus musculus1,500"]))
  })

  it("keeps a row for each assay and each organism before the description of the dataset arrives", () => {
    net.dataset = "pending"
    renderLanding()
    expect(statistics().querySelectorAll('div[aria-hidden="true"]')).toHaveLength(ASSAY_ROWS + 2)
  })
})
