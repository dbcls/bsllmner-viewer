import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { DEFAULTS } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

const gene = (index: number) => ({ value: `gene ${index}`, termId: `NCBIGene:${index}`, label: `G${index}`, status: "mapped_exact" })

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string) => {
    if (path === "/api/entries/{type}") {
      const item = {
        identifier: "SAMD1",
        title: "t",
        organism: null,
        libraryStrategy: [],
        bioprojects: ["PRJ1", "PRJ2", "PRJ3", "PRJ4"],
        datePublished: null,
        annotations: {
          overexpressed_gene: Array.from({ length: 5 }, (_, index) => gene(index + 1)),
          drug: [{ value: "a long drug name that is cut", termId: null, label: null, status: "unmapped_no_candidate" }],
        },
      }
      return ok({ items: [item], pagination: { page: 1, perPage: 20, total: 1 } })
    }
    const field = (name: string) => ({ name, multiValued: true, ontologies: [], mappedBiosampleCount: 1 })
    return ok({ fields: [field("overexpressed_gene"), field("drug")], totals: { biosample: 1 }, ontologies: [], targetAssays: [] })
  }
  return { ...original, api: { ...original.api, GET } }
})

import { SamplesTab } from "~/features/workspace/samples/samples-tab"

const renderTab = () =>
  renderWithQuery(
    <MemoryRouter initialEntries={["/entries"]}>
      <Routes>
        <Route path="/entries" element={<SamplesTab state={DEFAULTS} onPage={vi.fn()} onPastEnd={vi.fn()} onPerPage={vi.fn()} search="" />} />
        <Route path="/entries/:accession" element={<p>the sample page</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe("the lists in the cells of the Samples table", () => {
  it("puts the values of an annotation one per line, the first two and a button for the rest", async () => {
    renderTab()
    const button = await screen.findByRole("button", { name: "3 more" })
    const cell = button.closest("td") as HTMLElement
    expect(within(cell).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["G1", "G2"])
  })

  it("gives each value of an annotation the title that shows its full text", async () => {
    renderTab()
    const value = await screen.findByText("“a long drug name that is cut”")
    expect(value.closest("[title]")).toHaveAttribute("title", expect.stringContaining("a long drug name that is cut"))
    const gene = screen.getByText("G1")
    expect(gene.closest("[title]")).toHaveAttribute("title", expect.stringContaining("NCBIGene:1"))
  })

  it("opens the rest of the BioProjects and of an annotation in place, without opening the sample page", async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole("button", { name: "3 more" }))
    await user.click(screen.getByRole("button", { name: "2 more" }))
    expect(screen.queryByText("the sample page")).toBeNull()
    expect(screen.getByText("G5")).toBeInTheDocument()
    expect(screen.getByText("PRJ4")).toBeInTheDocument()
  })
})
