import type { ReactNode } from "react"

import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"

type ChipProps = {
  children: ReactNode
  onRemove?: () => void
  /** What the chip holds, in words, so that its remove button is named after it ("Remove breast cancer"). */
  name?: string
  kind?: "tint" | "soft"
  size?: "sm" | "md"
}

/**
 * A removable value, used for conditions and axis terms. The height is a whole number of pixels, and the label is trimmed
 * to the height of its capitals (`text-trim-cap`), so the capitals sit in the middle of the chip. The label keeps room
 * above and below for the descenders, which its overflow would otherwise clip.
 */
export const Chip = ({ children, onRemove, name, kind = "tint", size = "md" }: ChipProps) => (
  <span
    className={cn(
      "inline-flex max-w-full items-center rounded-tag whitespace-nowrap text-ink",
      kind === "tint" ? "bg-brand-tint" : "border border-border-soft bg-brand-soft",
      size === "md" ? "h-6 pl-2 text-fs-body-sm" : "h-5 pl-1.5 text-fs-label",
      !onRemove && "pr-2",
    )}
  >
    <span className="truncate py-1 text-trim-cap">{children}</span>
    {onRemove && (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        aria-label={name ? `Remove ${name}` : "Remove"}
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

type FieldChipProps = {
  /** The name of the field that the condition is on. */
  field: string
  /** The value of the condition, such as the label of a term. */
  value: string
  onRemove: () => void
}

/**
 * A condition on a field, in two segments: the field on a tint and the value on white. In a column of these chips, the
 * field names start at one x, so that a reader sees which fields have a condition. The chip keeps to one line, and a
 * value longer than the chip ends in an ellipsis, so that every condition in the column is as tall as the others.
 *
 * The whole chip is the button that removes the condition, so that a press anywhere on it removes it. The labels are
 * trimmed to the height of their capitals (`text-trim-cap`), so that the capitals and the × sit in the middle of the
 * chip; the labels keep room above and below for the descenders, which their overflow would otherwise clip.
 */
export const FieldChip = ({ field, value, onRemove }: FieldChipProps) => (
  <button
    type="button"
    onClick={onRemove}
    aria-label={`Remove ${field}: ${value}`}
    className="flex h-6 w-full cursor-pointer items-stretch overflow-hidden rounded-tag border border-border-soft bg-surface text-left text-fs-label whitespace-nowrap text-ink"
  >
    <span className="flex shrink-0 items-center border-r border-border-soft bg-brand-soft px-1.5 font-medium text-ink-mid">
      <span className="py-1 text-trim-cap">{field}</span>
    </span>
    <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5">
      <span className="min-w-0 truncate py-1 text-trim-cap">{value}</span>
      <Icon name={ACTION_ICON.clear} size="sm" className="ml-auto text-fs-body-sm text-ink-soft" />
    </span>
  </button>
)
