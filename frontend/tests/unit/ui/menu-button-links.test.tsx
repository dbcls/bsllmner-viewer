import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MenuButton } from "~/ui/menu-button"

const renderMenu = (onSelect = vi.fn()) =>
  render(
    <MenuButton
      label="Export"
      icon="download"
      appearance="bar"
      items={[
        {
          title: "Entries",
          note: "all fields",
          items: [
            { label: "TSV", hint: "3 rows", href: "/files/a.tsv" },
            { label: "Lines", href: "/files/a.ndjson" },
          ],
        },
        { title: "Lists", note: "one per line", items: [{ label: "Names", onSelect }] },
      ]}
    />,
  )

const trigger = () => screen.getByRole("button", { name: "Export" })

describe("MenuButton with links and groups", () => {
  it("shows link items as download links and group headings that are not items", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    const tsv = screen.getByRole("menuitem", { name: /^TSV/ })
    expect(tsv.tagName).toBe("A")
    expect(tsv).toHaveAttribute("href", "/files/a.tsv")
    expect(tsv).toHaveAttribute("download")
    expect(screen.getAllByRole("menuitem").map((element) => element.textContent)).toEqual(["TSV3 rows", "Lines", "Names"])
    expect(screen.getByRole("group", { name: "Entries (all fields)" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Lists (one per line)" })).toBeInTheDocument()
  })

  it("moves through link items and action items with the arrow keys, Home, and End, skipping the headings", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    expect(screen.getByRole("menuitem", { name: /^TSV/ })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("menuitem", { name: "Lines" })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("menuitem", { name: "Names" })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("menuitem", { name: /^TSV/ })).toHaveFocus()
    await user.keyboard("{End}")
    expect(screen.getByRole("menuitem", { name: "Names" })).toHaveFocus()
    await user.keyboard("{Home}")
    expect(screen.getByRole("menuitem", { name: /^TSV/ })).toHaveFocus()
  })

  it("activates the focused link with Enter and closes the menu", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn((event: MouseEvent) => event.preventDefault())
    renderMenu()
    await user.click(trigger())
    document.addEventListener("click", onClick)
    await user.keyboard("{ArrowDown}{Enter}")
    document.removeEventListener("click", onClick)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect((onClick.mock.calls[0]?.[0].target as HTMLElement).getAttribute("href")).toBe("/files/a.ndjson")
    expect(screen.queryByRole("menu")).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it("closes after a click on a link item and on an action item after it", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const prevent = (event: MouseEvent) => event.preventDefault()
    document.addEventListener("click", prevent)
    renderMenu(onSelect)
    await user.click(trigger())
    await user.click(screen.getByRole("menuitem", { name: "Lines" }))
    expect(screen.queryByRole("menu")).toBeNull()
    await user.click(trigger())
    await user.click(screen.getByRole("menuitem", { name: "Names" }))
    document.removeEventListener("click", prevent)
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("closes on Escape and gives the focus back to the button", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    expect(trigger()).toHaveAttribute("aria-expanded", "true")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).toBeNull()
    expect(trigger()).toHaveFocus()
    expect(trigger()).toHaveAttribute("aria-expanded", "false")
  })
})
