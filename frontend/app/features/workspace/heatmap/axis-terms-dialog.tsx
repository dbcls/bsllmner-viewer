import { useState } from "react"

import type { Element, TermElement, TermHit } from "~/lib/api/types"
import { fieldLabel } from "~/lib/labels"
import { Button, Chip, Modal, Segmented, Skeleton, TextArea } from "~/ui"

import { PickerSearch } from "../term-picker/term-picker"
import type { AxisSide } from "./axis-controls"
import { axisTermsText, pastedLines } from "./axis-terms"

type Way = "search" | "paste"

type AxisTermsDialogProps = {
  /** The axis whose terms the dialog shows, or null while it is closed. */
  side: AxisSide | null
  onClose: () => void
  dimension: string
  dimensions: { value: string; label: string }[]
  /** The annotation fields; another dimension has no terms to search. */
  fields: string[]
  elements: (Element | TermElement)[]
  /** The number of elements on their way, while the cross-tabulation loads for the first time; null once they are known. */
  pending: number | null
  /** The axis shows terms that the user chose, instead of the top terms. */
  explicit: boolean
  /** The number of top terms that an axis shows when the user chose none. */
  limit: number
  q: string | null
  onDimension: (dimension: string) => void
  /** Adds a found term to the axis, or takes it off when the axis has it. */
  onPick: (hit: TermHit) => void
  onRemove: (value: string) => void
  onReset: () => void
  /** Makes the pasted entries, in their order, the terms of the axis. */
  onReplace: (entries: string[]) => void
}

/**
 * The terms of one heatmap axis and the ways to change them. The terms are chips at the top, and under them the user
 * either searches terms to add one at a time or pastes a list that replaces them. Both ways take the same place, so the
 * dialog keeps its height when the way changes.
 */
export const AxisTermsDialog = ({ side, onClose, ...rest }: AxisTermsDialogProps) => (
  <Modal open={side !== null} onClose={onClose} title={side === "col" ? "Column terms" : "Row terms"}>
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
  onDimension,
  onPick,
  onRemove,
  onReset,
  onReplace,
}: Omit<AxisTermsDialogProps, "side" | "onClose">) => {
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
            <Chip key={element.value} kind="soft" size="sm" title={element.value} onRemove={() => onRemove(element.value)}>
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
          selectedNote="✓ in axis"
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
              disabled={entries.length === 0}
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
