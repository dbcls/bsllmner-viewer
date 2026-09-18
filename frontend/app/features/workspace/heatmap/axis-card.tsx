import { useState } from "react"

import type { Element, TermElement } from "~/lib/api/types"
import { fieldLabel } from "~/lib/labels"
import { Button, Card, Chip, Clickable, LinkButton, Select, TextArea } from "~/ui"

export type AxisSide = "row" | "col"

type AxisCardProps = {
  side: AxisSide
  dimension: string
  dimensions: { value: string; label: string }[]
  elements: (Element | TermElement)[]
  explicit: boolean
  expanded: Set<string>
  depthOf: (value: string) => number
  onDimension: (dimension: string) => void
  onAdd: () => void
  onPaste: (lines: string[]) => void
  onReset: () => void
  onRemove: (value: string) => void
  onToggleExpand: (value: string) => void
}

/** One axis of the heatmap: its dimension and the elements shown, editable as chips. */
export const AxisCard = ({
  side,
  dimension,
  dimensions,
  elements,
  explicit,
  expanded,
  depthOf,
  onDimension,
  onAdd,
  onPaste,
  onReset,
  onRemove,
  onToggleExpand,
}: AxisCardProps) => {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  return (
    <Card padding="sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-fs-micro font-semibold tracking-label text-ink-soft uppercase">{side === "row" ? "Rows" : "Columns"}</span>
        <Select options={dimensions} value={dimension} onChange={onDimension} aria-label={`${side === "row" ? "Row" : "Column"} dimension`} />
        <span className="text-fs-label text-ink-soft">
          {elements.length} {elements.length === 1 ? "term" : "terms"}
          {!explicit && " (top 10)"}
        </span>
        <span className="flex-1" />
        <LinkButton onClick={onAdd}>+ Add term</LinkButton>
        <LinkButton onClick={() => setPasteOpen((open) => !open)}>Paste list</LinkButton>
        <LinkButton tone="soft" onClick={onReset}>
          Top 10
        </LinkButton>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {elements.map((element) => (
          <span key={element.value} style={{ marginLeft: depthOf(element.value) * 12 }}>
            <Chip
              kind="soft"
              size="sm"
              title={element.value}
              onRemove={() => onRemove(element.value)}
              leading={
                "has_children" in element && (element.has_children || expanded.has(element.value)) ? (
                  <Clickable
                    onClick={() => onToggleExpand(element.value)}
                    aria-label={expanded.has(element.value) ? "Collapse child terms" : "Expand child terms"}
                    className="mr-1 cursor-pointer text-fs-micro text-ink-soft"
                  >
                    {expanded.has(element.value) ? "▾" : "▸"}
                  </Clickable>
                ) : undefined
              }
            >
              {element.label}
            </Chip>
          </span>
        ))}
      </div>
      {pasteOpen && (
        <div className="mt-2 flex items-start gap-1.5">
          <TextArea
            value={pasteText}
            onChange={setPasteText}
            rows={3}
            mono
            placeholder={`One term per line — label or ID, e.g. MONDO:0007254 (${fieldLabel(dimension)})`}
            aria-label="Terms to set"
          />
          <Button
            size="sm"
            onClick={() => {
              const lines = pasteText
                .split(/[\n,;]/)
                .map((s) => s.trim())
                .filter(Boolean)
              onPaste(lines)
              setPasteOpen(false)
              setPasteText("")
            }}
          >
            Set
          </Button>
        </div>
      )}
    </Card>
  )
}
