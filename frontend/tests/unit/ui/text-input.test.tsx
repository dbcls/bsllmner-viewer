import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TextInput } from "~/ui/text-input"

describe("TextInput", () => {
  it("draws no glyph and no wrapper without an icon", () => {
    const { container } = render(<TextInput value="" onChange={vi.fn()} aria-label="Year" />)
    expect(container.firstChild).toBe(screen.getByRole("textbox", { name: "Year" }))
    expect(container.querySelector("svg")).toBeNull()
  })

  it("draws the glyph before the text and keeps the box named by its label", () => {
    const { container } = render(<TextInput value="" onChange={vi.fn()} icon="search" aria-label="Search terms" />)
    const input = screen.getByRole("textbox", { name: "Search terms" })
    const svg = container.querySelector("svg")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg?.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("reports what is typed and calls onEnter on Enter", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onEnter = vi.fn()
    render(<TextInput value="" onChange={onChange} onEnter={onEnter} icon="search" aria-label="Search terms" />)
    await user.type(screen.getByRole("textbox", { name: "Search terms" }), "a{Enter}")
    expect(onChange).toHaveBeenCalledWith("a")
    expect(onEnter).toHaveBeenCalledOnce()
  })
  it("keeps the glyph and the placeholder of the large search box", () => {
    const { container } = render(<TextInput value="" onChange={vi.fn()} icon="search" size="lg" placeholder="Keyword or accession" aria-label="Keyword" />)
    expect(screen.getByRole("textbox", { name: "Keyword" })).toHaveAttribute("placeholder", "Keyword or accession")
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })
})
