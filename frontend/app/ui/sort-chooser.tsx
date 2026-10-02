import { ACTION_ICON, Icon } from "./icons"
import { Select } from "./select"

export type SortDirection = "asc" | "desc"

/** A key that a list can be sorted by, with the direction that the list takes when the key is chosen. */
export type SortKey = { value: string; label: string; direction: SortDirection }

type SortChooserProps = {
  keys: readonly SortKey[]
  value: string
  direction: SortDirection
  onChange: (key: string, direction: SortDirection) => void
}

/**
 * The order of a list: the key, and the button that reverses the direction, joined into one control. Choosing a key
 * sorts in that key's own direction (most first for a count). The button shows the order that the list runs in now and
 * names the order that it switches to.
 */
export const SortChooser = ({ keys, value, direction, onChange }: SortChooserProps) => {
  const reversed: SortDirection = direction === "asc" ? "desc" : "asc"
  const action = reversed === "asc" ? "Sort ascending" : "Sort descending"
  return (
    <span className="inline-flex items-center gap-1.5 text-fs-label text-ink-soft">
      Sort by
      <span className="inline-flex">
        <Select
          size="sm"
          attached
          options={keys}
          value={value}
          onChange={(key) => onChange(key, keys.find((option) => option.value === key)?.direction ?? direction)}
          aria-label="Sort by"
        />
        <button
          type="button"
          onClick={() => onChange(value, reversed)}
          aria-label={action}
          title={action}
          className="-ml-px inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-r-button border border-border-soft bg-surface text-ink-mid hover:bg-brand-soft"
        >
          <Icon name={direction === "asc" ? ACTION_ICON.ascendingOrder : ACTION_ICON.descendingOrder} />
        </button>
      </span>
    </span>
  )
}
