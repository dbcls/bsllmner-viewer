import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Button } from "~/ui/button"

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
})
