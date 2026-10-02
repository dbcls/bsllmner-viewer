import { useEffect, useState } from "react"

import { useTerms } from "~/lib/api/queries"
import type { Clause, TermHit, Unit } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel, unitLabel } from "~/lib/labels"
import { termDetail } from "~/lib/terms"
import { ACTION_ICON, busyClass, cn, Modal, Select, TermRow, TermRowSkeleton, TextInput } from "~/ui"

export type PickerMode = "condition" | "row" | "col"

/** The field choice that searches every annotation field. */
export const ALL_FIELDS = "*"

export type PickerRequest = {
  field: string
  mode: PickerMode
}

/** The rows that hold the place of the result before it arrives. */
const SKELETON_TERMS = 8

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

/** Search terms by label, synonym, or ID, in one field or in every annotation field, with counts under the current condition. */
export const TermPicker = ({ request, onClose, fields, dimensions, q, unit, selfExclusion, isSelected, onPick, onField }: TermPickerProps) => {
  const [query, setQuery] = useState("")
  const [field, setField] = useState(request?.field ?? ALL_FIELDS)
  useEffect(() => {
    if (request) {
      setField(request.field)
      setQuery("")
    }
  }, [request])
  const mode = request?.mode ?? "condition"
  const everyField = mode === "condition" && field === ALL_FIELDS
  const searchable = everyField || fields.includes(field)
  const terms = useTerms(
    { ...(everyField ? {} : { field }), query, q, unit, selfExclusion, limit: 30 },
    request !== null && searchable,
  )
  const options =
    mode === "condition"
      ? [{ value: ALL_FIELDS, label: "All fields" }, ...fields.map((f) => ({ value: f, label: fieldLabel(f) }))]
      : dimensions
  return (
    <Modal open={request !== null} onClose={onClose} title="Choose a term">
      <div className="flex items-center gap-2 border-b border-border-soft px-6 pb-3">
        <Select
          options={options}
          value={field}
          onChange={(value) => {
            setField(value)
            setQuery("")
            if (value !== ALL_FIELDS) onField(mode, value)
          }}
          aria-label="Field"
        />
        <TextInput
          value={query}
          onChange={setQuery}
          icon={ACTION_ICON.search}
          placeholder="Search label, synonym, or ID…"
          aria-label="Search terms"
          block
          autoFocus
        />
        <span className="text-fs-micro whitespace-nowrap text-ink-soft">
          {mode === "condition" ? "Adds to condition" : `Adds to ${mode === "row" ? "rows" : "columns"} · stays open`}
        </span>
      </div>
      <div aria-busy={(searchable && !terms.data) || terms.isPlaceholderData || undefined} className={cn("max-h-picker-list overflow-auto", busyClass(terms.isPlaceholderData))}>
        {!searchable && (
          <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">
            {fieldLabel(field)} has no terms to pick; its elements are chosen automatically.
          </div>
        )}
        {searchable && !terms.data && Array.from({ length: SKELETON_TERMS }, (_, index) => <TermRowSkeleton key={index} />)}
        {searchable &&
          (terms.data?.terms ?? []).map((hit) => {
            const selected = isSelected(mode, hit.field, hit)
            return (
              <TermRow
                key={`${hit.field}:${hit.termId}`}
                label={hit.label ?? hit.termId}
                id={hit.termId}
                detail={termDetail(hit)}
                count={formatCount(hit.count)}
                {...(everyField ? { field: fieldLabel(hit.field) } : {})}
                {...(selected ? { note: mode === "condition" ? "✓ in condition" : "✓ in axis" } : {})}
                selected={selected}
                onClick={() => onPick(mode, hit.field, hit, hit.clauses)}
              />
            )
          })}
        {searchable && terms.data && terms.data.terms.length === 0 && (
          <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">
            No matching term. Try a synonym, or search the word as a keyword instead.
          </div>
        )}
      </div>
      <div className="border-t border-border-soft px-6 py-2 text-fs-micro text-ink-soft">
        {unit !== "biosample" && `Counts are ${unitLabel(unit)}. `}Each count excludes the condition on the term's own field. A term
        condition also matches its descendant terms.
      </div>
    </Modal>
  )
}
