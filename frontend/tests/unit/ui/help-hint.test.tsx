import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { HelpHint } from "~/ui/help-hint"
import { Modal } from "~/ui/modal"

const renderHint = () =>
  render(
    <>
      <HelpHint label="About annotation status">No value is not a negative result.</HelpHint>
      <p>outside</p>
    </>,
  )

describe("HelpHint", () => {
  it("is a button named by its label and shows nothing until it is used", () => {
    renderHint()
    const button = screen.getByRole("button", { name: "About annotation status" })
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button).not.toHaveAttribute("aria-describedby")
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("shows the explanation while the pointer is over it, described by the button", () => {
    renderHint()
    const button = screen.getByRole("button", { name: "About annotation status" })
    fireEvent.mouseEnter(button)
    const bubble = screen.getByRole("tooltip")
    expect(bubble).toHaveTextContent("No value is not a negative result.")
    expect(button).toHaveAttribute("aria-describedby", bubble.id)
    expect(button).toHaveAttribute("aria-expanded", "true")
    fireEvent.mouseLeave(button)
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("shows the explanation while it has focus", () => {
    renderHint()
    const button = screen.getByRole("button", { name: "About annotation status" })
    fireEvent.focus(button)
    expect(screen.getByRole("tooltip")).toBeInTheDocument()
    fireEvent.blur(button)
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("stays open after a click until a second click", () => {
    renderHint()
    const button = screen.getByRole("button", { name: "About annotation status" })
    fireEvent.click(button)
    expect(screen.getByRole("tooltip")).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("closes after a click when Escape is pressed or the pointer goes down outside", () => {
    renderHint()
    const button = screen.getByRole("button", { name: "About annotation status" })
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("tooltip")).toBeNull()
    fireEvent.click(button)
    fireEvent.mouseDown(screen.getByRole("tooltip"))
    expect(screen.getByRole("tooltip")).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText("outside"))
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("opens the bubble under the button, or above it when asked", () => {
    const { rerender } = render(<HelpHint label="Below">text</HelpHint>)
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Below" }))
    expect(screen.getByRole("tooltip").getAttribute("class")).toContain("top-full")
    rerender(
      <HelpHint label="Below" side="top">
        text
      </HelpHint>,
    )
    expect(screen.getByRole("tooltip").getAttribute("class")).toContain("bottom-full")
    expect(screen.getByRole("tooltip").getAttribute("class")).not.toContain("top-full")
  })
})

describe("HelpHint keyboard and pointer", () => {
  it("closes a bubble opened by hover or focus with Escape and shows it again on the next hover", () => {
    renderHint()
    const button = screen.getByRole("button", { name: "About annotation status" })
    fireEvent.focus(button)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("tooltip")).toBeNull()
    fireEvent.mouseEnter(button)
    expect(screen.getByRole("tooltip")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("stays open when the pointer moves from the button onto the bubble", () => {
    renderHint()
    const button = screen.getByRole("button", { name: "About annotation status" })
    fireEvent.mouseEnter(button)
    const bubble = screen.getByRole("tooltip")
    fireEvent.mouseLeave(button, { relatedTarget: bubble })
    fireEvent.mouseEnter(bubble)
    expect(screen.getByRole("tooltip")).toBeInTheDocument()
    fireEvent.mouseLeave(bubble.parentElement as HTMLElement)
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("closes a pinned bubble when a modal dialog opens over it", async () => {
    const user = userEvent.setup()
    const Harness = ({ dialog }: { dialog: boolean }) => (
      <>
        <HelpHint label="About annotation status">No value is not a negative result.</HelpHint>
        <Modal open={dialog} onClose={() => undefined} title="Same result via the API">
          <button type="button">Copy</button>
        </Modal>
      </>
    )
    const { rerender } = render(<Harness dialog={false} />)
    await user.click(screen.getByRole("button", { name: "About annotation status" }))
    expect(screen.getByRole("tooltip")).toBeInTheDocument()
    rerender(<Harness dialog />)
    expect(screen.queryByRole("tooltip")).toBeNull()
  })
})
