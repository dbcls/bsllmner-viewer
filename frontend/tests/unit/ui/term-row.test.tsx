import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TermRow } from "~/ui/term-row"

describe("TermRow", () => {
  it("shows the field, label, ID, and count in one button, and the place only as its tooltip", () => {
    render(<TermRow label="liver" id="UBERON:0002107" detail="… › gland › liver" count="12,215" field="Tissue" onClick={vi.fn()} />)
    const row = screen.getByRole("button")
    expect(row).toHaveTextContent("Tissueliver")
    expect(row).toHaveTextContent("UBERON:0002107")
    expect(row).toHaveTextContent("12,215")
    expect(row).not.toHaveTextContent("gland")
    expect(row).toHaveAttribute("title", "… › gland › liver")
  })

  it("has no tooltip when the term has no place to show", () => {
    render(<TermRow label="TP53" id="NCBIGene:7157" detail="" count="3" onClick={vi.fn()} />)
    expect(screen.getByRole("button")).not.toHaveAttribute("title")
  })

  it("reports a click", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<TermRow label="TP53" id="NCBIGene:7157" detail="" count="3" onClick={onClick} />)
    await user.click(screen.getByRole("button"))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
