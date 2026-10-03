import type { ReactNode } from "react"

import { cn } from "./cn"

/** The shape of a status mark. */
export type StatusMarkShape = "filled" | "half" | "empty" | "struck" | "dash" | "alert"

/** The color family of a status. */
export type StatusToneName = "brand" | "brand-mid" | "warn" | "muted" | "critical"

/**
 * The mark of each annotation status, drawn on one circle so that every mark has the same size whatever the font: filled
 * (exact match), half filled (selected by the LLM), empty (no candidate), struck through (rejected), a dash (not stated),
 * and an exclamation mark (extraction failed).
 */
const MARKS: Record<StatusMarkShape, ReactNode> = {
  filled: <circle cx="6" cy="6" r="5" fill="currentColor" />,
  half: (
    <>
      <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 1v10A5 5 0 0 1 6 1Z" fill="currentColor" />
    </>
  ),
  empty: <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  struck: (
    <>
      <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m3 9 6-6" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  dash: <path d="M3 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  alert: (
    <>
      <path d="M6 1.75v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy="9.75" r="1" fill="currentColor" />
    </>
  ),
}

/** The status mark at 0.9em of the text around it. */
const StatusMark = ({ mark }: { mark: StatusMarkShape }) => (
  <svg viewBox="0 0 12 12" aria-hidden="true" className="inline-block size-[0.9em] shrink-0 align-[-0.1em]">
    {MARKS[mark]}
  </svg>
)

type StatusGlyphProps = {
  mark: StatusMarkShape
  tone: StatusToneName
  label: string
  /** Larger mark for the status pill on the detail page. */
  size?: "sm" | "md"
}

const colorClass: Record<StatusToneName, string> = {
  brand: "text-brand",
  "brand-mid": "text-brand-mid",
  warn: "text-warn-fg",
  muted: "text-ink-soft",
  critical: "text-critical-fg",
}

/** The mark of an annotation status, colored by its tone and named for assistive technology. */
export const StatusGlyph = ({ mark, tone, label, size = "sm" }: StatusGlyphProps) => (
  <span role="img" aria-label={label} className={cn("inline-block leading-none", size === "sm" ? "text-fs-micro" : "text-fs-label", colorClass[tone])}>
    <StatusMark mark={mark} />
  </span>
)

const pillClass: Record<StatusToneName, string> = {
  brand: "bg-brand-tint text-brand",
  "brand-mid": "bg-brand-tint text-brand",
  warn: "bg-warn-bg text-warn-fg",
  muted: "bg-brand-soft text-ink-soft",
  critical: "bg-critical-bg text-critical-fg",
}

type StatusPillProps = Omit<StatusGlyphProps, "size"> & {
  /** `sm` is the compact pill of a legend in a row of controls. */
  size?: "sm" | "md"
}

/** An annotation status as a colored chip: its mark and its name. */
export const StatusPill = ({ mark, tone, label, size = "md" }: StatusPillProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-tag whitespace-nowrap",
      size === "md" ? "gap-1.5 px-2 py-0.5 text-fs-label" : "h-5 gap-1 px-1.5 text-fs-micro",
      pillClass[tone],
    )}
  >
    <StatusMark mark={mark} />
    {label}
  </span>
)
