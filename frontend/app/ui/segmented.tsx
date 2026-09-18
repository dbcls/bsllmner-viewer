import { cn } from "./cn"

type SegmentedOption<T extends string> = { value: T; label: string }

type SegmentedProps<T extends string> = {
  ariaLabel: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: "sm" | "md"
}

/** A joined group of exclusive choices; the active one is filled with the brand color. */
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
            "cursor-pointer font-medium leading-none",
            size === "sm" ? "px-2.5 py-1.5 text-fs-label" : "px-2.5 py-1.5 text-fs-body-sm",
            active ? "bg-brand text-white" : "bg-surface text-ink-mid hover:bg-surface-subtle",
          )}
        >
          {option.label}
        </button>
      )
    })}
  </span>
)
