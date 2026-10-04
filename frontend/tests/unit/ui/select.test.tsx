import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { Select, type SelectOption } from "~/ui/select"

const FIELDS: SelectOption[] = [
  { value: "cell_line", label: "Cell line" },
  { value: "tissue", label: "Tissue" },
  { value: "disease", label: "Disease" },
  { value: "drug", label: "Drug" },
]

const Controlled = ({ initial = "tissue", onChange, placeholder }: { initial?: string; onChange?: (value: string) => void; placeholder?: string }) => {
  const [value, setValue] = useState(initial)
  return (
    <Select
      options={FIELDS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      aria-label="Field"
      {...(placeholder !== undefined ? { placeholder } : {})}
    />
  )
}

const combobox = () => screen.getByRole("combobox", { name: "Field" })
const visibleLabel = () => combobox().querySelector("[aria-hidden='false']")?.textContent

describe("Select", () => {
  it("shows the label of the chosen option and keeps the list closed", () => {
    render(<Controlled />)
    expect(visibleLabel()).toBe("Tissue")
    expect(combobox()).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("opens the list on click and marks the chosen option as selected", async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    await user.click(combobox())
    expect(combobox()).toHaveAttribute("aria-expanded", "true")
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Cell line", "Tissue", "Disease", "Drug"])
    expect(screen.getByRole("option", { name: "Tissue" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("option", { name: "Drug" })).toHaveAttribute("aria-selected", "false")
  })

  it("chooses a clicked option, closes the list, and gives the focus back to the button", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(combobox())
    await user.click(screen.getByRole("option", { name: "Disease" }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("disease")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(visibleLabel()).toBe("Disease")
    expect(combobox()).toHaveFocus()
  })

  it("does not report a change when the chosen option is chosen again", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(combobox())
    await user.click(screen.getByRole("option", { name: "Tissue" }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each(["ArrowDown", "ArrowUp"])("opens on %s at the chosen option without moving", async (key) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    combobox().focus()
    await user.keyboard(`{${key}}`)
    expect(combobox()).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Tissue" }).id)
    await user.keyboard("{Enter}")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("moves to the next option whose label starts with a typed letter", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled initial="cell_line" onChange={onChange} />)
    combobox().focus()
    await user.keyboard("d")
    expect(combobox()).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Disease" }).id)
    await user.keyboard("d{Enter}")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("drug")
  })

  it("closes on Escape without choosing and keeps the Escape from closing a dialog around it", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onWindowEscape = vi.fn()
    window.addEventListener("keydown", onWindowEscape)
    render(<Controlled onChange={onChange} />)
    await user.click(combobox())
    await user.keyboard("{ArrowDown}{Escape}")
    window.removeEventListener("keydown", onWindowEscape)
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(onWindowEscape.mock.calls.filter(([event]) => (event as KeyboardEvent).key === "Escape")).toHaveLength(0)
  })

  it("closes when the pointer goes down outside the button and the list", async () => {
    const user = userEvent.setup()
    render(
      <>
        <Controlled />
        <p>Outside</p>
      </>,
    )
    await user.click(combobox())
    await user.click(screen.getByText("Outside"))
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("lists the placeholder first with the empty value and shows it while nothing is chosen", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled initial="" placeholder="None" onChange={onChange} />)
    expect(visibleLabel()).toBe("None")
    await user.click(combobox())
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("None")
    expect(screen.getByRole("option", { name: "None" })).toHaveAttribute("aria-selected", "true")
    await user.click(screen.getByRole("option", { name: "Drug" }))
    await user.click(combobox())
    await user.click(screen.getByRole("option", { name: "None" }))
    expect(onChange.mock.calls).toEqual([["drug"], [""]])
  })
})
