import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params: { path: { accession?: string; termId?: string } } }) => {
    if (path === "/api/dataset") {
      return ok({ fields: [], targetAssays: ["RNA-Seq"] })
    }
    if (path === "/api/terms/{termId}") {
      const data = {
        termId: init?.params.path.termId,
        label: "liver",
        ontology: { prefix: "UBERON", name: "Uberon" },
        synonyms: ["iecur"],
        parents: [{ termId: "UBERON:0002423", label: "hepatobiliary system" }],
        url: "https://www.ebi.ac.uk/ols4/ontologies/uberon/classes?obo_id=UBERON:0002107",
      }
      return ok(data)
    }
    // The accession ends with the number of SRA Experiments of the BioSample (SAMN), or of its BioProjects (SAMP).
    const accession = init?.params.path.accession ?? ""
    const count = Number(accession.replace(/^\D+/, ""))
    const experiments = Array.from({ length: accession.startsWith("SAMN") ? count : 0 }, (_, index) => ({
      accession: `SRX${index + 1}`,
      libraryStrategy: "RNA-Seq",
      inPopulation: true,
      runs: [],
      chipAtlas: [],
    }))
    const data = {
      identifier: accession,
      type: "biosample",
      title: null,
      organism: null,
      datePublished: null,
      run: "run",
      metadata: [
        { kind: "description", name: "Title", value: "liver of a mouse", harmonizedName: null },
        { kind: "attribute", name: "tissue", value: "liver", harmonizedName: null },
        { kind: "attribute", name: "spiperone treatment", value: "yes", harmonizedName: null },
      ],
      annotations: [
        { field: "disease", value: null, status: "not_stated", termId: null, label: null, evidence: [] },
        { field: "drug", value: null, status: "extraction_failed", termId: null, label: null, evidence: [] },
        {
          field: "tissue",
          value: "liver",
          status: "mapped_exact",
          termId: "UBERON:0002107",
          label: "liver",
          evidence: [{ name: "tissue", metadataIndex: 1, inName: false, start: 0, end: 5, strategy: "exact" }],
          clauses: [{ field: "tissue", value: "UBERON:0002107" }],
        },
        {
          field: "compound",
          value: "spiperone",
          status: "unmapped_no_candidate",
          termId: null,
          label: null,
          evidence: [{ name: "spiperone treatment", metadataIndex: 2, inName: true, start: 0, end: 9, strategy: "exact" }],
          clauses: [],
        },
      ],
      experiments,
      bioprojects: Array.from({ length: accession.startsWith("SAMP") ? count : 0 }, (_, index) => ({
        accession: `PRJNA${index + 1}`,
        title: `Project ${index + 1}`,
      })),
    }
    return ok(data)
  }
  const POST = async (_path: string, init: { body: { clauses: { field: string; value: string }[] } }) => {
    const [clause] = init.body.clauses
    return ok({ dsl: `${clause?.field}:"${clause?.value}"`, ast: {}, labels: {} })
  }
  return { ...original, api: { ...original.api, GET, POST } }
})

import { SamplePage } from "~/features/sample/sample-page"

const renderSample = (accession: string) => {
  renderWithQuery(
    <MemoryRouter initialEntries={[`/entries/${accession}`]}>
      <SamplePage accession={accession} />
    </MemoryRouter>,
  )
}

describe("SamplePage", () => {
  it("shows 21 SRA Experiments 20 to a page with a pager, and the 21st on the next page", async () => {
    const user = userEvent.setup()
    renderSample("SAMN21")
    expect(await screen.findByText("SRX20")).toBeTruthy()
    expect(screen.queryByText("SRX21")).toBeNull()
    expect(screen.getByText("1–20 / 21")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByText("SRX21")).toBeTruthy()
    expect(screen.queryByText("SRX1")).toBeNull()
    expect(screen.getByText("21–21 / 21")).toBeTruthy()
  })

  it("shows 20 SRA Experiments on one page without a pager", async () => {
    renderSample("SAMN20")
    expect(await screen.findByText("SRX20")).toBeTruthy()
    expect(screen.getByText("SRX1")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull()
  })

  it("shows the name only of a field without a value (Not stated or Extraction failed), and the value and the status of the other fields", async () => {
    renderSample("SAMN1")
    const row = (field: string) => {
      const name = screen.getByText(field, { exact: true })
      if (!name.parentElement) throw new Error(`no row of ${field}`)
      return within(name.parentElement)
    }
    await screen.findByText("Disease")
    expect(row("Disease").queryByText("Not stated")).toBeNull()
    expect(row("Disease").queryByText("—")).toBeNull()
    expect(row("Drug").queryByText("Extraction failed")).toBeNull()
    expect(row("Drug").queryByText("—")).toBeNull()
    expect(row("Tissue").getByText("Exact match")).toBeTruthy()
    expect(row("Tissue").getByText("“liver”")).toBeTruthy()
  })

  it("shows 21 BioProjects 20 to a page with a pager of their own, and the 21st on the next page", async () => {
    const user = userEvent.setup()
    renderSample("SAMP21")
    expect(await screen.findByText("PRJNA20")).toBeTruthy()
    expect(screen.queryByText("PRJNA21")).toBeNull()
    expect(screen.getAllByRole("navigation", { name: "Pages" })).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByText("PRJNA21")).toBeTruthy()
    expect(screen.queryByText("PRJNA1")).toBeNull()
  })

  it("opens the details of a term from its label and ID, with links to its ontology and to the BioSamples with it, and stays on the page", async () => {
    const user = userEvent.setup()
    renderSample("SAMN1")
    expect(await screen.findByRole("button", { name: "liver UBERON:0002107" })).toBeTruthy()
    await user.click(screen.getByText("UBERON:0002107"))
    const panel = screen.getByRole("dialog", { name: "liver" })
    expect(await within(panel).findByText("iecur")).toBeTruthy()
    expect(within(panel).getByText("hepatobiliary system")).toBeTruthy()
    expect(within(panel).getByRole("link", { name: /Uberon/ })).toHaveAttribute("href", expect.stringContaining("UBERON:0002107"))
    expect(await within(panel).findByRole("link", { name: /Show BioSamples with this term/ })).toHaveAttribute(
      "href",
      "/entries?q=tissue%3A%22UBERON%3A0002107%22",
    )
  })

  it("lists the metadata in the order of the api and marks the evidence in the item that it points to", async () => {
    renderSample("SAMN1")
    const attribute = await screen.findByText("tissue")
    const title = screen.getByText("Title")
    expect(title.compareDocumentPosition(attribute) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const row = (name: HTMLElement) => {
      if (!name.parentElement) throw new Error("no row")
      return name.parentElement
    }
    expect(row(title).querySelector("mark")).toBeNull()
    expect(row(attribute).querySelector("mark")?.textContent).toBe("liver")
  })

  it("marks evidence in the name of an attribute in the name and leaves the value unmarked", async () => {
    renderSample("SAMN1")
    const mark = await screen.findByText("spiperone", { selector: "mark" })
    const name = mark.parentElement
    const value = name?.nextElementSibling
    expect(name?.textContent).toBe("spiperone treatment")
    expect(value?.textContent).toBe("yes")
    expect(value?.querySelector("mark")).toBeNull()
  })
})
