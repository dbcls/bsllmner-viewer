import { cn } from "./cn"

type SegmentedOption<T extends string> = { value: T; label: string }

type SegmentedProps<T extends string> = {
  ariaLabel: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: "sm" | "md"
}

/**
 * A joined group of exclusive choices; the active one is filled with the brand color. Both sizes are 28px high, border
 * included, as `Button` `sm` and `Select` `sm`, and differ in the size of the text. Each label is trimmed to the height of
 * its capitals so the capitals sit in the middle.
 */
export const Segmented = <T extends string>({ ariaLabel, options, value, onChange, size = "sm" }: SegmentedProps<T>) => (
  <span
    role="radiogroup"
    aria-label={ariaLabel}
    className="inline-flex overflow-hidden rounded-button border border-border-soft bg-surface select-none"
  >
    {options.map((option) => {
      const active = option.value === value
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-6.5 cursor-pointer items-center px-2.5 font-medium leading-none",
            size === "sm" ? "text-fs-label" : "text-fs-body-sm",
            active ? "bg-brand text-white" : "bg-surface text-ink-mid hover:bg-surface-subtle",
          )}
        >
          <span className="text-trim-cap">{option.label}</span>
        </button>
      )
    })}
  </span>
)
