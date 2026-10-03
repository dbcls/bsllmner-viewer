import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "./button"
import { ACTION_ICON, Icon, type IconName } from "./icons"
import { useAnchoredPosition, useOutsidePointer } from "./panel-position"
import { LinkButton } from "./text-link"

type MenuItemBase = {
  label: string
  /** A few words on what the item gives, after its label. */
  hint?: string
}

/** An item that runs an action. */
export type MenuButtonAction = MenuItemBase & { onSelect: () => void }

/** An item that is a link to a file to download. */
export type MenuButtonLink = MenuItemBase & { href: string }

export type MenuButtonItem = MenuButtonAction | MenuButtonLink

/** Items under a heading with a note, such as what the items give. A group does not take the focus. */
export type MenuButtonGroup = {
  title: string
  note: string
  items: readonly MenuButtonItem[]
}

type MenuButtonProps = {
  label: string
  /** The glyph of the action, on the button and before every item. */
  icon: IconName
  items: readonly (MenuButtonItem | MenuButtonGroup)[]
  /** `text` is text that acts as a button. `bar` is a secondary button that fills the width of its column, with a menu of the width of a column of the condition bar. */
  appearance?: "text" | "bar"
  /** The hints are in a monospace font, for identifiers. */
  monoHints?: boolean
  /** The name of the button and the menu, when other buttons on the page have the same text. */
  "aria-label"?: string
  /** The button cannot be pressed, as when there is nothing for the items to act on yet. */
  disabled?: boolean
}

const isGroup = (entry: MenuButtonItem | MenuButtonGroup): entry is MenuButtonGroup => "items" in entry

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2 rounded-button px-2 py-1.5 text-fs-body-sm whitespace-nowrap text-ink hover:bg-brand-soft hover:text-brand-deep focus-visible:bg-brand-soft focus-visible:text-brand-deep"

/** The menu ends at the right edge of the button and is at least as wide as the button. */
const MENU_PLACE = { align: "right", matchWidth: true } as const

/**
 * Text that acts as a button and opens a menu of actions under it, in the menu button pattern of WAI-ARIA: opening the
 * menu moves the focus to its first item, the arrow keys, Home, and End move through the items, and Escape or Tab
 * closes the menu and gives the focus back to the button.
 */
export const MenuButton = ({ label, icon, items, appearance = "text", monoHints = false, "aria-label": ariaLabel, disabled = false }: MenuButtonProps) => {
  const grouped = items.some(isGroup)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const { position, measure } = useAnchoredPosition(open, anchorRef, menuRef, MENU_PLACE)

  const show = () => {
    if (!anchorRef.current || items.length === 0) return
    measure()
    setOpen(true)
  }

  // A menu that is open when the button becomes disabled closes, and does not open again by itself.
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const close = () => {
    setOpen(false)
    anchorRef.current?.querySelector("button")?.focus()
  }

  const choose = (item: MenuButtonAction) => {
    close()
    item.onSelect()
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" || open) return
    event.preventDefault()
    show()
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])]
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

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus()
  }, [open])

  useOutsidePointer(open, [anchorRef, menuRef], () => setOpen(false))

  const renderItem = (item: MenuButtonItem) => {
    const content = (
      <>
        <Icon name={icon} className="text-brand" />
        <span className="flex-1">{item.label}</span>
        {item.hint && <span className={monoHints ? "font-mono text-fs-label text-ink-soft" : "pl-4 text-fs-label text-ink-soft"}>{item.hint}</span>}
      </>
    )
    return "href" in item ? (
      <a key={item.label} role="menuitem" tabIndex={-1} href={item.href} download onClick={close} className={`${ITEM_CLASS} no-underline`}>
        {content}
      </a>
    ) : (
      <button key={item.label} type="button" role="menuitem" tabIndex={-1} onClick={() => choose(item)} className={`${ITEM_CLASS} w-full text-left`}>
        {content}
      </button>
    )
  }

  const triggerProps = {
    "aria-label": ariaLabel,
    disabled,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: () => (open ? close() : show()),
    onKeyDown: onTriggerKeyDown,
  }

  const menu =
    open && !disabled && position !== null
      ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? label}
          style={position}
          onKeyDown={onMenuKeyDown}
          className={grouped ? "fixed z-popover w-menu rounded-card border border-border-soft bg-surface pb-1.5 shadow-modal" : "fixed z-popover rounded-card border border-border-soft bg-surface p-1.5 shadow-modal"}
        >
          {items.map((entry) =>
            isGroup(entry) ? (
              <div key={entry.title} role="group" aria-label={`${entry.title} (${entry.note})`} className="px-1.5 pt-2.5 pb-1">
                <div aria-hidden="true" className="mx-1.5 mb-1 flex items-baseline gap-1.5 border-b border-border-soft pb-1.5">
                  <span className="border-l-4 border-brand pl-2 text-fs-body-sm leading-tight font-bold text-ink">{entry.title}</span>
                  <span className="text-fs-label text-ink-soft">{entry.note}</span>
                </div>
                {entry.items.map(renderItem)}
              </div>
            ) : (
              renderItem(entry)
            ),
          )}
        </div>,
        document.body,
      )
      : null

  return (
    <>
      <span ref={anchorRef} className={appearance === "bar" ? "flex" : "inline-flex"}>
        {appearance === "bar" ? (
          <Button {...triggerProps} kind="secondary" size="xs" block icon={icon} trailingIcon={ACTION_ICON.openList}>
            {label}
          </Button>
        ) : (
          <LinkButton {...triggerProps} tone="soft" size="md" icon={icon}>
            {label}
            <Icon name={ACTION_ICON.openList} size="sm" className="opacity-60" />
          </LinkButton>
        )}
      </span>
      {menu}
    </>
  )
}
