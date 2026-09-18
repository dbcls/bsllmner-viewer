import { useEffect, useState } from "react"

import { useTerms } from "~/lib/api/queries"
import type { Clause, TermHit, Unit } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel, ontologyLabel, unitLabel } from "~/lib/labels"
import { Clickable, cn, LinkButton, Modal, Select, TextInput } from "~/ui"

export type PickerMode = "condition" | "row" | "col"

const PATH_STEPS = 3

/** The nearest ancestors of a term, with an ellipsis for the ones above. */
const shortPath = (path: string[]): string =>
  path.length > PATH_STEPS ? `… › ${path.slice(-PATH_STEPS).join(" › ")}` : path.join(" › ")

export type PickerRequest = {
  field: string
  mode: PickerMode
}

type TermPickerProps = {
  request: PickerRequest | null
  onClose: () => void
  fields: string[]
  dimensions: { value: string; label: string }[]
  q: string | null
  unit: Unit
  selfExclusion: boolean
  isSelected: (mode: PickerMode, field: string, hit: TermHit) => boolean
  onPick: (mode: PickerMode, field: string, hit: TermHit, clauses: Clause[]) => void
  onField: (mode: PickerMode, field: string) => void
}

/** Search a field's terms by label, synonym, or ID, with counts under the current condition. */
export const TermPicker = ({ request, onClose, fields, dimensions, q, unit, selfExclusion, isSelected, onPick, onField }: TermPickerProps) => {
  const [query, setQuery] = useState("")
  const [field, setField] = useState(request?.field ?? "disease")
  useEffect(() => {
    if (request) {
      setField(request.field)
      setQuery("")
    }
  }, [request])
  const termField = fields.includes(field) ? field : null
  const terms = useTerms({ field: termField ?? "", query, q, unit, selfExclusion, limit: 30 }, request !== null && termField !== null)
  const mode = request?.mode ?? "condition"
  const options = mode === "condition" ? fields.map((f) => ({ value: f, label: fieldLabel(f) })) : dimensions
  return (
    <Modal open={request !== null} onClose={onClose} label="Choose a term">
      <div className="flex items-center gap-2 border-b border-border-soft px-3.5 py-3">
        <Select
          options={options}
          value={field}
          onChange={(value) => {
            setField(value)
            setQuery("")
            onField(mode, value)
          }}
          aria-label="Field"
        />
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Search label, synonym, or ID…"
          aria-label="Search terms"
          block
          autoFocus
        />
        <span className="text-fs-micro whitespace-nowrap text-ink-soft">
          {mode === "condition" ? "Adds to condition" : `Adds to ${mode === "row" ? "rows" : "columns"} · stays open`}
        </span>
      </div>
      <div className="max-h-picker-list overflow-auto">
        {termField === null && (
          <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">
            {fieldLabel(field)} has no terms to pick; its elements are chosen automatically.
          </div>
        )}
        {(terms.data?.terms ?? []).map((hit) => {
          const selected = termField !== null && isSelected(mode, termField, hit)
          return (
            <Clickable
              key={hit.term_id}
              onClick={() => termField && onPick(mode, termField, hit, hit.clauses)}
              className={cn(
                "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_100px] gap-3 border-b border-brand-soft px-3.5 py-2 text-left hover:bg-brand-soft",
                selected && "bg-brand-soft",
              )}
            >
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium text-ink">{hit.label ?? hit.term_id}</span>
                  <span className="font-mono text-fs-micro text-ink-soft">{hit.term_id}</span>
                  {selected && <span className="text-fs-micro font-semibold text-brand">✓ {mode === "condition" ? "in condition" : "in axis"}</span>}
                </span>
                <span className="mt-0.5 block text-fs-micro text-ink-soft">
                  {ontologyLabel(hit.ontology)} · {hit.path.length ? `${shortPath(hit.path)} › ${hit.label ?? hit.term_id}` : "top-level term"}
                  {hit.n_descendants > 0 && ` · includes ${formatCount(hit.n_descendants)} descendant terms`}
                </span>
              </span>
              <span className="text-right font-mono text-fs-label text-ink-mid">
                {formatCount(hit.count)}
                <span className="block font-sans text-fs-badge text-ink-soft">{unitLabel(unit)}</span>
              </span>
            </Clickable>
          )
        })}
        {terms.data && terms.data.terms.length === 0 && (
          <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">
            No matching term. Try a synonym, or search the extracted value with “value contains” instead.
          </div>
        )}
      </div>
      <div className="flex justify-between border-t border-border-soft px-3.5 py-2 text-fs-micro text-ink-soft">
        <span>Counts exclude this field's own condition. A term condition also matches its descendant terms.</span>
        <LinkButton onClick={onClose}>Close (Esc)</LinkButton>
      </div>
    </Modal>
  )
}
