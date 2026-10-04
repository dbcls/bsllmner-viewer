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

  it("keeps its frame while the total is counted: a busy range and disabled steps", () => {
    render(<Pager page={1} perPage={25} total={undefined} onChange={vi.fn()} />)
    expect(screen.getByRole("navigation", { name: "Pages" })).toHaveAttribute("aria-busy", "true")
    expect(screen.queryByText(/results|\//)).toBeNull()
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
  })
})

describe("Pager edges", () => {
  it("enables the next page on the page before the last and shows the short last page up to the total", () => {
    const { rerender } = render(<Pager page={2} perPage={25} total={60} onChange={vi.fn()} />)
    expect(screen.getByText("26–50 / 60")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled()
    rerender(<Pager page={3} perPage={25} total={60} onChange={vi.fn()} />)
    expect(screen.getByText("51–60 / 60")).toBeInTheDocument()
  })

  it("shows a dash, disables both steps, and is not busy when the list could not be loaded", () => {
    const { rerender } = render(<Pager page={2} perPage={25} total={60} onChange={vi.fn()} failed />)
    expect(screen.getByText("–")).toBeInTheDocument()
    expect(screen.queryByText(/60/)).toBeNull()
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
    rerender(<Pager page={2} perPage={25} total={undefined} onChange={vi.fn()} failed />)
    expect(screen.getByRole("navigation", { name: "Pages" })).not.toHaveAttribute("aria-busy")
  })
})

describe("Pager landmark name", () => {
  it("is named Pages by default and takes another name when two pagers share a page", () => {
    render(
      <>
        <Pager page={1} perPage={25} total={60} onChange={vi.fn()} />
        <Pager page={1} perPage={25} total={60} onChange={vi.fn()} label="Pages (bottom)" />
      </>,
    )
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Pages (bottom)" })).toBeInTheDocument()
  })
})
