import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { ExportMenu } from "~/features/workspace/overlays"
import { exportAccessionsUrl, exportEntriesUrl } from "~/lib/api/client"

describe("ExportMenu", () => {
  it("lists the entry exports and the accession lists, in order, as downloads of the condition", async () => {
    const user = userEvent.setup()
    render(<ExportMenu q="disease:x" totalEntries={1234} />)
    const button = screen.getByRole("button", { name: "Export" })
    expect(button).toHaveAttribute("aria-haspopup", "menu")
    await user.click(button)
    const items = screen.getAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "TSV1,234 rows",
      "JSON lines",
      "BioSampleSAMN…",
      "SRA ExperimentSRX…",
      "SRA RunSRR…",
      "BioProjectPRJ…",
    ])
    expect(items.map((item) => item.getAttribute("href"))).toEqual([
      exportEntriesUrl("biosample", "disease:x", "tsv"),
      exportEntriesUrl("biosample", "disease:x", "ndjson"),
      exportAccessionsUrl("biosample", "disease:x"),
      exportAccessionsUrl("sra-experiment", "disease:x"),
      exportAccessionsUrl("sra-run", "disease:x"),
      exportAccessionsUrl("bioproject", "disease:x"),
    ])
    for (const item of items) expect(item).toHaveAttribute("download")
    expect(screen.getByRole("group", { name: "Entries (all annotation fields)" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Accession lists (one per line)" })).toBeInTheDocument()
  })

  it("shows no row count until the total is known", async () => {
    const user = userEvent.setup()
    render(<ExportMenu q={null} totalEntries={undefined} />)
    await user.click(screen.getByRole("button", { name: "Export" }))
    expect(screen.getAllByRole("menuitem")[0]).toHaveTextContent(/^TSV$/)
  })
})
