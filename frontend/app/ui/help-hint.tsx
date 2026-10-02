import { type ReactNode, useEffect, useId, useRef, useState } from "react"

import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"

type HelpHintProps = {
  /** What the help is about, as the accessible name of the button: "About annotation status". */
  label: string
  children: ReactNode
}

/**
 * A "?" button that shows a short explanation in a bubble under it. The bubble opens while the pointer is over the
 * button or the button has focus; a click keeps it open until another click, a click outside, or Escape.
 */
export const HelpHint = ({ label, children }: HelpHintProps) => {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wrapper = useRef<HTMLSpanElement | null>(null)
  const bubbleId = useId()
  const open = hovered || pinned

  useEffect(() => {
    if (!pinned) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setPinned(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [pinned])

  return (
    <span ref={wrapper} className="relative inline-flex">
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
          className="absolute top-full left-1/2 z-tooltip mt-1.5 w-max max-w-64 -translate-x-1/2 rounded-button bg-ink px-3 py-2 text-fs-label leading-snug font-normal whitespace-normal text-white shadow-modal"
        >
          {children}
        </span>
      )}
    </span>
  )
}
