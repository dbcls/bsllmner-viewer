import { cn } from "./cn"

type TermRowProps = {
  label: string
  id: string
  /** Where the term sits in its ontology, shown only as the row's tooltip. */
  detail: string
  count: string
  field?: string
  note?: string
  selected?: boolean
  onClick: () => void
}

/**
 * One term of a search result on one line: its field (when the search covers every field), label, and ID, with its count
 * at the right edge. The unit of the count is named once, by the list around the rows.
 */
export const TermRow = ({ label, id, detail, count, field, note, selected, onClick }: TermRowProps) => (
  <button
    type="button"
    onClick={onClick}
    title={detail || undefined}
    className={cn(
      "flex w-full cursor-pointer items-baseline gap-2 border-b border-brand-soft px-3.5 py-1.5 text-left hover:bg-brand-soft",
      selected && "bg-brand-soft",
    )}
  >
    {field && <span className="shrink-0 rounded-tag bg-brand-tint px-1.5 text-fs-label leading-snug text-brand">{field}</span>}
    <span className="min-w-0 shrink truncate font-medium text-ink">{label}</span>
    <span className="shrink-0 font-mono text-fs-micro text-ink-soft">{id}</span>
    {note && <span className="shrink-0 text-fs-micro font-semibold text-brand">{note}</span>}
    <span className="ml-auto shrink-0 pl-2 text-right font-mono text-fs-label text-ink-mid">{count}</span>
  </button>
)
