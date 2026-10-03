import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Alert } from "~/ui/alert"

describe("Alert", () => {
  it("draws nothing without a message", () => {
    const { container } = render(<Alert message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("announces the message as an alert, with a decorative warning icon before it", () => {
    render(<Alert message="A trend shows up to 5 terms" />)
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("A trend shows up to 5 terms")
    const [icon, text] = [...alert.children]
    expect(icon?.tagName.toLowerCase()).toBe("svg")
    expect(icon).toHaveAttribute("aria-hidden", "true")
    expect(text).toHaveTextContent("A trend shows up to 5 terms")
  })
})
