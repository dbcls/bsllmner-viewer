import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HelpHint } from "~/ui/help-hint"

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
