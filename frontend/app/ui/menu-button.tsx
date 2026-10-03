import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { ACTION_ICON, Icon, type IconName } from "./icons"
import { type PanelPosition,panelPosition } from "./panel-position"
import { LinkButton } from "./text-link"

export type MenuButtonItem = {
  label: string
  /** A few words on what the item gives, after its label. */
  hint?: string
  onSelect: () => void
}

type MenuButtonProps = {
  label: string
  /** The glyph of the action, on the button and before every item. */
  icon: IconName
  items: readonly MenuButtonItem[]
  /** The name of the button and the menu, when other buttons on the page have the same text. */
  "aria-label"?: string
}

/** The menu ends at the right edge of the button and is at least as wide as the button. */
const MENU_PLACE = { align: "right", matchWidth: true } as const

/**
 * Text that acts as a button and opens a menu of actions under it, in the menu button pattern of WAI-ARIA: opening the
 * menu moves the focus to its first item, the arrow keys, Home, and End move through the items, and Escape or Tab
 * closes the menu and gives the focus back to the button.
 */
export const MenuButton = ({ label, icon, items, "aria-label": ariaLabel }: MenuButtonProps) => {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const show = () => {
    if (!anchorRef.current || items.length === 0) return
    setPosition(panelPosition(anchorRef.current, 0, MENU_PLACE))
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    anchorRef.current?.querySelector("button")?.focus()
  }

  const choose = (item: MenuButtonItem) => {
    close()
    item.onSelect()
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" || open) return
    event.preventDefault()
    show()
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])]
    const current = elements.findIndex((element) => element === document.activeElement)
    const focusAt = (index: number) => {
      event.preventDefault()
      elements[(index + elements.length) % elements.length]?.focus()
    }
    switch (event.key) {
      case "ArrowDown":
        return focusAt(current + 1)
      case "ArrowUp":
        return focusAt(current - 1)
      case "Home":
        return focusAt(0)
      case "End":
        return focusAt(elements.length - 1)
      case "Escape":
        event.preventDefault()
        event.stopPropagation()
        return close()
      case "Tab":
        // The focus goes back to the button before the browser moves it, so Tab continues from the button.
        return close()
    }
  }

  // Once the menu is drawn, its height decides whether it fits under the button; the menu then follows the button.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      if (anchorRef.current) setPosition(panelPosition(anchorRef.current, menuRef.current?.offsetHeight ?? 0, MENU_PLACE))
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
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus()
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
    }
  }, [open])

  const menu =
    open && position !== null
      ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? label}
          style={position}
          onKeyDown={onMenuKeyDown}
          className="fixed z-popover rounded-card border border-border-soft bg-surface p-1.5 shadow-modal"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => choose(item)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-button px-2 py-1.5 text-left text-fs-body-sm whitespace-nowrap text-ink hover:bg-brand-soft hover:text-brand-deep focus-visible:bg-brand-soft focus-visible:text-brand-deep"
            >
              <Icon name={icon} className="text-brand" />
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="pl-4 text-fs-label text-ink-soft">{item.hint}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )
      : null

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        <LinkButton
          tone="soft"
          size="md"
          icon={icon}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? close() : show())}
          onKeyDown={onTriggerKeyDown}
        >
          {label}
          <Icon name={ACTION_ICON.openList} size="sm" className="opacity-60" />
        </LinkButton>
      </span>
      {menu}
    </>
  )
}
