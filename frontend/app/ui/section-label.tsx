import type { ReactNode } from "react"

import { cn } from "./cn"

type SectionLabelProps = {
  children: ReactNode
  spacing?: "none" | "top"
  trailing?: ReactNode
}

/** Uppercase micro heading used for panel sections and page eyebrows. */
export const SectionLabel = ({ children, spacing = "none", trailing }: SectionLabelProps) => (
  <div className={cn("text-fs-micro font-semibold tracking-label text-ink-soft uppercase", spacing === "top" && "mt-4")}>
    {children}
    {trailing && <span className="ml-1.5 font-normal tracking-normal normal-case">{trailing}</span>}
  </div>
)
