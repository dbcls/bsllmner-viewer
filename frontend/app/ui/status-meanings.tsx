import { Children, type ReactNode } from "react"

import { cn } from "./cn"
import { type StatusMarkShape, StatusPill, type StatusToneName } from "./status-glyph"

export type StatusMeaning = {
  code: string
  label: string
  meaning: string
  mark: StatusMarkShape
  tone: StatusToneName
}

type StatusMeaningsProps = {
  statuses: readonly StatusMeaning[]
  /** The sentences after the statuses, each on its own line. */
  children?: ReactNode
}

/** The marks of annotation statuses, each with its name and what it says, then the closing sentences. */
export const StatusMeanings = ({ statuses, children }: StatusMeaningsProps) => (
  <>
    {statuses.map((status, index) => (
      <span key={status.code} className={cn("block", index > 0 && "mt-1.5")}>
        <StatusPill mark={status.mark} tone={status.tone} label={status.label} size="sm" /> {status.meaning}
      </span>
    ))}
    {Children.toArray(children).map((sentence, index) => (
      <span key={index} className="mt-1.5 block">
        {sentence}
      </span>
    ))}
  </>
)
