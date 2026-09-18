import type { ReactNode } from "react"

import { cn } from "./cn"

type ChipProps = {
  children: ReactNode
  onRemove?: () => void
  title?: string
  kind?: "tint" | "soft"
  size?: "sm" | "md"
  leading?: ReactNode
}

/** A removable value, used for conditions and axis terms. */
export const Chip = ({ children, onRemove, title, kind = "tint", size = "md", leading }: ChipProps) => (
  <span
    title={title}
    className={cn(
      "inline-flex max-w-full items-center rounded-tag whitespace-nowrap text-ink",
      kind === "tint" ? "bg-brand-tint" : "border border-border-soft bg-brand-soft",
      size === "md" ? "py-0.5 pl-2 text-fs-body-sm" : "py-px pl-1.5 text-fs-label",
      !onRemove && "pr-2",
    )}
  >
    {leading}
    <span className="truncate">{children}</span>
    {onRemove && (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        aria-label="Remove"
        title="Remove"
        className={cn("cursor-pointer px-1.5 leading-none", kind === "tint" ? "text-brand" : "text-ink-soft", size === "md" ? "text-fs-body" : "text-fs-body-sm")}
      >
        ×
      </button>
    )}
  </span>
)
