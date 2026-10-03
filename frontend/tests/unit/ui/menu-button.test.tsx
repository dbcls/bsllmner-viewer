import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MenuButton } from "~/ui/menu-button"

const renderMenu = ({ onSelect = vi.fn(), ariaLabel }: { onSelect?: (label: string) => void; ariaLabel?: string } = {}) =>
  render(
    <>
      <MenuButton
        label="Export"
        icon="download"
        items={[
          { label: "TSV", hint: "Data table", onSelect: () => onSelect("TSV") },
          { label: "SVG", hint: "Vector image", onSelect: () => onSelect("SVG") },
          { label: "PNG", onSelect: () => onSelect("PNG") },
        ]}
        {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
      />
      <p>Outside</p>
      <input aria-label="Next field" />
    </>,
  )

const trigger = () => screen.getByRole("button", { name: "Export" })
const item = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) })

describe("MenuButton", () => {
  it("is a button that announces a menu and keeps the menu closed", () => {
    renderMenu()
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu")
    expect(trigger()).toHaveAttribute("aria-expanded", "false")
    expect(trigger()).not.toHaveAttribute("aria-controls")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("opens on click with the items in order, their hints after the labels, and the focus on the first item", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    const menu = screen.getByRole("menu", { name: "Export" })
    expect(trigger()).toHaveAttribute("aria-expanded", "true")
    expect(trigger()).toHaveAttribute("aria-controls", menu.id)
    expect(screen.getAllByRole("menuitem").map((element) => element.textContent)).toEqual(["TSVData table", "SVGVector image", "PNG"])
    expect(item("TSV")).toHaveFocus()
  })

  it("calls the chosen item exactly once, closes the menu, and gives the focus back to the button", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderMenu({ onSelect })
    await user.click(trigger())
    await user.click(item("SVG"))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("SVG")
    expect(screen.queryByRole("menu")).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it("chooses the focused item with Enter", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderMenu({ onSelect })
    await user.click(trigger())
    await user.keyboard("{ArrowDown}{Enter}")
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("SVG")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("closes on Escape without choosing, gives the focus back, and keeps the Escape from closing a dialog around it", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onWindowEscape = vi.fn()
    window.addEventListener("keydown", onWindowEscape)
    renderMenu({ onSelect })
    await user.click(trigger())
    await user.keyboard("{Escape}")
    window.removeEventListener("keydown", onWindowEscape)
    expect(screen.queryByRole("menu")).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    expect(trigger()).toHaveFocus()
    expect(onWindowEscape.mock.calls.filter(([event]) => (event as KeyboardEvent).key === "Escape")).toHaveLength(0)
  })

  it("moves through the items with the arrow keys, wrapping at both ends", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    await user.keyboard("{ArrowUp}")
    expect(item("PNG")).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(item("TSV")).toHaveFocus()
    await user.keyboard("{ArrowDown}{ArrowDown}")
    expect(item("PNG")).toHaveFocus()
  })

  it("jumps to the last item with End and to the first with Home", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    await user.keyboard("{End}")
    expect(item("PNG")).toHaveFocus()
    await user.keyboard("{Home}")
    expect(item("TSV")).toHaveFocus()
  })

  it("opens on ArrowDown on the closed button with the focus on the first item", async () => {
    const user = userEvent.setup()
    renderMenu()
    trigger().focus()
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("menu")).toBeInTheDocument()
    expect(item("TSV")).toHaveFocus()
  })

  it("closes when the pointer goes down outside the button and the menu, without choosing", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderMenu({ onSelect })
    await user.click(trigger())
    await user.click(screen.getByText("Outside"))
    expect(screen.queryByRole("menu")).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("closes when the open button is clicked again", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(trigger())
    await user.click(trigger())
    expect(screen.queryByRole("menu")).toBeNull()
    expect(trigger()).toHaveAttribute("aria-expanded", "false")
  })

  it("closes on Tab and moves the focus on from the button", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderMenu({ onSelect })
    await user.click(trigger())
    await user.tab()
    expect(screen.queryByRole("menu")).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "Next field" })).toHaveFocus()
  })

  it("names the button and the menu by its aria-label when the text is not enough", async () => {
    const user = userEvent.setup()
    renderMenu({ ariaLabel: "Export the heatmap" })
    const button = screen.getByRole("button", { name: "Export the heatmap" })
    expect(button).toHaveTextContent("Export")
    await user.click(button)
    expect(screen.getByRole("menu", { name: "Export the heatmap" })).toBeInTheDocument()
  })
})
