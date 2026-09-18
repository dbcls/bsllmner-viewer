import type { ReactNode } from "react"

import { cn } from "./cn"

type TagProps = {
  children: ReactNode
  kind?: "neutral" | "warn" | "brand"
  mono?: boolean
  title?: string
}

/** A small inline label: assays in tables, notes such as "Not filtered by Disease". */
export const Tag = ({ children, kind = "neutral", mono, title }: TagProps) => (
  <span
    title={title}
    className={cn(
      "inline-block rounded-tag px-1.5 text-fs-label leading-snug whitespace-nowrap",
      kind === "neutral" && "border border-border-soft bg-brand-soft text-ink",
      kind === "warn" && "bg-warn-bg text-warn-fg",
      kind === "brand" && "bg-brand-tint text-brand font-bold tracking-tag",
      mono && "font-mono",
    )}
  >
    {children}
  </span>
)
