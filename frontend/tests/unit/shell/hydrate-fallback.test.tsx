import { render, screen, within } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { HydrateFallback } from "~/root"

const renderFallback = () =>
  render(
    <MemoryRouter>
      <HydrateFallback />
    </MemoryRouter>,
  )

describe("HydrateFallback", () => {
  it("draws without a query client, as it does when the page is built", () => {
    const html = renderToString(
      <MemoryRouter>
        <HydrateFallback />
      </MemoryRouter>,
    )
    expect(html).toContain("bsllmner-viewer")
    expect(html).toContain("RO-Crate")
  })

  it("shows the header with its links and the footer with its fixed lines", () => {
    renderFallback()
    expect(screen.getByRole("link", { name: "bsllmner-viewer" })).toHaveAttribute("href", "/")
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getAllByRole("link")).toHaveLength(3)
    const footer = screen.getByRole("contentinfo")
    expect(within(footer).getByText(/RO-Crate/)).toBeInTheDocument()
    expect(within(footer).getAllByRole("img")).toHaveLength(4)
  })

  it("keeps the place of the dataset line without a sentence about loading", () => {
    renderFallback()
    const footer = screen.getByRole("contentinfo")
    expect(within(footer).getByText((_, element) => element?.getAttribute("aria-busy") === "true")).toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).toBeNull()
  })

  it("leaves the page between the header and the footer empty", () => {
    renderFallback()
    expect(screen.queryByRole("main")).toBeNull()
    expect(screen.queryByRole("heading")).toBeNull()
  })
})
