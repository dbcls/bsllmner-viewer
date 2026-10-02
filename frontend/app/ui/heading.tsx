import type { ReactNode } from "react"

import { cn } from "./cn"

type PageHeadingProps = {
  children: ReactNode
}

/** The name of a page: a brand rule at the start of the line and the title in the brand color. */
export const PageHeading = ({ children }: PageHeadingProps) => (
  <h1 className="border-l-4 border-brand pl-2.5 text-fs-h1 leading-tight font-bold tracking-h1 text-brand">{children}</h1>
)

type SectionHeadingProps = {
  children: ReactNode
  aside?: ReactNode
}

/** The name of a part of a page: the brand rule beside a title in the text color. */
export const SectionHeading = ({ children, aside }: SectionHeadingProps) => (
  <div className="flex items-baseline justify-between gap-3">
    <h2 className="border-l-4 border-brand pl-2.5 text-fs-h2 leading-tight font-medium text-ink">{children}</h2>
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
