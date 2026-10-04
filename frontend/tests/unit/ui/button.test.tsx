import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { SyntheticEvent } from "react"
import { describe, expect, it, vi } from "vitest"

import { Button } from "~/ui/button"
import { LinkButton } from "~/ui/text-link"

describe("Button", () => {
  it("uses the children as the accessible name", () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()
  })

  it("sets aria-disabled and the native disabled attribute when disabled", () => {
    render(<Button disabled>Save</Button>)
    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-disabled", "true")
  })

  it("omits aria-disabled when not disabled", () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-disabled")
  })

  it("draws its icon before the text, hidden from assistive technology", () => {
    render(<Button icon="download">Export</Button>)
    const button = screen.getByRole("button", { name: "Export" })
    const icon = button.querySelector("svg")
    expect(button.firstChild).toBe(icon)
    expect(icon).toHaveAttribute("aria-hidden", "true")
  })

  it("fills its container and starts its content at the left when it is a block", () => {
    render(
      <>
        <Button block>Share</Button>
        <Button>Apply</Button>
      </>,
    )
    const block = screen.getByRole("button", { name: "Share" })
    expect(block).toHaveClass("w-full", "justify-start")
    expect(block).not.toHaveClass("justify-center")
    expect(screen.getByRole("button", { name: "Apply" })).toHaveClass("justify-center")
  })

  it("draws no icon unless it is given one", () => {
    render(<Button>Apply</Button>)
    expect(screen.getByRole("button", { name: "Apply" }).querySelector("svg")).toBeNull()
  })
})

describe("Button in a form", () => {
  it("does not submit the form unless it is given the type submit", async () => {
    const onSubmit = vi.fn((event: SyntheticEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button>Apply</Button>
        <Button type="submit">Send</Button>
      </form>,
    )
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe("LinkButton", () => {
  it("draws its icon before the text and keeps the text as its name", () => {
    render(<LinkButton icon="close">Clear all</LinkButton>)
    const button = screen.getByRole("button", { name: "Clear all" })
    expect(button.firstChild).toBe(button.querySelector("svg"))
  })
})
