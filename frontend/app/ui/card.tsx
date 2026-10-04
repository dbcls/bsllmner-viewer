import type { ComponentProps, ReactNode } from "react"

import { cn } from "./cn"
import { busyClass } from "./skeleton"

type CardProps = Omit<ComponentProps<"div">, "className"> & {
  children: ReactNode
  /** `lg` is for a card that holds a whole part of a page. */
  padding?: "none" | "sm" | "lg"
  flush?: boolean
  /** The card shows a previous result while the next one loads (`busyClass`). */
  busy?: boolean
}

export const Card = ({ children, padding = "none", flush, busy = false, ...rest }: CardProps) => (
  <div
    {...rest}
    aria-busy={busy || undefined}
    className={cn(
      "rounded-card border border-border-soft bg-surface shadow-card",
      busyClass(busy),
      padding === "lg" && "p-6",
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

/** Controls and counts over the content of a `padding="none"` card, separated from it by a line. */
export const CardHeader = ({ children }: CardEdgeProps) => <div className={cn(CARD_EDGE, "border-b border-border-soft")}>{children}</div>

/** Legends, notes, and paging under the content of a `padding="none"` card, separated from it by a line. */
export const CardFooter = ({ children }: CardEdgeProps) => <div className={cn(CARD_EDGE, "border-t border-border-soft")}>{children}</div>
