import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { cn } from "./cn"
import { type PanelPosition, panelPosition } from "./panel-position"

/** How long the pointer rests on a hover trigger before its panel opens, so that passing over many triggers opens none. */
export const HOVER_OPEN_MS = 300

/** How long a panel opened by hovering stays after the pointer leaves, so that the pointer can move into the panel. */
export const HOVER_CLOSE_MS = 200

/** The panel starts at the left edge of its trigger, or ends at its right edge when it would leave the viewport. */
const PANEL_PLACE = { align: "left", matchWidth: false } as const

const FOCUSABLE = "a[href], button:not([disabled])"

/**
 * Whether a panel is open: pinned by a click, or shown while the pointer rests on its hover trigger or on the panel.
 * Resting on the trigger opens the panel after `HOVER_OPEN_MS`; leaving the trigger and the panel closes it after
 * `HOVER_CLOSE_MS`, unless the pointer comes back first.
 */
const usePanelState = () => {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const clear = () => window.clearTimeout(timer.current)
  useEffect(() => clear, [])
  return {
    open: pinned || hovered,
    pinned,
    pin: () => {
      clear()
      setPinned(true)
    },
    enterTrigger: () => {
      clear()
      timer.current = window.setTimeout(() => setHovered(true), HOVER_OPEN_MS)
    },
    enterPanel: clear,
    leave: () => {
      clear()
      timer.current = window.setTimeout(() => setHovered(false), HOVER_CLOSE_MS)
    },
    close: () => {
      clear()
      setPinned(false)
      setHovered(false)
    },
  }
}

type PanelState = ReturnType<typeof usePanelState>

type PanelProps = {
  state: PanelState
  anchor: RefObject<HTMLElement | null>
  /** The name of the panel, for assistive technology. */
  label: string
  id: string
  /** Called after Escape or a click outside closes the panel. */
  onClose: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  panelRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}

/**
 * The panel of a popover, fixed to the viewport so that no clipping box hides it, under its anchor or over it when there
 * is more room above. Its content is drawn only while it is open, so that what the content asks the api for is asked
 * for only when the panel opens. Escape and a click outside the anchor and the panel close it.
 */
const Panel = ({ state, anchor, label, id, onClose, onKeyDown, panelRef, children }: PanelProps) => {
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const { open } = state

  // Once the panel is drawn, its size decides where it fits; the panel then follows its anchor.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      if (anchor.current) {
        setPosition(panelPosition(anchor.current, panelRef.current?.offsetHeight ?? 0, PANEL_PLACE, panelRef.current?.offsetWidth ?? 0))
      }
    }
    measure()
    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    return () => {
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
    }
  }, [open, anchor, panelRef])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (!anchor.current?.contains(target) && !panelRef.current?.contains(target)) {
        state.close()
      }
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        state.close()
        onClose()
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, anchor, panelRef, state, onClose])

  return open
    ? createPortal(
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        style={position ?? { visibility: "hidden" }}
        onKeyDown={onKeyDown}
        onMouseEnter={state.enterPanel}
        onMouseLeave={state.leave}
        className="fixed z-popover w-90 rounded-card border border-border-soft bg-surface px-4 py-3.5 shadow-modal outline-none"
      >
        {children}
      </div>,
      document.body,
    )
    : null
}

type PopoverProps = {
  /** What the button shows, such as the label of a term. */
  trigger: ReactNode
  /** A part of the button after `trigger` that also opens the panel when the pointer rests on it, such as a term ID. */
  hoverTrigger?: ReactNode
  /** The classes of the button, so that it looks like the text it stands in for. */
  triggerClassName?: string
  /** The name of the panel, for assistive technology. */
  label: string
  children: ReactNode
}

/**
 * A button that opens a panel of details under it, in the disclosure pattern of a non-modal dialog. A click opens and
 * pins the panel and moves the focus to its first link or button, or to the panel itself while its links are on their
 * way, so that Tab reaches them; a second click closes it. Resting the pointer on `hoverTrigger` opens the panel without
 * moving the focus, and a click then pins it. A click outside, Escape, or Tab past the last link closes the panel, and
 * the focus goes back to the button.
 */
export const Popover = ({ trigger, hoverTrigger, triggerClassName, label, children }: PopoverProps) => {
  const state = usePanelState()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const close = () => {
    state.close()
    buttonRef.current?.focus()
  }

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== "Tab") return
    const elements = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = elements[0] ?? panelRef.current
    const last = elements[elements.length - 1] ?? panelRef.current
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault()
      close()
    } else if (!event.shiftKey && document.activeElement === last) {
      // The focus goes back to the button before the browser moves it, so Tab continues from the button.
      close()
    }
  }

  // A click moves the focus into the panel; resting the pointer on the button does not.
  useEffect(() => {
    if (!state.pinned) return
    const target = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current
    target?.focus()
  }, [state.pinned])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={state.open}
        aria-controls={state.open ? panelId : undefined}
        onClick={() => (state.pinned ? close() : state.pin())}
        className={cn("cursor-pointer text-left", triggerClassName)}
      >
        {trigger}
        {hoverTrigger !== undefined && (
          <>
            {" "}
            <span onMouseEnter={state.enterTrigger} onMouseLeave={state.leave}>
              {hoverTrigger}
            </span>
          </>
        )}
      </button>
      <Panel state={state} anchor={buttonRef} label={label} id={panelId} onClose={() => buttonRef.current?.focus()} onKeyDown={onPanelKeyDown} panelRef={panelRef}>
        {children}
      </Panel>
    </>
  )
}

type HoverPopoverProps = {
  /** The text that opens the panel when the pointer rests on it, such as a term ID. */
  trigger: ReactNode
  /** The classes of the text. */
  triggerClassName?: string
  /** The name of the panel, for assistive technology. */
  label: string
  children: ReactNode
}

/**
 * Text that opens a panel of details under it while the pointer rests on it or on the panel, without a button of its
 * own: a click goes to whatever the text is part of, such as a bar that changes the condition, and the text adds no
 * stop to the keyboard order. The panel does not take the focus. Escape or a click outside closes it.
 */
export const HoverPopover = ({ trigger, triggerClassName, label, children }: HoverPopoverProps) => {
  const state = usePanelState()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  return (
    <>
      <span
        ref={anchorRef}
        aria-describedby={state.open ? panelId : undefined}
        onMouseEnter={state.enterTrigger}
        onMouseLeave={state.leave}
        className={triggerClassName}
      >
        {trigger}
      </span>
      <Panel state={state} anchor={anchorRef} label={label} id={panelId} onClose={() => undefined} panelRef={panelRef}>
        {children}
      </Panel>
    </>
  )
}
