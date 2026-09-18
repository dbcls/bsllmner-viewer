import { type ReactNode, useEffect } from "react"

import { cn } from "./cn"

type ModalProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: "md" | "lg"
  align?: "top" | "center"
  label: string
}

/** An overlay dialog closed by Escape or by clicking the backdrop. */
export const Modal = ({ open, onClose, children, width = "md", align = "top", label }: ModalProps) => {
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
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "overflow-hidden rounded-card bg-surface shadow-modal",
          width === "md" ? "w-modal" : "w-modal-wide",
        )}
      >
        {children}
      </div>
    </div>
  )
}
