import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Card } from "~/ui/card"
import { busyClass, Skeleton } from "~/ui/skeleton"

describe("Skeleton", () => {
  it("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton className="w-24" />)
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true")
  })

  it("keeps the height of a line of text with a character of no width beside the bar", () => {
    const { container } = render(<Skeleton className="w-24" />)
    expect(container.firstElementChild?.textContent).toBe("​")
    expect(container.querySelector(".w-24")).not.toBeNull()
  })

  it("takes its height from its classes as a block", () => {
    const { container } = render(<Skeleton kind="block" className="h-2 w-full" />)
    expect(container.firstElementChild).toHaveClass("h-2", "w-full")
    expect(container.firstElementChild?.textContent).toBe("")
  })
})

describe("busy", () => {
  it("turns a region pale only while it is busy", () => {
    expect(busyClass(true)).toContain("opacity-55")
    expect(busyClass(false)).not.toContain("opacity-55")
  })

  it("marks a busy card for assistive technology and keeps its content", () => {
    const { rerender } = render(<Card busy>previous result</Card>)
    expect(screen.getByText("previous result")).toHaveAttribute("aria-busy", "true")
    rerender(<Card>previous result</Card>)
    expect(screen.getByText("previous result")).not.toHaveAttribute("aria-busy")
  })
})
