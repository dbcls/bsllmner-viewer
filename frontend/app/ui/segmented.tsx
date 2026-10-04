import { type KeyboardEvent, useRef } from "react"

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
 * A joined group of exclusive choices. The active one is filled with the brand color. Both sizes are 28px high, border
 * included, the same as `Button` `sm` and `Select` `sm`, and differ in the size of the text. Each label is trimmed to the
 * height of its capitals so the capitals sit in the middle. The group does not clip, so the focus ring of an option
 * shows. The two end options round their own outer corners. As a radio group, only the chosen option is a tab stop. The
 * arrow keys, Home, and End choose and focus another option.
 */
export const Segmented = <T extends string>({ ariaLabel, options, value, onChange, size = "sm" }: SegmentedProps<T>) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const chosen = options.findIndex((option) => option.value === value)
  const stop = chosen === -1 ? 0 : chosen

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const last = options.length - 1
    const at = buttons.current.findIndex((button) => button === document.activeElement)
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? (at + 1) % options.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (at - 1 + options.length) % options.length
          : event.key === "Home" ? 0
            : event.key === "End" ? last
              : -1
    const option = options[target]
    if (at === -1 || !option) return
    event.preventDefault()
    buttons.current[target]?.focus()
    if (option.value !== value) onChange(option.value)
  }

  return (
    <span
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-button border border-border-soft bg-surface select-none"
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === stop ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative inline-flex h-6.5 cursor-pointer items-center px-2.5 font-medium leading-none first:rounded-s-button last:rounded-e-button focus-visible:z-10",
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
}
