import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TermRow } from "~/ui/term-row"

describe("TermRow", () => {
  it("shows the field, label, ID, and count in one button without a tooltip", () => {
    render(<TermRow label="liver" id="UBERON:0002107" count="12,215" field="Tissue" onClick={vi.fn()} />)
    const row = screen.getByRole("button")
    expect(row).toHaveTextContent("Tissueliver")
    expect(row).toHaveTextContent("UBERON:0002107")
    expect(row).toHaveTextContent("12,215")
    expect(row).not.toHaveAttribute("title")
  })

  it("marks each occurrence of the searched text in the label and the synonym, compared without case", () => {
    const { container } = render(
      <TermRow label="Cell cycle cell" synonym="nerve CELL" id="GO:0007049" count="3" highlight="cell" onClick={vi.fn()} />,
    )
    expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual(["Cell", "cell", "CELL"])
    expect(screen.getByRole("button")).toHaveTextContent("Cell cycle cellnerve CELLGO:0007049")
  })

  it("marks nothing when no text was searched, and shows no synonym when the search did not match one", () => {
    const { container } = render(<TermRow label="neuron" id="CL:0000540" count="3" highlight=" " onClick={vi.fn()} />)
    expect(container.querySelector("mark")).toBeNull()
    expect(screen.getByRole("button")).toHaveTextContent("neuronCL:0000540")
  })

  it("reports a click", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<TermRow label="TP53" id="NCBIGene:7157" count="3" onClick={onClick} />)
    await user.click(screen.getByRole("button"))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
