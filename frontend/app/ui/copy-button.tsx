import { type ReactNode, useEffect, useRef, useState } from "react"

import { buttonClass } from "./button"
import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"

/** How long a copy button says it copied before it shows its own label again. */
export const COPIED_MS = 2500

type CopyButtonProps = {
  /** Writes to the clipboard and tells whether it succeeded. On failure the button keeps its label. */
  onCopy: () => Promise<boolean>
  children: ReactNode
  /** `inverse` is for a button on a dark code block. */
  kind?: "secondary" | "inverse"
  size?: "xs" | "sm"
  /** Fills the width of its container and starts its content at the left, for buttons stacked in a column. */
  block?: boolean
}

const LAYER = "col-start-1 row-start-1 inline-flex items-center gap-1.5 transition duration-200 ease-out"

/**
 * A button that copies, then says "Copied!" with a check mark for `COPIED_MS`. Both labels share one grid cell, so the
 * button keeps the width of the wider one and the controls beside it do not move.
 */
export const CopyButton = ({ onCopy, children, kind = "secondary", size = "sm", block = false }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    if (!(await onCopy())) return
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  const layer = cn(LAYER, block ? "justify-start" : "justify-center")
  return (
    <>
      <button type="button" onClick={() => void copy()} className={buttonClass(kind, size, block)}>
        <span className="grid">
          <span aria-hidden={copied || undefined} className={cn(layer, copied ? "-translate-y-1 opacity-0" : "opacity-100")}>
            <Icon name={ACTION_ICON.copy} />
            <span className="text-trim-cap">{children}</span>
          </span>
          <span aria-hidden={!copied || undefined} className={cn(layer, copied ? "opacity-100" : "translate-y-1 opacity-0")}>
            <Icon name={ACTION_ICON.copied} />
            <span className="text-trim-cap">Copied!</span>
          </span>
        </span>
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  )
}
