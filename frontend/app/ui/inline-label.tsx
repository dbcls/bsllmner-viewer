import type { ReactNode } from "react"

type InlineLabelProps = {
  children: ReactNode
}

/**
 * The name of the control or the legend that follows it in the same row, such as `Status:` before the status legend or
 * `Rows:` before the choice of the row unit. The label writes the colon itself, so every such name ends the same way.
 */
export const InlineLabel = ({ children }: InlineLabelProps) => <span className="font-semibold whitespace-nowrap text-ink-mid">{children}:</span>
