import { type ReactNode, useEffect, useId, useRef, useState } from "react"

import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"
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
 * button or the button has focus; a click keeps it open until another click, a click outside, or Escape. The button
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
    if (!pinned) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [pinned])

  return (
    <span ref={wrapper} className="relative ml-2 inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned((current) => !current)}
        className={cn(
          "inline-flex cursor-help items-center justify-center rounded-pill text-fs-body leading-none",
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
            "absolute left-1/2 z-tooltip w-max max-w-64 -translate-x-1/2 rounded-button border border-border-soft bg-surface px-3 py-2 text-fs-label leading-snug font-normal whitespace-normal text-ink shadow-modal",
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          )}
        >
          {children}
        </span>
      )}
    </span>
  )
}
