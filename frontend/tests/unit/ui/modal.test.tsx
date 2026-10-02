import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Modal } from "~/ui/modal"

describe("Modal", () => {
  it("renders nothing while closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Choose a term">
        body
      </Modal>,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("is named by its title, which is a level-2 heading, and shows the description under it", () => {
    render(
      <Modal open onClose={vi.fn()} title="Same result via the API" description="Returns the Samples view.">
        body
      </Modal>,
    )
    const dialog = screen.getByRole("dialog", { name: "Same result via the API" })
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(screen.getByRole("heading", { level: 2, name: "Same result via the API" })).toBeInTheDocument()
    expect(dialog).toHaveTextContent("Returns the Samples view.")
    expect(dialog).toHaveTextContent("body")
  })

  it("closes from its close button, Escape, and the backdrop, but not from a click inside", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Choose a term">
        <p>body</p>
      </Modal>,
    )
    fireEvent.click(screen.getByText("body"))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(2)
    const backdrop = screen.getByRole("dialog").parentElement
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it("ignores keys other than Escape", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Choose a term">
        body
      </Modal>,
    )
    fireEvent.keyDown(window, { key: "Enter" })
    expect(onClose).not.toHaveBeenCalled()
  })
})
