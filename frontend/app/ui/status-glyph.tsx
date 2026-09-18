import { cn } from "./cn"

type StatusGlyphProps = {
  status: string
  glyph: string
  label: string
  /** Larger glyph for the status pill on the detail page. */
  size?: "sm" | "md"
}

const colorClass: Record<string, string> = {
  mapped_exact: "text-brand",
  mapped_selected: "text-brand-mid",
  unmapped_no_candidate: "text-warn-fg",
  unmapped_rejected: "text-warn-fg",
  not_stated: "text-ink-soft",
  extraction_failed: "text-critical-fg",
}

/** The glyph of an annotation status, colored by status and named for assistive technology. */
export const StatusGlyph = ({ status, glyph, label, size = "sm" }: StatusGlyphProps) => (
  <span
    role="img"
    aria-label={label}
    className={cn("inline-block leading-none", size === "sm" ? "text-fs-micro" : "text-fs-label", colorClass[status] ?? "text-ink-soft")}
  >
    {glyph}
  </span>
)

const pillClass: Record<string, string> = {
  mapped_exact: "bg-brand-tint text-brand",
  mapped_selected: "bg-brand-tint text-brand",
  unmapped_no_candidate: "bg-warn-bg text-warn-fg",
  unmapped_rejected: "bg-warn-bg text-warn-fg",
  not_stated: "bg-brand-soft text-ink-soft",
  extraction_failed: "bg-critical-bg text-critical-fg",
}

export const StatusPill = ({ status, glyph, label }: StatusGlyphProps) => (
  <span className={cn("inline-flex items-center gap-1.5 rounded-tag px-2 py-0.5 text-fs-label", pillClass[status] ?? "bg-brand-soft text-ink-soft")}>
    <span aria-hidden="true">{glyph}</span>
    {label}
  </span>
)
