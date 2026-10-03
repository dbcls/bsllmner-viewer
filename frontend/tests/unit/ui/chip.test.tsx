import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Chip } from "~/ui/chip"

describe("Chip", () => {
  it("names its remove button after what it holds, without a tooltip, and removes it on a click", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <Chip name="breast cancer" onRemove={onRemove}>
        breast cancer MONDO:0007254
      </Chip>,
    )
    const remove = screen.getByRole("button", { name: "Remove breast cancer" })
    expect(remove).not.toHaveAttribute("title")
    await user.click(remove)
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it("names its remove button Remove when it has no name", () => {
    render(<Chip onRemove={vi.fn()}>value</Chip>)
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy()
  })
})
