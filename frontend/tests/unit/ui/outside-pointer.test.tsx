import { fc, test } from "@fast-check/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useOutsidePointer } from "~/ui/panel-position"

const Harness = ({ open, onOutside, count }: { open: boolean; onOutside: () => void; count: number }) => {
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)].slice(0, count)
  useOutsidePointer(open, refs, onOutside)
  return (
    <div>
      {refs.map((ref, index) => (
        <div key={index} ref={ref} data-testid={`inside-${index}`}>
          <span data-testid={`child-${index}`} />
        </div>
      ))}
      <p data-testid="outside" />
    </div>
  )
}

describe("useOutsidePointer", () => {
  afterEach(cleanup)

  it("calls onOutside for a mouse or touch press outside every ref", () => {
    const onOutside = vi.fn()
    render(<Harness open onOutside={onOutside} count={2} />)
    fireEvent.mouseDown(screen.getByTestId("outside"))
    fireEvent.touchStart(screen.getByTestId("outside"))
    expect(onOutside).toHaveBeenCalledTimes(2)
  })

  it("does nothing while closed", () => {
    const onOutside = vi.fn()
    render(<Harness open={false} onOutside={onOutside} count={2} />)
    fireEvent.mouseDown(screen.getByTestId("outside"))
    fireEvent.touchStart(document.body)
    expect(onOutside).not.toHaveBeenCalled()
  })

  it("stops listening when it closes", () => {
    const onOutside = vi.fn()
    const { rerender } = render(<Harness open onOutside={onOutside} count={1} />)
    rerender(<Harness open={false} onOutside={onOutside} count={1} />)
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(onOutside).not.toHaveBeenCalled()
  })

  it("calls the latest onOutside", () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Harness open onOutside={first} count={1} />)
    rerender(<Harness open onOutside={second} count={1} />)
    act(() => {
      fireEvent.mouseDown(screen.getByTestId("outside"))
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  test.prop([fc.integer({ min: 1, max: 3 }), fc.integer({ min: 0, max: 2 }), fc.boolean(), fc.constantFrom("mouse", "touch")])(
    "calls onOutside exactly when a press is outside every ref",
    (count, index, inside, kind) => {
      const onOutside = vi.fn()
      const { unmount } = render(<Harness open onOutside={onOutside} count={count} />)
      try {
        const id = inside ? `child-${index % count}` : "outside"
        const target = screen.getByTestId(id)
        if (kind === "mouse") fireEvent.mouseDown(target)
        else fireEvent.touchStart(target)
        expect(onOutside).toHaveBeenCalledTimes(inside ? 0 : 1)
      } finally {
        unmount()
      }
    },
  )
})
