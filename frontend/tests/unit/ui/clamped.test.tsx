import { fc, test } from "@fast-check/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Clamped } from "~/ui/clamped"

const items = (count: number) => Array.from({ length: count }, (_, index) => <span key={index}>{`PRJ${index + 1}`}</span>)

describe("Clamped", () => {
  test.prop([fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 5 })])(
    "shows every item when at most one would be hidden, and otherwise the first ones and a button that names how many are left",
    (count, shown) => {
      cleanup()
      render(<Clamped items={items(count)} shown={shown} />)
      const rest = count - shown
      if (rest <= 1) {
        expect(screen.queryAllByRole("listitem")).toHaveLength(count)
        expect(screen.queryByRole("button")).toBeNull()
      } else {
        expect(screen.getAllByRole("listitem")).toHaveLength(shown)
        expect(screen.getByRole("button", { name: `${rest} more` })).toHaveAttribute("aria-expanded", "false")
      }
    },
  )

  it("opens the rest in place and closes them again with the same button", async () => {
    const user = userEvent.setup()
    render(<Clamped items={items(5)} shown={2} />)
    await user.click(screen.getByRole("button", { name: "3 more" }))
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["PRJ1", "PRJ2", "PRJ3", "PRJ4", "PRJ5"])
    const less = screen.getByRole("button", { name: "Show less" })
    expect(less).toHaveAttribute("aria-expanded", "true")
    await user.click(less)
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByRole("button", { name: "3 more" })).toHaveFocus()
  })

  it("keeps a press of the button, by the pointer or the keyboard, from reaching a row that opens a page", async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    const onRowAuxClick = vi.fn()
    const onRowKeyDown = vi.fn()
    render(
      <table>
        <tbody>
          <tr onClick={onRowClick} onAuxClick={onRowAuxClick} onKeyDown={onRowKeyDown}>
            <td>
              <Clamped items={items(4)} shown={2} />
            </td>
          </tr>
        </tbody>
      </table>,
    )
    const button = screen.getByRole("button", { name: "2 more" })
    await user.click(button)
    fireEvent(button, new MouseEvent("auxclick", { bubbles: true, button: 1 }))
    button.focus()
    await user.keyboard("{Enter}")
    await user.keyboard(" ")
    expect(onRowClick).not.toHaveBeenCalled()
    expect(onRowAuxClick).not.toHaveBeenCalled()
    expect(onRowKeyDown).not.toHaveBeenCalled()
    // Three presses (the click, Enter, and Space) leave the list open.
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(4)
    expect(button).toHaveAccessibleName("Show less")
  })
})
