import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { InlineLabel } from "~/ui/inline-label"

describe("InlineLabel", () => {
  it("ends the name with a colon", () => {
    render(<InlineLabel>Status</InlineLabel>)
    expect(screen.getByText("Status:")).toBeInTheDocument()
  })
})
