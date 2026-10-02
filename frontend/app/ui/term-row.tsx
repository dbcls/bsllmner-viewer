import { cn } from "./cn"

type TermRowProps = {
  label: string
  id: string
  detail: string
  count: string
  unit: string
  field?: string
  note?: string
  selected?: boolean
  onClick: () => void
}

/** One term of a search result: its label, ID, and place in the ontology, with its count at the right edge. */
export const TermRow = ({ label, id, detail, count, unit, field, note, selected, onClick }: TermRowProps) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_100px] gap-3 border-b border-brand-soft px-3.5 py-2 text-left hover:bg-brand-soft",
      selected && "bg-brand-soft",
    )}
  >
    <span className="min-w-0">
      <span className="flex items-baseline gap-2">
        {field && <span className="shrink-0 rounded-tag bg-brand-tint px-1.5 text-fs-label leading-snug text-brand">{field}</span>}
        <span className="truncate font-medium text-ink">{label}</span>
        <span className="shrink-0 font-mono text-fs-micro text-ink-soft">{id}</span>
        {note && <span className="shrink-0 text-fs-micro font-semibold text-brand">{note}</span>}
      </span>
      <span className="mt-0.5 block text-fs-micro text-ink-soft">{detail}</span>
    </span>
    <span className="text-right font-mono text-fs-label text-ink-mid">
      {count}
      <span className="block font-sans text-fs-badge text-ink-soft">{unit}</span>
    </span>
  </button>
)
