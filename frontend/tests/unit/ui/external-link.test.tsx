import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ExternalLink } from "~/ui/text-link"

describe("ExternalLink", () => {
  it("opens the link in a new tab and says so in its accessible name", () => {
    render(<ExternalLink href="https://example.org/">bsllmner-mk2</ExternalLink>)
    const link = screen.getByRole("link", { name: "bsllmner-mk2 (opens in a new tab)" })
    expect(link).toHaveAttribute("href", "https://example.org/")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noreferrer")
  })

  it("draws the new-tab icon after the text and hides it from assistive technology", () => {
    render(<ExternalLink href="https://example.org/" kind="button">DDBJ Search</ExternalLink>)
    const link = screen.getByRole("link", { name: "DDBJ Search (opens in a new tab)" })
    const icon = link.querySelector("svg")
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute("aria-hidden", "true")
    expect(link.firstChild?.textContent).toBe("DDBJ Search")
  })

  it("shows its own glyph before the text instead of the new-tab icon after it", () => {
    render(
      <ExternalLink href="https://github.com/" kind="button" icon="github">
        GitHub
      </ExternalLink>,
    )
    const link = screen.getByRole("link", { name: "GitHub (opens in a new tab)" })
    const icons = link.querySelectorAll("svg")
    expect(icons).toHaveLength(1)
    expect(link.firstChild).toBe(icons[0])
    expect(icons[0]?.querySelector("path")).toHaveAttribute("fill", "currentColor")
  })
})
