import { useState } from "react"

import type { TermHit } from "~/lib/api/types"
import { fieldLabel } from "~/lib/labels"
import { Button, Chip, Modal, Segmented, Skeleton, TextArea } from "~/ui"

import { PickerSearch } from "../term-picker/term-picker"
import type { AxisElement } from "./axis-controls"
import { axisTermsText, pastedLines } from "./axis-terms"

type Way = "search" | "paste"

type AxisTermsDialogProps = {
  open: boolean
  onClose: () => void
  title: string
  dimension: string
  dimensions: { value: string; label: string }[]
  /** The annotation fields; another dimension has no terms to search. */
  fields: string[]
  /** The elements on the axis, such as the rows of a cross-tabulation or the series of a trend. */
  elements: readonly AxisElement[]
  /** The number of elements on their way, while the view loads for the first time; null once they are known. */
  pending: number | null
  /** The axis shows terms that the user chose, instead of the top terms. */
  explicit: boolean
  /** The number of top terms that an axis shows when the user chose none. */
  limit: number
  q: string | null
  /** The note on a found term that the axis has, such as "✓ in axis". */
  selectedNote: string
  onDimension: (dimension: string) => void
  /** Adds a found term to the axis, or takes it off when the axis has it. */
  onPick: (hit: TermHit) => void
  onRemove: (value: string) => void
  onReset: () => void
  /** Makes the pasted entries, in their order, the terms of the axis. */
  onReplace: (entries: string[]) => void
  /** The pasted entries are being resolved, which can outlast the dialog. */
  replacing: boolean
}

/**
 * The terms of one axis of a chart view and the ways to change them. The terms are chips at the top, and under them the user
 * either searches terms to add one at a time or pastes a list that replaces them. Both ways take the same place, so the
 * dialog keeps its height when the way changes.
 */
export const AxisTermsDialog = ({ open, onClose, title, ...rest }: AxisTermsDialogProps) => (
  <Modal open={open} onClose={onClose} title={title}>
    <AxisTerms {...rest} />
  </Modal>
)

const AxisTerms = ({
  dimension,
  dimensions,
  fields,
  elements,
  pending,
  explicit,
  limit,
  q,
  selectedNote,
  onDimension,
  onPick,
  onRemove,
  onReset,
  onReplace,
  replacing,
}: Omit<AxisTermsDialogProps, "open" | "onClose" | "title">) => {
  const [way, setWay] = useState<Way>("search")
  const [pasted, setPasted] = useState<string | null>(null)
  const values = elements.map((element) => element.value)
  // Until the user edits the list, it shows the terms on the axis now.
  const text = pasted ?? axisTermsText(values)
  const entries = pastedLines(text)
  return (
    <>
      <div className="flex items-start gap-3 px-6 pb-3">
        <div className="flex max-h-24 min-w-0 flex-1 flex-wrap gap-1 overflow-auto">
          {pending !== null && Array.from({ length: pending }, (_, index) => <Skeleton key={index} kind="block" className="h-5 w-20" />)}
          {elements.map((element) => (
            <Chip key={element.value} kind="soft" size="sm" name={element.label} onRemove={() => onRemove(element.value)}>
              {element.label}
            </Chip>
          ))}
        </div>
        {explicit && (
          <Button kind="secondary" size="xs" onClick={onReset}>
            Reset to top {limit}
          </Button>
        )}
      </div>
      <div className="px-6 pb-3">
        <Segmented<Way>
          ariaLabel="Way to set the terms"
          options={[
            { value: "search", label: "Search" },
            { value: "paste", label: "Paste list" },
          ]}
          value={way}
          onChange={setWay}
        />
      </div>
      {way === "search" ? (
        <PickerSearch
          fieldOptions={dimensions}
          field={dimension}
          onField={(next) => {
            setPasted(null)
            onDimension(next)
          }}
          fields={fields}
          q={q}
          isSelected={(hit) => values.includes(hit.termId)}
          selectedNote={selectedNote}
          onPick={onPick}
          fullHeight
        />
      ) : (
        <>
          <div className="flex h-box-md items-center justify-between gap-2 border-b border-border-soft px-6 pb-3 box-content">
            <span className="text-fs-label text-ink-soft">
              {fields.includes(dimension) ? `One ${fieldLabel(dimension)} term per line, as an ID or a label` : `One ${fieldLabel(dimension)} value per line`}
            </span>
            <Button
              size="sm"
              disabled={entries.length === 0 || replacing}
              onClick={() => {
                onReplace(entries)
                setPasted(null)
              }}
            >
              Replace terms
            </Button>
          </div>
          <div className="h-picker-list px-6 py-3">
            <TextArea fill mono value={text} onChange={setPasted} spellCheck={false} aria-label="Terms to set" />
          </div>
        </>
      )}
    </>
  )
}
