import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { COPIED_MS, CopyButton } from "~/ui/copy-button"

const click = async (button: HTMLElement) => {
  await act(async () => {
    fireEvent.click(button)
  })
}

describe("CopyButton", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("is named by its label and says nothing before it is pressed", () => {
    render(<CopyButton onCopy={async () => true}>Share</CopyButton>)
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("")
  })

  it("says Copied! after a successful copy and returns to its label after COPIED_MS", async () => {
    const onCopy = vi.fn(async () => true)
    render(<CopyButton onCopy={onCopy}>Share</CopyButton>)
    await click(screen.getByRole("button", { name: "Share" }))
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Copied")
    act(() => {
      vi.advanceTimersByTime(COPIED_MS - 1)
    })
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("")
  })

  it("keeps its label when the copy fails", async () => {
    render(<CopyButton onCopy={async () => false}>Copy</CopyButton>)
    await click(screen.getByRole("button", { name: "Copy" }))
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("")
  })

  it("counts COPIED_MS again from the last press", async () => {
    render(<CopyButton onCopy={async () => true}>Share</CopyButton>)
    await click(screen.getByRole("button", { name: "Share" }))
    act(() => {
      vi.advanceTimersByTime(COPIED_MS - 100)
    })
    await click(screen.getByRole("button", { name: "Copied!" }))
    act(() => {
      vi.advanceTimersByTime(COPIED_MS - 1)
    })
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument()
  })

  it("keeps both labels in the button so its width does not change", () => {
    render(<CopyButton onCopy={async () => true}>Share</CopyButton>)
    const button = screen.getByRole("button", { name: "Share" })
    expect(button).toHaveTextContent("Share")
    expect(button).toHaveTextContent("Copied!")
  })

  it("cancels the return to its label when it is unmounted", async () => {
    const { unmount } = render(<CopyButton onCopy={async () => true}>Share</CopyButton>)
    await click(screen.getByRole("button", { name: "Share" }))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
