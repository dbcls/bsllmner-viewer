import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { BOX_FOCUS, BOX_SIZE, type BoxSize } from "./box"
import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"
import { type PanelPosition,panelPosition } from "./panel-position"

export type SelectOption = { value: string; label: string }

type SelectProps = {
  options: readonly SelectOption[]
  value: string
  onChange: (value: string) => void
  size?: BoxSize
  block?: boolean
  /**
   * Squares the right corners, so that a control placed after the select shares its right edge. The select draws over
   * that control while its edge is colored (hovered, focused, or open), so that the shared edge shows the color.
   */
  attached?: boolean
  /** The label of an extra first option whose value is the empty string, such as "None" or "Choose…". */
  placeholder?: string
  "aria-label": string
}

/** The list starts at the left edge of the button and is at least as wide as the button. */
const LIST_PLACE = { align: "left", matchWidth: true } as const

/**
 * A choice of one option from a list: a button that shows the chosen option and opens the list under it.
 * It follows the select-only combobox pattern of WAI-ARIA: focus stays on the button, and the arrow keys, Home, End,
 * and the first letter of a label move through the list.
 */
export const Select = ({ options, value, onChange, size = "md", block, attached, placeholder, "aria-label": ariaLabel }: SelectProps) => {
  const items: readonly SelectOption[] = placeholder === undefined ? options : [{ value: "", label: placeholder }, ...options]
  const selectedIndex = items.findIndex((item) => item.value === value)
  const selected = items[selectedIndex]
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const optionId = (index: number) => `${listId}-option-${index}`

  const show = (index: number) => {
    const trigger = triggerRef.current
    if (!trigger || items.length === 0) return
    setActive(Math.min(Math.max(index, 0), items.length - 1))
    setPosition(panelPosition(trigger, 0, LIST_PLACE))
    setOpen(true)
  }

  const close = () => setOpen(false)

  const choose = (index: number) => {
    const item = items[index]
    close()
    triggerRef.current?.focus()
    if (item && item.value !== value) onChange(item.value)
  }

  const matchFrom = (start: number, key: string): number => {
    const letter = key.toLowerCase()
    for (let offset = 1; offset <= items.length; offset += 1) {
      const index = (start + offset) % items.length
      if (items[index]?.label.toLowerCase().startsWith(letter)) return index
    }
    return -1
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = items.length - 1
    const current = open ? active : Math.max(selectedIndex, 0)
    const move = (index: number) => {
      event.preventDefault()
      if (open) setActive(Math.min(Math.max(index, 0), last))
      else show(index)
    }
    switch (event.key) {
      case "ArrowDown":
        return open ? move(current + 1) : move(current)
      case "ArrowUp":
        return open ? move(current - 1) : move(current)
      case "Home":
        return move(0)
      case "End":
        return move(last)
      case "Enter":
      case " ":
        event.preventDefault()
        return open ? choose(active) : show(current)
      case "Escape":
        if (!open) return
        event.preventDefault()
        event.stopPropagation()
        return close()
      case "Tab":
        return close()
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const index = matchFrom(current, event.key)
          if (index >= 0) move(index)
        }
    }
  }

  // Once the list is drawn, its height decides whether it fits under the button; the list then follows the button.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      if (triggerRef.current) setPosition(panelPosition(triggerRef.current, listRef.current?.offsetHeight ?? 0, LIST_PLACE))
    }
    measure()
    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    return () => {
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) close()
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
    }
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" })
  })

  const list =
    open && position !== null
      ? createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={position}
          className="fixed z-popover max-h-listbox overflow-auto rounded-button border border-border-soft bg-surface py-1 shadow-card-hover"
        >
          {items.map((item, index) => (
            <li
              key={item.value}
              id={optionId(index)}
              role="option"
              aria-selected={index === selectedIndex}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              className={cn(
                "cursor-pointer px-2.5 py-1.5 whitespace-nowrap",
                size === "sm" ? "text-fs-label" : "text-fs-body-sm",
                index === active && "bg-brand-soft",
                index === selectedIndex ? "font-semibold text-brand-deep" : "text-ink",
              )}
            >
              {item.label}
            </li>
          ))}
        </ul>,
        document.body,
      )
      : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? close() : show(selectedIndex))}
        onKeyDown={onKeyDown}
        className={cn(
          "cursor-pointer items-center gap-1.5 border bg-surface text-left hover:border-brand-light",
          BOX_FOCUS,
          attached ? "relative rounded-l-button rounded-r-none hover:z-10 focus-visible:z-10" : "rounded-button",
          attached && open && "z-10",
          open ? "border-brand" : "border-border-soft",
          BOX_SIZE[size],
          size === "sm" ? "pr-1.5 pl-2" : "pr-2 pl-2.5",
          block ? "flex w-full" : "inline-flex shrink-0",
          value === "" && placeholder !== undefined ? "text-ink-soft" : "text-ink",
        )}
      >
        {/* Every label sits in the same grid cell and only the chosen one is visible, so the button is as wide as the longest label. */}
        <span className="grid min-w-0 flex-1">
          {items.map((item) => (
            <span
              key={item.value}
              aria-hidden={item !== selected}
              className={cn("col-start-1 row-start-1 truncate", item !== selected && "invisible")}
            >
              {item.label}
            </span>
          ))}
        </span>
        <Icon name={ACTION_ICON.openList} className="text-ink-soft" />
      </button>
      {list}
    </>
  )
}
