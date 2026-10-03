import { useEffect, useRef, useState } from "react"

import { useTerms } from "~/lib/api/queries"
import type { TermHit } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel } from "~/lib/labels"
import { ACTION_ICON, busyClass, cn, Modal, Select, TermRow, TermRowSkeleton, TextInput } from "~/ui"

/** The field choice that searches every annotation field. */
export const ALL_FIELDS = "*"

/** The rows that hold the place of the result before it arrives. */
const SKELETON_TERMS = 8

type PickerSearchProps = {
  /** The choices of the field Select, which may include `ALL_FIELDS`. */
  fieldOptions: { value: string; label: string }[]
  field: string
  onField: (field: string) => void
  /** The annotation fields; a field outside them has no terms to search. */
  fields: string[]
  q: string | null
  isSelected: (hit: TermHit) => boolean
  /** The mark after a term that `isSelected` holds, such as "✓ in condition". */
  selectedNote: string
  onPick: (hit: TermHit) => void
  /** The list keeps its full height whatever the number of terms, so that a pane switched into its place keeps the dialog's height. */
  fullHeight?: boolean
}

/**
 * Search terms by label, synonym, or ID, in one field or in every annotation field, with counts under the current
 * condition. The counts are BioSamples without the condition on the term's own field, as in the condition panel,
 * whatever the counting unit and self-exclusion of the views. It lives in a dialog and searches while it is drawn.
 */
export const PickerSearch = ({ fieldOptions, field, onField, fields, q, isSelected, selectedNote, onPick, fullHeight }: PickerSearchProps) => {
  const [query, setQuery] = useState("")
  const everyField = field === ALL_FIELDS
  const searchable = everyField || fields.includes(field)
  const terms = useTerms({ ...(everyField ? {} : { field }), query, q, unit: "biosample", selfExclusion: true, limit: 30 }, searchable)
  // The results of another search start at the top, instead of where the previous results were scrolled to.
  const list = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0
  }, [terms.data?.query, terms.data?.field])
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-soft px-6 pb-3">
        <Select
          options={fieldOptions}
          value={field}
          onChange={(value) => {
            setQuery("")
            onField(value)
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
      </div>
      <div
        ref={list}
        aria-busy={(searchable && !terms.data) || terms.isPlaceholderData || undefined}
        className={cn(fullHeight ? "h-picker-list" : "max-h-picker-list", "overflow-auto", busyClass(terms.isPlaceholderData))}
      >
        {!searchable && (
          <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">
            {fieldLabel(field)} has no terms to pick; its elements are chosen automatically.
          </div>
        )}
        {searchable && !terms.data && Array.from({ length: SKELETON_TERMS }, (_, index) => <TermRowSkeleton key={index} padding="lg" />)}
        {searchable &&
          (terms.data?.terms ?? []).map((hit) => {
            const selected = isSelected(hit)
            return (
              <TermRow
                key={`${hit.field}:${hit.termId}`}
                label={hit.label ?? hit.termId}
                id={hit.termId}
                count={formatCount(hit.count)}
                {...(everyField ? { field: fieldLabel(hit.field) } : {})}
                {...(hit.matchedSynonym ? { synonym: hit.matchedSynonym } : {})}
                highlight={terms.data?.query ?? ""}
                {...(selected ? { note: selectedNote } : {})}
                selected={selected}
                onClick={() => onPick(hit)}
                padding="lg"
              />
            )
          })}
        {searchable && terms.data && terms.data.terms.length === 0 && (
          <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">
            No matching term. Try a synonym, or search the word as a keyword instead.
          </div>
        )}
      </div>
    </>
  )
}

type TermPickerProps = {
  open: boolean
  onClose: () => void
  fields: string[]
  q: string | null
  isSelected: (hit: TermHit) => boolean
  onPick: (hit: TermHit) => void
}

/** The dialog that adds an annotation term to the condition, searching every field until a field is chosen. */
export const TermPicker = ({ open, onClose, fields, q, isSelected, onPick }: TermPickerProps) => {
  const [field, setField] = useState(ALL_FIELDS)
  useEffect(() => {
    if (open) setField(ALL_FIELDS)
  }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Add an annotation term">
      <PickerSearch
        fieldOptions={[{ value: ALL_FIELDS, label: "All fields" }, ...fields.map((f) => ({ value: f, label: fieldLabel(f) }))]}
        field={field}
        onField={setField}
        fields={fields}
        q={q}
        isSelected={isSelected}
        selectedNote="✓ in condition"
        onPick={onPick}
      />
    </Modal>
  )
}
