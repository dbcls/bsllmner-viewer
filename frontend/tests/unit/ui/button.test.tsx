import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Button } from "~/ui/button"
import { LinkButton } from "~/ui/text-link"

describe("Button", () => {
  it("rendersChildren_asAccessibleButtonName", () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()
  })

  it("disabled_setsAriaDisabledAndNativeDisabled", () => {
    render(<Button disabled>Save</Button>)
    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-disabled", "true")
  })

  it("notDisabled_omitsAriaDisabledAttribute", () => {
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

describe("LinkButton", () => {
  it("draws its icon before the text and keeps the text as its name", () => {
    render(<LinkButton icon="close">Clear all</LinkButton>)
    const button = screen.getByRole("button", { name: "Clear all" })
    expect(button.firstChild).toBe(button.querySelector("svg"))
  })
})
