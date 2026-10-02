import { useEffect, useRef, useState } from "react"

import { useTerms } from "~/lib/api/queries"
import type { Clause, TermHit } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel } from "~/lib/labels"
import { termDetail } from "~/lib/terms"
import { ACTION_ICON, busyClass, cn, Modal, Select, TermRow, TermRowSkeleton, TextInput } from "~/ui"

export type PickerMode = "condition" | "row" | "col"

/** The field choice that searches every annotation field. */
export const ALL_FIELDS = "*"

export type PickerRequest = {
  field: string
  mode: PickerMode
}

/** The title of the picker for each place that opens it. */
const TITLE: Record<PickerMode, string> = { condition: "Add an annotation term", row: "Add row terms", col: "Add column terms" }

/** The rows that hold the place of the result before it arrives. */
const SKELETON_TERMS = 8

type TermPickerProps = {
  request: PickerRequest | null
  onClose: () => void
  fields: string[]
  dimensions: { value: string; label: string }[]
  q: string | null
  isSelected: (mode: PickerMode, field: string, hit: TermHit) => boolean
  onPick: (mode: PickerMode, field: string, hit: TermHit, clauses: Clause[]) => void
  onField: (mode: PickerMode, field: string) => void
}

/**
 * Search terms by label, synonym, or ID, in one field or in every annotation field, with counts under the current
 * condition. The counts are BioSamples without the condition on the term's own field, as in the condition panel,
 * whatever the counting unit and self-exclusion of the views.
 */
export const TermPicker = ({ request, onClose, fields, dimensions, q, isSelected, onPick, onField }: TermPickerProps) => {
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
    { ...(everyField ? {} : { field }), query, q, unit: "biosample", selfExclusion: true, limit: 30 },
    request !== null && searchable,
  )
  // The results of another search start at the top, instead of where the previous results were scrolled to.
  const list = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0
  }, [terms.data?.query, terms.data?.field])
  const options =
    mode === "condition"
      ? [{ value: ALL_FIELDS, label: "All fields" }, ...fields.map((f) => ({ value: f, label: fieldLabel(f) }))]
      : dimensions
  return (
    <Modal open={request !== null} onClose={onClose} title={TITLE[mode]}>
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
        />
        {mode !== "condition" && <span className="text-fs-micro whitespace-nowrap text-ink-soft">Adds to {mode === "row" ? "rows" : "columns"} · stays open</span>}
      </div>
      <div
        ref={list}
        aria-busy={(searchable && !terms.data) || terms.isPlaceholderData || undefined}
        className={cn("max-h-picker-list overflow-auto", busyClass(terms.isPlaceholderData))}
      >
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
                {...(hit.matchedSynonym ? { synonym: hit.matchedSynonym } : {})}
                highlight={terms.data?.query ?? ""}
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
    </Modal>
  )
}
