import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { ExportMenu } from "~/features/workspace/overlays"
import { exportAccessionsUrl, exportEntriesUrl } from "~/lib/api/client"

describe("ExportMenu", () => {
  it("lists the entry exports and the accession lists, in order, as downloads of the condition", async () => {
    const user = userEvent.setup()
    render(<ExportMenu q="disease:x" totalEntries={4100500} />)
    const button = screen.getByRole("button", { name: "Export" })
    expect(button).toHaveAttribute("aria-haspopup", "menu")
    await user.click(button)
    const items = screen.getAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "TSV~1.2 GB",
      "NDJSON~4.1 GB",
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
    expect(screen.getByRole("group", { name: "Matching entries (all annotation fields)" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Matching accessions (one per line)" })).toBeInTheDocument()
  })

  it("shows no size until the number of entries is known", async () => {
    const user = userEvent.setup()
    render(<ExportMenu q={null} totalEntries={undefined} />)
    await user.click(screen.getByRole("button", { name: "Export" }))
    expect(screen.getAllByRole("menuitem").slice(0, 2).map((item) => item.textContent)).toEqual(["TSV", "NDJSON"])
  })

  it("shows the size of an export of no entry as under 1 KB, without the mark of an estimate, as the file still has its header", async () => {
    const user = userEvent.setup()
    render(<ExportMenu q="disease:x" totalEntries={0} />)
    await user.click(screen.getByRole("button", { name: "Export" }))
    expect(screen.getAllByRole("menuitem").slice(0, 2).map((item) => item.textContent)).toEqual(["TSV<1 KB", "NDJSON<1 KB"])
  })
})
