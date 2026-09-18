type ToastProps = {
  message: string | null
}

/** A transient message at the bottom of the viewport. */
export const Toast = ({ message }: ToastProps) =>
  message ? (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-tooltip -translate-x-1/2 rounded-button bg-ink px-4 py-2 text-fs-body-sm text-white shadow-modal"
    >
      {message}
    </div>
  ) : null
