import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"

type CardProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
  children: ReactNode
  /** `lg` is for a card that holds a whole part of a page; a heading in it can put its rule on the card's edge (`rule="edge"`). */
  padding?: "none" | "sm" | "md" | "lg"
  flush?: boolean
}

export const Card = ({ children, padding = "md", flush, ...rest }: CardProps) => (
  <div
    {...rest}
    className={cn(
      "rounded-card border border-border-soft bg-surface shadow-card",
      padding === "lg" && "p-6",
      padding === "md" && "px-4 py-3.5",
      padding === "sm" && "px-3.5 py-3",
      flush && "overflow-hidden",
    )}
  >
    {children}
  </div>
)

type CardEdgeProps = {
  children: ReactNode
}

const CARD_EDGE = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-fs-label text-ink-soft"

/** Controls and counts over the content of a `padding="none"` card, set off from it by a line. */
export const CardHeader = ({ children }: CardEdgeProps) => <div className={cn(CARD_EDGE, "border-b border-border-soft")}>{children}</div>

/** Legends, notes, and paging under the content of a `padding="none"` card, set off from it by a line. */
export const CardFooter = ({ children }: CardEdgeProps) => <div className={cn(CARD_EDGE, "border-t border-border-soft")}>{children}</div>
