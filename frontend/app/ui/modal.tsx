import { type ReactNode, useEffect } from "react"

import { cn } from "./cn"
import { SectionHeading } from "./heading"
import { ACTION_ICON, Icon } from "./icons"

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
 * An overlay dialog closed by Escape, by its close button, or by clicking the backdrop. The title is a section heading
 * with its brand rule before the text; the content under it supplies its own `px-6` padding.
 */
export const Modal = ({ open, onClose, title, description, children, width = "md", align = "top" }: ModalProps) => {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-modal flex justify-center bg-overlay",
        align === "top" ? "items-start pt-20" : "items-center",
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "overflow-hidden rounded-card bg-surface shadow-modal",
          width === "md" ? "w-modal" : "w-modal-wide",
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <SectionHeading>{title}</SectionHeading>
            {description && <p className="mt-1.5 text-fs-body-sm text-ink-soft">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
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
