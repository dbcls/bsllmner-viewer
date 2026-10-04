import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Modal, MODAL_OPEN_EVENT } from "~/ui/modal"
import { HOVER_CLOSE_MS, HOVER_OPEN_MS, HoverPopover, Popover } from "~/ui/popover"

const renderPopover = (links = ["OLS", "Show BioSamples with this term"]) =>
  render(
    <>
      <Popover trigger="dimethyl sulfoxide" label="dimethyl sulfoxide">
        <p>CHEBI:28262</p>
        {links.map((text) => (
          <a key={text} href={`#${text}`}>
            {text}
          </a>
        ))}
      </Popover>
      <p>Outside</p>
      <input aria-label="Next field" />
    </>,
  )

const trigger = () => screen.getByRole("button", { name: "dimethyl sulfoxide" })
const link = (name: string) => screen.getByRole("link", { name })

describe("Popover", () => {
  it("is a button that announces a dialog and keeps the panel closed", () => {
    renderPopover()
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog")
    expect(trigger()).toHaveAttribute("aria-expanded", "false")
    expect(trigger()).not.toHaveAttribute("aria-controls")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens on click with its content, named after its label, and the focus on the first link", async () => {
    const user = userEvent.setup()
    renderPopover()
    await user.click(trigger())
    const panel = screen.getByRole("dialog", { name: "dimethyl sulfoxide" })
    expect(panel).toHaveTextContent("CHEBI:28262")
    expect(trigger()).toHaveAttribute("aria-expanded", "true")
    expect(trigger()).toHaveAttribute("aria-controls", panel.id)
    expect(link("OLS")).toHaveFocus()
  })

  it("opens from the keyboard with Enter and closes with Escape, giving the focus back to the button", async () => {
    const user = userEvent.setup()
    renderPopover()
    trigger().focus()
    await user.keyboard("{Enter}")
    expect(link("OLS")).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it("puts the focus on a panel without links, and closes it with Escape or Tab, giving the focus back to the button", async () => {
    const user = userEvent.setup()
    renderPopover([])
    await user.click(trigger())
    expect(screen.getByRole("dialog")).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(trigger()).toHaveFocus()
    await user.click(trigger())
    await user.tab()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes on a click outside, and on a second click on the button", async () => {
    const user = userEvent.setup()
    renderPopover()
    await user.click(trigger())
    await user.click(screen.getByText("Outside"))
    expect(screen.queryByRole("dialog")).toBeNull()
    await user.click(trigger())
    await user.click(trigger())
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("stays open for a click inside the panel", async () => {
    const user = userEvent.setup()
    renderPopover()
    await user.click(trigger())
    await user.click(screen.getByText("CHEBI:28262"))
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("moves through its links with Tab, and closes when Tab leaves the last link, continuing after the button", async () => {
    const user = userEvent.setup()
    renderPopover()
    await user.click(trigger())
    await user.tab()
    expect(link("Show BioSamples with this term")).toHaveFocus()
    await user.tab()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("textbox", { name: "Next field" })).toHaveFocus()
  })

  it("closes when Shift+Tab leaves the first link, with the focus on the button", async () => {
    const user = userEvent.setup()
    renderPopover()
    await user.click(trigger())
    await user.tab({ shift: true })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(trigger()).toHaveFocus()
  })
})

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

describe("Popover with a hover trigger", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const renderHover = () =>
    render(
      <Popover trigger="brain" hoverTrigger="UBERON:0000955" label="brain">
        <a href="#ols">UBERON</a>
      </Popover>,
    )

  it("opens when the pointer rests on the hover trigger, without moving the focus, and closes after it leaves", () => {
    vi.useFakeTimers()
    renderHover()
    const id = screen.getByText("UBERON:0000955")
    fireEvent.mouseEnter(id)
    wait(HOVER_OPEN_MS - 1)
    expect(screen.queryByRole("dialog")).toBeNull()
    wait(1)
    expect(screen.getByRole("dialog", { name: "brain" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "UBERON" })).not.toHaveFocus()
    fireEvent.mouseLeave(id)
    wait(HOVER_CLOSE_MS - 1)
    expect(screen.getByRole("dialog")).toBeTruthy()
    wait(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("stays open while the pointer moves from the trigger into the panel", () => {
    vi.useFakeTimers()
    renderHover()
    const id = screen.getByText("UBERON:0000955")
    fireEvent.mouseEnter(id)
    wait(HOVER_OPEN_MS)
    fireEvent.mouseLeave(id)
    fireEvent.mouseEnter(screen.getByRole("dialog"))
    wait(HOVER_CLOSE_MS * 2)
    expect(screen.getByRole("dialog")).toBeTruthy()
    fireEvent.mouseLeave(screen.getByRole("dialog"))
    wait(HOVER_CLOSE_MS)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("stays open when the pointer returns to the hover trigger before the panel closes", () => {
    vi.useFakeTimers()
    renderHover()
    const id = screen.getByText("UBERON:0000955")
    fireEvent.mouseEnter(id)
    wait(HOVER_OPEN_MS)
    fireEvent.mouseLeave(id)
    wait(HOVER_CLOSE_MS - 1)
    fireEvent.mouseEnter(id)
    wait(HOVER_CLOSE_MS)
    expect(screen.getByRole("dialog", { name: "brain" })).toBeTruthy()
  })

  it("pins a panel that the pointer opened when the button is clicked, and keeps it after the pointer leaves", () => {
    vi.useFakeTimers()
    renderHover()
    const id = screen.getByText("UBERON:0000955")
    fireEvent.mouseEnter(id)
    wait(HOVER_OPEN_MS)
    fireEvent.click(screen.getByRole("button", { name: "brain UBERON:0000955" }))
    fireEvent.mouseLeave(id)
    wait(HOVER_CLOSE_MS * 2)
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByRole("link", { name: "UBERON" })).toHaveFocus()
  })
})

describe("HoverPopover", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const Content = vi.fn(() => <a href="#ols">UBERON</a>)
  const renderHover = () =>
    render(
      <>
        <button type="button">Bar</button>
        <HoverPopover trigger="UBERON:0000955" label="brain">
          <Content />
        </HoverPopover>
      </>,
    )

  it("draws nothing of the panel when the pointer passes over the text before the wait ends", () => {
    vi.useFakeTimers()
    Content.mockClear()
    renderHover()
    const id = screen.getByText("UBERON:0000955")
    fireEvent.mouseEnter(id)
    wait(HOVER_OPEN_MS - 1)
    fireEvent.mouseLeave(id)
    wait(HOVER_OPEN_MS)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(Content).not.toHaveBeenCalled()
  })

  it("opens while the pointer rests on the text, leaves the focus where it was, adds no keyboard stop, and closes with Escape", () => {
    vi.useFakeTimers()
    renderHover()
    screen.getByRole("button", { name: "Bar" }).focus()
    const id = screen.getByText("UBERON:0000955")
    expect(id.tabIndex).toBe(-1)
    fireEvent.mouseEnter(id)
    wait(HOVER_OPEN_MS)
    expect(screen.getByRole("dialog", { name: "brain" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Bar" })).toHaveFocus()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("Popover over a modal dialog and focus timing", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("moves the focus into the panel only after the panel is drawn at its position", async () => {
    const user = userEvent.setup()
    renderPopover()
    const seen: string[] = []
    const onFocusIn = (event: FocusEvent) => {
      const panel = (event.target as HTMLElement).closest<HTMLElement>("[role='dialog']")
      if (panel) seen.push(panel.style.visibility)
    }
    document.addEventListener("focusin", onFocusIn)
    trigger().focus()
    await user.keyboard("{Enter}")
    document.removeEventListener("focusin", onFocusIn)
    expect(link("OLS")).toHaveFocus()
    expect(seen).toEqual([""])
  })

  it("does not open a HoverPopover behind a modal dialog, and closes one that is open when the dialog opens", () => {
    vi.useFakeTimers()
    render(
      <>
        <HoverPopover trigger="CHEBI:1" label="CHEBI:1">
          <p>details</p>
        </HoverPopover>
        <Modal open={false} onClose={vi.fn()} title="Add">
          <button>Inside</button>
        </Modal>
      </>,
    )
    const open = () => {
      fireEvent.mouseEnter(screen.getByText("CHEBI:1"))
      act(() => void vi.advanceTimersByTime(HOVER_OPEN_MS))
    }
    open()
    expect(screen.getByText("details")).toBeInTheDocument()
    const dialog = document.createElement("div")
    dialog.setAttribute("aria-modal", "true")
    document.body.append(dialog)
    act(() => void document.dispatchEvent(new Event(MODAL_OPEN_EVENT)))
    expect(screen.queryByText("details")).toBeNull()
    fireEvent.mouseLeave(screen.getByText("CHEBI:1"))
    open()
    expect(screen.queryByText("details")).toBeNull()
    dialog.remove()
    open()
    expect(screen.getByText("details")).toBeInTheDocument()
  })
})
