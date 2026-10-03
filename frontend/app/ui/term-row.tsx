import { Fragment } from "react"

import { cn } from "./cn"
import { Skeleton } from "./skeleton"

type TermRowProps = {
  label: string
  id: string
  /** Where the term sits in its ontology, shown only as the row's tooltip. */
  detail: string
  count: string
  field?: string
  /** The synonym that the search matched, when the label and the ID did not. */
  synonym?: string
  /** The searched text, marked where it occurs in the label and the synonym. */
  highlight?: string
  note?: string
  selected?: boolean
  onClick: () => void
  /** `lg` lines the row's content up with the `px-6` content of a dialog. */
  padding?: RowPadding
}

type RowPadding = "sm" | "lg"

const ROW_PADDING: Record<RowPadding, string> = { sm: "px-3.5", lg: "px-6" }

export type TextPart = { text: string; match: boolean }

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The parts of a text, each occurrence of the query (compared without case) being a part of its own that is marked. */
export const matchParts = (text: string, query: string): TextPart[] => {
  const needle = query.trim()
  if (!needle) return text ? [{ text, match: false }] : []
  return text
    .split(new RegExp(`(${escapeRegExp(needle)})`, "iu"))
    .map((part, index) => ({ text: part, match: index % 2 === 1 }))
    .filter((part) => part.text !== "")
}

/**
 * Marks where the search matched, in the yellow that a selected annotation gives its evidence. The mark has no padding,
 * so that a match inside a word does not split the word.
 */
const Marked = ({ text, highlight }: { text: string; highlight: string | undefined }) => (
  <>
    {matchParts(text, highlight ?? "").map((part, index) =>
      part.match ? (
        <mark key={index} className="rounded-badge border-b-2 border-selection bg-selection-mid text-ink">
          {part.text}
        </mark>
      ) : (
        <Fragment key={index}>{part.text}</Fragment>
      ),
    )}
  </>
)

/**
 * One term of a search result on one line: its field (when the search covers every field), label, the synonym that the
 * search matched, and ID, with its count at the right edge. The unit of the count is named once, by the list around the
 * rows.
 */
export const TermRow = ({ label, id, detail, count, field, synonym, highlight, note, selected, onClick, padding = "sm" }: TermRowProps) => (
  <button
    type="button"
    onClick={onClick}
    title={detail || undefined}
    className={cn(
      "flex w-full cursor-pointer items-baseline gap-2 border-b border-brand-soft py-1.5 text-left hover:bg-brand-soft",
      ROW_PADDING[padding],
      selected && "bg-brand-soft",
    )}
  >
    {field && <span className="shrink-0 rounded-tag bg-brand-tint px-1.5 text-fs-label leading-snug text-brand">{field}</span>}
    <span className="min-w-0 shrink truncate font-medium text-ink">
      <Marked text={label} highlight={highlight} />
    </span>
    {synonym && (
      <span className="min-w-0 shrink truncate text-fs-label text-ink-soft">
        <Marked text={synonym} highlight={highlight} />
      </span>
    )}
    <span className="shrink-0 font-mono text-fs-micro text-ink-soft">{id}</span>
    {note && <span className="shrink-0 text-fs-micro font-semibold text-brand">{note}</span>}
    <span className="ml-auto shrink-0 pl-2 text-right font-mono text-fs-label text-ink-mid">{count}</span>
  </button>
)

/** A term row before the search result arrives, as tall as a `TermRow`. */
export const TermRowSkeleton = ({ padding = "sm" }: { padding?: RowPadding }) => (
  <div aria-hidden="true" className={cn("flex items-baseline gap-2 border-b border-brand-soft py-1.5", ROW_PADDING[padding])}>
    <span className="min-w-0 flex-1">
      <Skeleton className="w-48" />
    </span>
    <span className="shrink-0 text-fs-label">
      <Skeleton className="w-12" />
    </span>
  </div>
)
