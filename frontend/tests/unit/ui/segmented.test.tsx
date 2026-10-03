import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { Segmented } from "~/ui/segmented"

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
] as const

const Harness = ({ initial = "a" }: { initial?: "a" | "b" | "c" }) => {
  const [value, setValue] = useState<"a" | "b" | "c">(initial)
  return (
    <>
      <button>before</button>
      <Segmented ariaLabel="Letters" options={OPTIONS} value={value} onChange={setValue} />
      <button>after</button>
    </>
  )
}

const radio = (name: string) => screen.getByRole("radio", { name })

describe("Segmented", () => {
  it("makes only the chosen option a stop of Tab", async () => {
    const user = userEvent.setup()
    render(<Harness initial="b" />)
    expect(radio("Alpha")).toHaveAttribute("tabindex", "-1")
    expect(radio("Beta")).toHaveAttribute("tabindex", "0")
    await user.tab()
    await user.tab()
    expect(radio("Beta")).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus()
  })

  it("chooses and focuses the next and previous option with the arrow keys, wrapping at the ends", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    radio("Alpha").focus()
    await user.keyboard("{ArrowRight}")
    expect(radio("Beta")).toHaveFocus()
    expect(radio("Beta")).toBeChecked()
    await user.keyboard("{ArrowDown}")
    expect(radio("Gamma")).toBeChecked()
    await user.keyboard("{ArrowRight}")
    expect(radio("Alpha")).toBeChecked()
    await user.keyboard("{ArrowLeft}")
    expect(radio("Gamma")).toHaveFocus()
    await user.keyboard("{ArrowUp}")
    expect(radio("Beta")).toBeChecked()
  })

  it("chooses the first and the last option with Home and End", async () => {
    const user = userEvent.setup()
    render(<Harness initial="b" />)
    radio("Beta").focus()
    await user.keyboard("{End}")
    expect(radio("Gamma")).toBeChecked()
    await user.keyboard("{Home}")
    expect(radio("Alpha")).toBeChecked()
    expect(radio("Alpha")).toHaveFocus()
  })
})
