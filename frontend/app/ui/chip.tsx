import type { ReactNode } from "react"

import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"

type ChipProps = {
  children: ReactNode
  onRemove?: () => void
  title?: string
  kind?: "tint" | "soft"
  size?: "sm" | "md"
  leading?: ReactNode
}

/**
 * A removable value, used for conditions and axis terms. The height is a whole number of pixels, and the label is trimmed
 * to the height of its capitals (`text-trim-cap`), so the capitals sit in the middle of the chip. The label keeps room
 * above and below for the descenders, which its overflow would otherwise clip.
 */
export const Chip = ({ children, onRemove, title, kind = "tint", size = "md", leading }: ChipProps) => (
  <span
    title={title}
    className={cn(
      "inline-flex max-w-full items-center rounded-tag whitespace-nowrap text-ink",
      kind === "tint" ? "bg-brand-tint" : "border border-border-soft bg-brand-soft",
      size === "md" ? "h-6 pl-2 text-fs-body-sm" : "h-5 pl-1.5 text-fs-label",
      !onRemove && "pr-2",
    )}
  >
    {leading}
    <span className="truncate py-1 text-trim-cap">{children}</span>
    {onRemove && (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        aria-label="Remove"
        title="Remove"
        className={cn(
          "flex cursor-pointer items-center self-stretch px-1.5",
          kind === "tint" ? "text-brand" : "text-ink-soft",
          size === "md" ? "text-fs-body" : "text-fs-body-sm",
        )}
      >
        <Icon name={ACTION_ICON.clear} size="sm" />
      </button>
    )}
  </span>
)
