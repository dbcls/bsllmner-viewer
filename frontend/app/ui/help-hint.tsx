import { type ReactNode, useEffect, useId, useRef, useState } from "react"

import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"
import { coveredByModal, MODAL_OPEN_EVENT } from "./modal"
import { useOutsidePointer } from "./panel-position"

type HelpHintProps = {
  /** What the help is about, as the accessible name of the button: "About annotation status". */
  label: string
  /** Where the bubble opens. `top` keeps a bubble near the bottom of the page from making the page taller. */
  side?: "bottom" | "top"
  children: ReactNode
}

/**
 * A "?" button that shows a short explanation in a bubble under it. The bubble opens while the pointer is over the
 * button or the button has focus; a click keeps it open until another click, a click outside, or Escape. Escape also
 * closes a bubble opened by hovering or focus, and the bubble stays closed until the next hover or focus. The pointer
 * can move onto the bubble without closing it. A modal dialog that opens over the bubble closes it. The button looks 15px wide and takes the pointer in 24px. The button
 * keeps the same space (8px) from the element before it on every screen, so a container puts it after that element
 * without a gap of its own.
 */
export const HelpHint = ({ label, side = "bottom", children }: HelpHintProps) => {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wrapper = useRef<HTMLSpanElement | null>(null)
  const bubbleId = useId()
  const open = hovered || pinned

  useOutsidePointer(pinned, [wrapper], () => setPinned(false))

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setPinned(false)
      setHovered(false)
    }
    // A modal dialog that opens over the bubble closes it, so that the bubble is not drawn over the dialog.
    const onModalOpen = () => {
      if (!coveredByModal(wrapper.current)) return
      setPinned(false)
      setHovered(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener(MODAL_OPEN_EVENT, onModalOpen)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener(MODAL_OPEN_EVENT, onModalOpen)
    }
  }, [open])

  return (
    <span ref={wrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} className="relative ml-2 inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned((current) => !current)}
        className={cn(
          "relative inline-flex cursor-help items-center after:absolute after:-inset-1.5 after:content-[''] justify-center rounded-pill text-fs-body leading-none",
          open ? "text-brand" : "text-ink-soft hover:text-brand",
        )}
      >
        <Icon name={ACTION_ICON.showHelp} />
      </button>
      {open && (
        <span
          id={bubbleId}
          role="tooltip"
          className={cn(
            "absolute left-1/2 z-tooltip w-max max-w-64 -translate-x-1/2 rounded-button border border-border-soft bg-surface px-3 py-2 text-fs-label leading-snug font-normal whitespace-normal text-ink shadow-card-hover",
            // The bridge covers the gap to the button, so the pointer can cross it without leaving the wrapper.
            "before:absolute before:inset-x-0 before:h-2 before:content-['']",
            side === "bottom" ? "top-full mt-1.5 before:-top-2" : "bottom-full mb-1.5 before:-bottom-2",
          )}
        >
          {children}
        </span>
      )}
    </span>
  )
}
