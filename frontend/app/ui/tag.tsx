import type { ReactNode } from "react"

import { cn } from "./cn"

type TagProps = {
  children: ReactNode
  /** The color class of a dot before the text, which tells apart values of one kind, such as assays. */
  dot?: string
}

/** A small inline label, such as an assay in a table or a value of an example condition. */
export const Tag = ({ children, dot }: TagProps) => (
  <span className="inline-block rounded-tag border border-border-soft bg-brand-soft px-1.5 text-fs-label leading-snug whitespace-nowrap text-ink">
    {dot && <span aria-hidden="true" className={cn("mr-1.5 inline-block size-1.75 rounded-full align-px", dot)} />}
    {children}
  </span>
)
