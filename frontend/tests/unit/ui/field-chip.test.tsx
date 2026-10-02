import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { FieldChip } from "~/ui/chip"

describe("FieldChip", () => {
  it("removes the condition on a press on the field as well as on the value, and announces both", () => {
    const onRemove = vi.fn()
    render(<FieldChip field="Knockout gene" value="TP53" onRemove={onRemove} />)
    const chip = screen.getByRole("button", { name: "Remove Knockout gene: TP53" })

    fireEvent.click(screen.getByText("Knockout gene"))
    expect(onRemove).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText("TP53"))
    expect(onRemove).toHaveBeenCalledTimes(2)
    expect(chip).toContainElement(screen.getByText("TP53"))
  })

  it("shows the field before the value", () => {
    render(<FieldChip field="Cell type" value="peripheral blood mononuclear cell" onRemove={vi.fn()} />)
    expect(screen.getByRole("button").textContent).toBe("Cell typeperipheral blood mononuclear cell")
  })
})
