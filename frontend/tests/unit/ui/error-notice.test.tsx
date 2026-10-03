import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { EmptyNotice, ErrorNotice } from "~/ui"

describe("ErrorNotice", () => {
  it("shows the message as an alert with a Try again button that calls onRetry", async () => {
    const onRetry = vi.fn()
    render(<ErrorNotice onRetry={onRetry} message="Could not load the BioSamples." />)
    expect(screen.getByRole("status")).toHaveTextContent("Could not load the BioSamples.")
    await userEvent.click(screen.getByRole("button", { name: /^Try again/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("has no button without onRetry", () => {
    render(<ErrorNotice message="The condition in the URL is not valid: x" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("ErrorNotice as a status", () => {
  it("is a status, not an alert, so that many notices on a screen are not all announced at once", () => {
    render(<ErrorNotice onRetry={vi.fn()} message="Could not load the heatmap." />)
    expect(screen.getByRole("status")).toHaveTextContent("Could not load the heatmap.")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("names what the button loads again", () => {
    render(<ErrorNotice onRetry={vi.fn()} retryName="Disease distribution" message="Could not load the Disease distribution." />)
    expect(screen.getByRole("button", { name: "Try again: Disease distribution" })).toBeInTheDocument()
  })
})

describe("EmptyNotice", () => {
  it("shows the text", () => {
    render(<EmptyNotice>No BioSamples match this condition.</EmptyNotice>)
    expect(screen.getByText("No BioSamples match this condition.")).toBeInTheDocument()
  })
})
