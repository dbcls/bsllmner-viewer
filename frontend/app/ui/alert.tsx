import { ALERT_ICON, Icon } from "./icons"

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
