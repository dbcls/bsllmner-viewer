import type { ReactNode } from "react"

import { Button } from "./button"
import { cn } from "./cn"
import { ALERT_ICON, Icon } from "./icons"

type ErrorNoticeProps = {
  /** What went wrong, in one short sentence. */
  message: ReactNode
  /** Asks again. Without it there is nothing to try again, as when the condition itself is not valid. */
  onRetry?: () => void
  /**
   * What the button loads again, after "Try again:" in its name, so that the buttons of several notices on a screen
   * have different names.
   */
  retryName?: string
  className?: string
}

/**
 * The notice that stands where content failed to load, in the colors of `Alert`: the critical color on its edge, its
 * text, and the icon at its start. `Alert` is removed by its caller after a short time and answers an action. The notice
 * stays until the content loads. The notice is a status, not an alert, as a screen can have many of them at once. The
 * icon and the sentence stay together, and only the button moves to the next line when the space is narrow.
 */
export const ErrorNotice = ({ message, onRetry, retryName, className }: ErrorNoticeProps) => (
  <div
    role="status"
    className={cn(
      "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-button border border-critical-border bg-surface px-4 py-2.5 text-fs-body-sm text-critical-fg",
      className,
    )}
  >
    <span className="flex min-w-0 items-start gap-2">
      <Icon name={ALERT_ICON.warning} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{message}</span>
    </span>
    {onRetry && (
      <Button kind="secondary" size="xs" onClick={onRetry} {...(retryName ? { "aria-label": `Try again: ${retryName}` } : {})}>
        Try again
      </Button>
    )}
  </div>
)
