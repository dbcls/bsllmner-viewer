import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"

type CardProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
  children: ReactNode
  padding?: "none" | "sm" | "md"
  flush?: boolean
}

export const Card = ({ children, padding = "md", flush, ...rest }: CardProps) => (
  <div
    {...rest}
    className={cn(
      "rounded-card border border-border-soft bg-surface shadow-card",
      padding === "md" && "px-4 py-3.5",
      padding === "sm" && "px-3.5 py-3",
      flush && "overflow-hidden",
    )}
  >
    {children}
  </div>
)
