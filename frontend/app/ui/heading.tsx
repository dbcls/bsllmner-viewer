import type { ReactNode } from "react"

type PageHeadingProps = {
  children: ReactNode
}

/**
 * The name of a page: a brand rule and the title in the text color. The rule sits on the left edge of the `padding="lg"`
 * card the heading names, through the card's padding, and keeps the title in line with the card's content.
 */
export const PageHeading = ({ children }: PageHeadingProps) => (
  <h1 className="-ml-6 border-l-4 border-brand pl-5 text-fs-h1 leading-tight font-bold tracking-h1 text-ink">{children}</h1>
)

type SectionHeadingProps = {
  children: ReactNode
}

/** The name of a part of a page: the brand rule beside a title in the text color. */
export const SectionHeading = ({ children }: SectionHeadingProps) => (
  <h2 className="border-l-4 border-brand pl-2.5 text-fs-h2 leading-tight font-medium text-ink">{children}</h2>
)

type PaneHeadingProps = {
  children: ReactNode
  /** A control at the right end of the line, such as a help button. */
  aside?: ReactNode
}

/** The name of a group in a side pane, at the size of the pane's own text, over a line that spans the pane. */
export const PaneHeading = ({ children, aside }: PaneHeadingProps) => (
  <div className="mt-5 mb-1.5 flex items-center justify-between gap-2 border-b border-border-soft pb-1">
    <h2 className="border-l-4 border-brand pl-2 text-fs-body leading-tight font-bold text-ink">{children}</h2>
    {aside}
  </div>
)

type CaptionProps = {
  children: ReactNode
}

/** A short label over or beside the value it names. */
export const Caption = ({ children }: CaptionProps) => <span className="text-fs-label font-medium text-ink-soft">{children}</span>
