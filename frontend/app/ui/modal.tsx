import { type ReactNode, useEffect, useRef, useState } from "react"

import { cn } from "./cn"
import { SectionHeading } from "./heading"
import { ACTION_ICON, Icon } from "./icons"

/** Dispatched on the document when a modal dialog opens, so that panels opened behind it close. */
export const MODAL_OPEN_EVENT = "bsllmner-modal-open"

const MODAL_SELECTOR = '[aria-modal="true"]'

/** Whether a modal dialog is open and the element is outside it, so that the dialog covers the element. */
export const coveredByModal = (element: Element | null): boolean => {
  const modal = document.querySelector(MODAL_SELECTOR)
  return modal !== null && (element === null || !modal.contains(element))
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Layers drawn in the body above the dialog or from inside it: they stay usable while the rest of the page is inert. */
const KEEP_ACTIVE = '[role="listbox"], [role="menu"], [role="alert"]'

const focusedElement = (): HTMLElement | null =>
  typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null

const tabbable = (dialog: HTMLElement): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>(TABBABLE)]

/** Makes every element outside the dialog inert and returns the function that undoes it. */
const makeOutsideInert = (dialog: HTMLElement): (() => void) => {
  const changed: Element[] = []
  let node: Element = dialog
  while (node !== document.body && node.parentElement) {
    const parent: Element = node.parentElement
    for (const sibling of parent.children) {
      if (sibling === node || sibling.hasAttribute("inert") || sibling.matches(KEEP_ACTIVE)) continue
      sibling.setAttribute("inert", "")
      changed.push(sibling)
    }
    node = parent
  }
  return () => {
    for (const element of changed) element.removeAttribute("inert")
  }
}

type ModalProps = {
  open: boolean
  onClose: () => void
  /** The heading of the dialog and its accessible name. */
  title: string
  /** One line under the title that says what the dialog shows. */
  description?: ReactNode
  children: ReactNode
  width?: "md" | "lg"
  align?: "top" | "center"
}

/**
 * An overlay dialog closed by Escape, by its close button, or by clicking the backdrop. While it is open, the focus
 * starts on the control of the content marked `data-autofocus`, or else on its first control (or on the dialog), Tab
 * stays inside the dialog, the rest of the page is inert, and closing puts the focus back where it was. The title is a section heading
 * with its brand rule before the text; the content under it supplies its own `px-6` padding.
 */
export const Modal = ({ open, onClose, title, description, children, width = "md", align = "top" }: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  // The element that had the focus before the dialog opened, read while the opening renders: content that takes the
  // focus as it mounts, such as an autofocused box, has not taken it yet.
  const [opener, setOpener] = useState<HTMLElement | null>(() => (open ? focusedElement() : null))
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpener(focusedElement())
  }

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const restore = makeOutsideInert(dialog)
    // Content that took the focus itself while mounting keeps it.
    if (!dialog.contains(document.activeElement)) {
      const start = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? tabbable(dialog).find((element) => element !== closeRef.current)
      ;(start ?? dialog).focus()
    }
    document.dispatchEvent(new Event(MODAL_OPEN_EVENT))
    return () => {
      restore()
      if (opener?.isConnected) opener.focus()
    }
  }, [open, opener])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
        return
      }
      const dialog = dialogRef.current
      if (event.key !== "Tab" || event.defaultPrevented || !dialog) return
      const active = document.activeElement
      if (active?.closest(KEEP_ACTIVE)) return
      const elements = tabbable(dialog)
      const first = elements[0] ?? dialog
      const last = elements[elements.length - 1] ?? dialog
      if (!dialog.contains(active) || active === dialog) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // A press that starts in the dialog and ends on the backdrop, such as selecting text, does not close the dialog.
  const pressedBackdrop = useRef(false)
  if (!open) return null
  return (
    <div
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) onClose()
        pressedBackdrop.current = false
      }}
      className={cn(
        "fixed inset-0 z-modal flex justify-center bg-overlay",
        align === "top" ? "items-start pt-20" : "items-center",
      )}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "overflow-hidden rounded-card bg-surface shadow-modal outline-none",
          width === "md" ? "w-modal" : "w-modal-wide",
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <SectionHeading>{title}</SectionHeading>
            {description && <p className="mt-1.5 text-fs-body-sm text-ink-soft">{description}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 cursor-pointer rounded-button p-1.5 text-fs-h2 leading-none text-ink-soft hover:bg-brand-soft hover:text-ink"
          >
            <Icon name={ACTION_ICON.clear} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
