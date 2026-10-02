import type { ReactNode } from "react"

import { cn } from "./cn"

/**
 * Where the brand rule of a heading sits. `start` puts it at the start of the line. `edge` puts it on the left edge of
 * the `padding="lg"` card the heading names, through the card's padding, and keeps the title in line with the card's content.
 */
type HeadingRule = "start" | "edge"

const RULE: Record<HeadingRule, string> = {
  start: "pl-2.5",
  edge: "-ml-6 pl-5",
}

type PageHeadingProps = {
  children: ReactNode
  rule?: HeadingRule
}

/** The name of a page: a brand rule at the start of the line and the title in the text color. */
export const PageHeading = ({ children, rule = "start" }: PageHeadingProps) => (
  <h1 className={cn("border-l-4 border-brand text-fs-h1 leading-tight font-bold tracking-h1 text-ink", RULE[rule])}>{children}</h1>
)

type SectionHeadingProps = {
  children: ReactNode
  aside?: ReactNode
  rule?: HeadingRule
}

/** The name of a part of a page: the brand rule beside a title in the text color. */
export const SectionHeading = ({ children, aside, rule = "start" }: SectionHeadingProps) => (
  <div className="flex items-baseline justify-between gap-3">
    <h2 className={cn("border-l-4 border-brand text-fs-h2 leading-tight font-medium text-ink", RULE[rule])}>{children}</h2>
    {aside}
  </div>
)

type PaneHeadingProps = {
  children: ReactNode
  spacing?: "none" | "top"
}

/** The name of a group in a side pane, at the size of the pane's own text, over a line that spans the pane. */
export const PaneHeading = ({ children, spacing = "none" }: PaneHeadingProps) => (
  <div className={cn("mb-1.5 border-b border-border-soft pb-1", spacing === "top" && "mt-5")}>
    <h2 className="border-l-4 border-brand pl-2 text-fs-body leading-tight font-bold text-brand">{children}</h2>
  </div>
)

type CaptionProps = {
  children: ReactNode
}

/** A short label over or beside the value it names. */
export const Caption = ({ children }: CaptionProps) => <span className="text-fs-label font-medium text-ink-soft">{children}</span>
