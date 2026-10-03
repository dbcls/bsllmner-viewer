import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { TermPanel, type TermPanelDetails } from "~/ui/term-panel"

const CHEBI: TermPanelDetails = {
  synonyms: ["DMSO", "dimethyl sulphoxide"],
  parents: ["sulfoxide", "CHEBI:134179"],
  ontologyName: "ChEBI",
  url: "https://www.ebi.ac.uk/ols4/ontologies/chebi/classes?obo_id=CHEBI:28262",
}

const renderPanel = (details: TermPanelDetails | null | undefined, action?: string) =>
  render(<TermPanel label="dimethyl sulfoxide" termId="CHEBI:28262" details={details} {...(action ? { action: <a href="#show">{action}</a> } : {})} />)

describe("TermPanel", () => {
  it("shows the synonyms, the parent terms, the link to the ontology site, and the action", () => {
    renderPanel(CHEBI, "Show BioSamples with this term")
    expect(screen.getByText("DMSO, dimethyl sulphoxide")).toBeTruthy()
    expect(screen.getByText("sulfoxide, CHEBI:134179")).toBeTruthy()
    expect(screen.getByRole("link", { name: /ChEBI/ })).toHaveAttribute("href", CHEBI.url)
    expect(screen.getByRole("link", { name: "Show BioSamples with this term" })).toBeTruthy()
  })

  it("leaves out the rows without values, the link of an ontology without a page, and the last line without links", () => {
    renderPanel({ ...CHEBI, ontologyName: null, url: null, synonyms: [], parents: [] })
    expect(screen.queryByText("Synonyms")).toBeNull()
    expect(screen.queryByText("Parent terms")).toBeNull()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("draws the label and the ID, and holds the place of the details, before they arrive", () => {
    renderPanel(undefined)
    expect(screen.getByText("dimethyl sulfoxide")).toBeTruthy()
    expect(screen.getByText("CHEBI:28262")).toBeTruthy()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("shows the label, the ID, and the action, without details, when there are none for the term", () => {
    renderPanel(null, "Show BioSamples with this term")
    expect(screen.queryByText("Synonyms")).toBeNull()
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Show BioSamples with this term"])
  })
})
