import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { SortChooser, type SortKey } from "~/ui/sort-chooser"

const KEYS: SortKey[] = [
  { value: "biosampleCount", label: "BioSamples", direction: "desc" },
  { value: "identifier", label: "Accession", direction: "asc" },
]

describe("SortChooser", () => {
  it("shows the chosen key and names the reversed order on the direction button", () => {
    render(<SortChooser keys={KEYS} value="biosampleCount" direction="desc" onChange={vi.fn()} />)
    const shown = screen.getByRole("combobox", { name: "Sort by" }).querySelector("[aria-hidden='false']")
    expect(shown).toHaveTextContent("BioSamples")
    expect(screen.getByRole("button", { name: "Sort ascending" })).toBeInTheDocument()
  })

  it("reverses the direction and keeps the key", async () => {
    const onChange = vi.fn()
    render(<SortChooser keys={KEYS} value="identifier" direction="asc" onChange={onChange} />)
    await userEvent.click(screen.getByRole("button", { name: "Sort descending" }))
    expect(onChange).toHaveBeenCalledWith("identifier", "desc")
  })

  it("sorts by a newly chosen key in that key's own direction", async () => {
    const onChange = vi.fn()
    render(<SortChooser keys={KEYS} value="biosampleCount" direction="asc" onChange={onChange} />)
    await userEvent.click(screen.getByRole("combobox", { name: "Sort by" }))
    await userEvent.click(screen.getByRole("option", { name: "Accession" }))
    expect(onChange).toHaveBeenCalledWith("identifier", "asc")
  })
})
