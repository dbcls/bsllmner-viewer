import { act, render, renderHook, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Alert, ALERT_MS, useAlert } from "~/ui/alert"

describe("Alert", () => {
  it("draws nothing without a message", () => {
    const { container } = render(<Alert message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("announces the message as an alert, with a decorative warning icon before it", () => {
    render(<Alert message="A trend shows up to 5 terms" />)
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("A trend shows up to 5 terms")
    const [icon, text] = [...alert.children]
    expect(icon?.tagName.toLowerCase()).toBe("svg")
    expect(icon).toHaveAttribute("aria-hidden", "true")
    expect(text).toHaveTextContent("A trend shows up to 5 terms")
  })
})

describe("useAlert", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows a message for ALERT_MS, and then removes it", () => {
    const { result } = renderHook(() => useAlert())
    expect(result.current[0]).toBeNull()
    act(() => result.current[1]("Copy failed."))
    expect(result.current[0]).toBe("Copy failed.")
    act(() => vi.advanceTimersByTime(ALERT_MS - 1))
    expect(result.current[0]).toBe("Copy failed.")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current[0]).toBeNull()
  })

  it("replaces the shown message with a new one, which stays for the whole ALERT_MS", () => {
    const { result } = renderHook(() => useAlert())
    act(() => result.current[1]("first"))
    act(() => vi.advanceTimersByTime(ALERT_MS - 1))
    act(() => result.current[1]("second"))
    act(() => vi.advanceTimersByTime(ALERT_MS - 1))
    expect(result.current[0]).toBe("second")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current[0]).toBeNull()
  })

  it("leaves no timer after the page that shows the alert is removed", () => {
    const { result, unmount } = renderHook(() => useAlert())
    act(() => result.current[1]("Copy failed."))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
