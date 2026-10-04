import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { CheckboxRow } from "~/ui/checkbox-row"

describe("CheckboxRow input", () => {
  it("calls onChange once for a click on the label and once for Space on the checkbox", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CheckboxRow checked={false} onChange={onChange} label="RNA-Seq" />)
    await user.click(screen.getByText("RNA-Seq"))
    expect(onChange).toHaveBeenCalledTimes(1)
    screen.getByRole("checkbox", { name: "RNA-Seq" }).focus()
    await user.keyboard(" ")
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe("CheckboxRow", () => {
  it("is named by its label alone, whether checked or not, and without the count", () => {
    const { rerender } = render(<CheckboxRow checked onChange={vi.fn()} label="RNA-Seq" count={13} />)
    expect(screen.getByRole("checkbox", { name: "RNA-Seq" })).toBeChecked()
    rerender(<CheckboxRow checked={false} onChange={vi.fn()} label="ChIP-Seq" count={0} />)
    expect(screen.getByRole("checkbox", { name: "ChIP-Seq" })).not.toBeChecked()
  })

  it("gives the count to assistive technology as the description of the checkbox", () => {
    render(<CheckboxRow checked onChange={vi.fn()} label="RNA-Seq" count="12,955" />)
    expect(screen.getByRole("checkbox", { name: "RNA-Seq" })).toHaveAccessibleDescription("12,955")
  })

  it("has no description without a count", () => {
    render(<CheckboxRow checked={false} onChange={vi.fn()} label="RNA-Seq" />)
    expect(screen.getByRole("checkbox", { name: "RNA-Seq" })).not.toHaveAttribute("aria-describedby")
  })

  it("gives a count of 0 as the description, as it gives any other count", () => {
    render(<CheckboxRow checked={false} onChange={vi.fn()} label="RNA-Seq" count={0} />)
    expect(screen.getByRole("checkbox", { name: "RNA-Seq" })).toHaveAccessibleDescription("0")
  })

  it("keeps the check mark for the eye only", () => {
    render(<CheckboxRow checked onChange={vi.fn()} label="RNA-Seq" count={13} />)
    expect(screen.getByText("✓")).toHaveAttribute("aria-hidden", "true")
  })
})
