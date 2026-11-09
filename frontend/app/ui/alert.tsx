import { useCallback, useEffect, useRef, useState } from "react"

import { ALERT_ICON, Icon } from "./icons"

/**
 * How long an alert stays. It is at the top of the viewport, away from the control that raised it, so it stays long
 * enough to be found there.
 */
export const ALERT_MS = 4000

/**
 * The message of the alert of a page, and the function that shows a message for `ALERT_MS`. A new message replaces the
 * shown one and stays for the whole time.
 */
export const useAlert = (): [string | null, (message: string) => void] => {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const show = useCallback((next: string) => {
    setMessage(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), ALERT_MS)
  }, [])

  return [message, show]
}

type AlertProps = {
  message: string | null
}

/**
 * A warning at the top center of the viewport. The caller removes the warning by passing null as the message. The
 * warning is drawn over the dialogs, as the action that it answers can be in one: white with the critical color on its
 * edge, its text, and the icon at its start.
 */
export const Alert = ({ message }: AlertProps) =>
  message ? (
    <div
      role="alert"
      className="fixed top-4 left-1/2 z-tooltip flex -translate-x-1/2 items-center gap-2 rounded-button border border-critical-border bg-surface px-4 py-2.5 text-fs-body-sm text-critical-fg shadow-card-hover"
    >
      <Icon name={ALERT_ICON.warning} />
      <span>{message}</span>
    </div>
  ) : null
