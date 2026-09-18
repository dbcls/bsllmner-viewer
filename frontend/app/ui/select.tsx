import type { SelectHTMLAttributes } from "react"

import { cn } from "./cn"

type SelectOption = { value: string; label: string }

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "onChange" | "value" | "size"> & {
  options: readonly SelectOption[]
  value: string
  onChange: (value: string) => void
  size?: "sm" | "md"
  block?: boolean
  placeholder?: string
}

export const Select = ({ options, value, onChange, size = "md", block, placeholder, ...rest }: SelectProps) => (
  <select
    {...rest}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className={cn(
      "rounded-button border border-border-soft bg-surface text-ink",
      size === "sm" ? "px-1.5 py-1 text-fs-label" : "px-1.5 py-1 text-fs-body-sm font-medium",
      block && "w-full",
    )}
  >
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
)
