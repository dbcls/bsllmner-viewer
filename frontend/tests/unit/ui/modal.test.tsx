import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
    fireEvent.mouseDown(backdrop as HTMLElement)
    fireEvent.click(backdrop as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it("does not close when the press starts in the dialog and ends on the backdrop", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Choose a term">
        <p>body</p>
      </Modal>,
    )
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement
    fireEvent.mouseDown(screen.getByText("body"))
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
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

describe("Modal focus and background", () => {
  const renderModal = (open = true, extra?: React.ReactNode) =>
    render(
      <>
        <button>Opener</button>
        <Modal open={open} onClose={vi.fn()} title="Choose a term">
          {extra ?? (
            <>
              <input aria-label="Search" />
              <button>Apply</button>
            </>
          )}
        </Modal>
      </>,
    )

  it("moves the focus to the first control of the content, skipping Close", () => {
    renderModal()
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus()
  })

  it("keeps the focus on content that took it while mounting", () => {
    renderModal(true, (
      <>
        <button>Field</button>
        <input aria-label="Search" autoFocus />
      </>
    ))
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus()
  })

  it("puts the focus back on the opener when it closes, even if the content took the focus while mounting", () => {
    const Harness = ({ open }: { open: boolean }) => (
      <>
        <button>Opener</button>
        <Modal open={open} onClose={vi.fn()} title="Choose a term">
          <input aria-label="Search" autoFocus />
        </Modal>
      </>
    )
    const { rerender } = render(<Harness open={false} />)
    screen.getByRole("button", { name: "Opener" }).focus()
    rerender(<Harness open />)
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus()
    rerender(<Harness open={false} />)
    expect(screen.getByRole("button", { name: "Opener" })).toHaveFocus()
  })

  it("moves the focus to the dialog itself when the content has no control", () => {
    renderModal(true, <p>text</p>)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("tabindex", "-1")
    expect(dialog).toHaveFocus()
  })

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup()
    renderModal()
    const close = screen.getByRole("button", { name: "Close" })
    const apply = screen.getByRole("button", { name: "Apply" })
    await user.tab()
    expect(apply).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(apply).toHaveFocus()
  })

  it("makes the rest of the page inert while open, except a listbox, a menu, an alert, and elements added after it opens, and undoes it on close", () => {
    const outside = document.createElement("div")
    const listbox = document.createElement("div")
    listbox.setAttribute("role", "listbox")
    const menu = document.createElement("div")
    menu.setAttribute("role", "menu")
    const alert = document.createElement("div")
    alert.setAttribute("role", "alert")
    document.body.append(outside, listbox, menu, alert)
    const view = render(
      <>
        <button>Behind</button>
        <Modal open onClose={vi.fn()} title="Choose a term">
          <input aria-label="Search" />
        </Modal>
      </>,
    )
    const late = document.createElement("div")
    document.body.append(late)
    expect(outside).toHaveAttribute("inert")
    expect(screen.getByRole("button", { name: "Behind", hidden: true })).toHaveAttribute("inert")
    expect(listbox).not.toHaveAttribute("inert")
    expect(menu).not.toHaveAttribute("inert")
    expect(alert).not.toHaveAttribute("inert")
    expect(late).not.toHaveAttribute("inert")
    expect(screen.getByRole("dialog")).not.toHaveAttribute("inert")
    expect(view.container).not.toHaveAttribute("inert")
    view.rerender(<button>Behind</button>)
    expect(outside).not.toHaveAttribute("inert")
    expect(screen.getByRole("button", { name: "Behind" })).not.toHaveAttribute("inert")
    outside.remove()
    listbox.remove()
    menu.remove()
    alert.remove()
    late.remove()
  })

  it("starts the focus on the control marked data-autofocus, not on the first control", () => {
    render(
      <Modal open onClose={vi.fn()} title="Choose a term">
        <button type="button">Field</button>
        <input aria-label="Search" data-autofocus />
      </Modal>,
    )
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus()
  })

  it("starts the focus on the first control of the content, not on Close, when nothing is marked", () => {
    render(
      <Modal open onClose={vi.fn()} title="Choose a term">
        <button type="button">Field</button>
      </Modal>,
    )
    expect(screen.getByRole("button", { name: "Field" })).toHaveFocus()
  })
})
