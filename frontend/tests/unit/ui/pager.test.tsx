import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Pager } from "~/ui/pager"

describe("Pager", () => {
  it("shows the range of the page within the whole list", () => {
    render(<Pager page={2} perPage={25} total={4_100_500} onChange={vi.fn()} />)
    expect(screen.getByText("26–50 / 4,100,500")).toBeInTheDocument()
  })

  it("disables the previous page on the first page and the next page on the last page", () => {
    const { rerender } = render(<Pager page={1} perPage={25} total={60} onChange={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled()
    rerender(<Pager page={3} perPage={25} total={60} onChange={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
  })

  it("moves to the next page and to the previous page", async () => {
    const onChange = vi.fn()
    render(<Pager page={5} perPage={25} total={1000} onChange={onChange} />)
    await userEvent.click(screen.getByRole("button", { name: "Next page" }))
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }))
    expect(onChange.mock.calls).toEqual([[6], [4]])
  })

  it("disables both steps for a list of one page and shows 0 results for an empty list", () => {
    const { rerender } = render(<Pager page={1} perPage={25} total={7} onChange={vi.fn()} />)
    expect(screen.getByText("1–7 / 7")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
    rerender(<Pager page={1} perPage={25} total={0} onChange={vi.fn()} />)
    expect(screen.getByText("0 results")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
  })

  it("shows that the list is being counted while the total is unknown", () => {
    render(<Pager page={1} perPage={25} total={undefined} onChange={vi.fn()} />)
    expect(screen.getByText("Counting…")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
