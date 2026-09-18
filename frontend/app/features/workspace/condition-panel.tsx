import { useState } from "react"

import { useDataset, useDistribution } from "~/lib/api/queries"
import type { Clause } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel, GROUP_LABELS, organismLabel, type StatusGroup } from "~/lib/labels"
import { Button, CheckboxRow, Chip, Clickable, cn, LinkButton, SectionLabel, Select, TextInput } from "~/ui"

import { clauseLabel, clausesOfField } from "./ast"
import type { Condition } from "./use-condition"

type ConditionPanelProps = {
  q: string | null
  condition: Condition
  onAddTerm: (field: string) => void
}

const ORGANISM_NAMES: Record<string, string> = { "9606": "H. sapiens", "10090": "M. musculus" }
const ORGANISM_ORDER = ["9606", "10090"]
const organismOrder = (id: string): number => {
  const index = ORGANISM_ORDER.indexOf(id)
  return index < 0 ? ORGANISM_ORDER.length : index
}

/** The condition inputs: terms per field, assay, organism, creation year, annotation status, and text matches. */
export const ConditionPanel = ({ q, condition, onAddTerm }: ConditionPanelProps) => {
  const dataset = useDataset()
  const fields = dataset.data?.fields ?? []
  const assays = useDistribution({ field: "library_strategy", q, unit: "biosample", selfExclusion: true, limit: 20 })
  const organisms = useDistribution({ field: "organism_id", q, unit: "biosample", selfExclusion: true, limit: 2 })
  const [yearFrom, setYearFrom] = useState("2015")
  const [yearTo, setYearTo] = useState("2020")
  const [statusField, setStatusField] = useState("disease")
  const [valueField, setValueField] = useState("disease")
  const [valueText, setValueText] = useState("")
  const [titleText, setTitleText] = useState("")
  const fieldOptions = fields.map((f) => ({ value: f.name, label: fieldLabel(f.name) }))
  const targetAssays = dataset.data?.target_assays ?? []
  const assayCounts = new Map((assays.data?.elements ?? []).map((e) => [e.value, e.count]))

  const selectedFor = (field: string) => clausesOfField(condition.ast, field)

  return (
    <aside className="w-sidebar shrink-0 border-r border-border-soft bg-surface px-4 pt-3.5 pb-6 text-fs-body-sm">
      <div className="mb-1">
        <SectionLabel>Annotation terms</SectionLabel>
      </div>
      {fields.map((field) => {
        const selected = selectedFor(field.name)
        return (
          <div key={field.name} className="border-b border-brand-soft py-1.5">
            <div className="flex items-center justify-between">
              <span className={cn("font-medium", selected.length ? "text-brand" : "text-ink")}>{fieldLabel(field.name)}</span>
              <LinkButton onClick={() => onAddTerm(field.name)}>+ Add</LinkButton>
            </div>
            {selected.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {selected.map((clause) => (
                  <Chip key={clause.value} size="sm" onRemove={() => void condition.toggle([clause])} title={clause.value ?? ""}>
                    {clauseLabel(clause, condition.labels)}
                  </Chip>
                ))}
                {selected.length > 1 && <span className="text-fs-micro text-ink-soft">any of these</span>}
              </div>
            )}
          </div>
        )
      })}
      <SectionLabel spacing="top">Assay</SectionLabel>
      {targetAssays.map((assay) => {
        const clause: Clause = { field: "library_strategy", value: assay }
        return (
          <CheckboxRow
            key={assay}
            checked={condition.isSelected([clause])}
            onChange={() => void condition.toggle([clause])}
            label={assay}
            count={assayCounts.has(assay) ? formatCount(assayCounts.get(assay) ?? 0) : "…"}
          />
        )
      })}
      <SectionLabel spacing="top">Organism</SectionLabel>
      {[...(organisms.data?.elements ?? [])].sort((a, b) => organismOrder(a.value) - organismOrder(b.value)).map((element) => {
        const clause: Clause = { field: "organism_id", value: element.value }
        return (
          <CheckboxRow
            key={element.value}
            checked={condition.isSelected([clause])}
            onChange={() => void condition.toggle([clause])}
            label={organismLabel(element.value, element.label)}
            sub={ORGANISM_NAMES[element.value] ?? element.label}
            count={formatCount(element.count)}
          />
        )
      })}
      <div className="mt-4 mb-1.5">
        <SectionLabel>Created year</SectionLabel>
      </div>
      <div className="flex items-center gap-1.5">
        <TextInput value={yearFrom} onChange={setYearFrom} size="sm" mono widthClass="w-14" aria-label="From year" />
        <span className="text-ink-soft">–</span>
        <TextInput value={yearTo} onChange={setYearTo} size="sm" mono widthClass="w-14" aria-label="To year" />
        <Button
          kind="secondary"
          size="sm"
          onClick={() => {
            if (!/^\d{4}$/.test(yearFrom) || !/^\d{4}$/.test(yearTo)) return
            void condition.replaceField("date_created", { field: "date_created", from: `${yearFrom}-01-01`, to: `${yearTo}-12-31` })
          }}
        >
          Apply
        </Button>
      </div>
      <div className="mt-4 mb-1.5">
        <SectionLabel>Annotation status</SectionLabel>
      </div>
      <Select options={fieldOptions} value={statusField} onChange={setStatusField} size="sm" block aria-label="Status field" />
      <div className="mt-1.5 flex gap-1">
        {(Object.keys(GROUP_LABELS) as StatusGroup[]).map((group) => {
          const clause: Clause = { field: `${statusField}_status`, value: group }
          const on = condition.isSelected([clause])
          return (
            <Clickable
              key={group}
              onClick={() => void condition.toggle([clause])}
              className={cn(
                "flex-1 cursor-pointer rounded-button border py-1 text-fs-label",
                on ? "border-brand-light bg-brand-tint text-brand" : "border-border-soft bg-surface text-ink-mid hover:bg-brand-soft",
              )}
            >
              {GROUP_LABELS[group]}
            </Clickable>
          )
        })}
      </div>
      <div className="mt-1 text-fs-micro text-ink-soft">“No value” means the attribute was not stated — it is not a negative result.</div>
      <div className="mt-4 mb-1.5">
        <SectionLabel>Text match</SectionLabel>
      </div>
      <div className="mb-1.5 flex gap-1">
        <Select options={fieldOptions} value={valueField} onChange={setValueField} size="sm" aria-label="Value field" />
        <TextInput
          value={valueText}
          onChange={setValueText}
          size="sm"
          block
          placeholder="value contains…"
          aria-label="Extracted value contains"
          onEnter={() => {
            const text = valueText.trim()
            if (!text) return
            void condition.toggle([{ field: `${valueField}_value`, value: text }])
            setValueText("")
          }}
        />
      </div>
      <TextInput
        value={titleText}
        onChange={setTitleText}
        size="sm"
        block
        placeholder="title contains… (Enter)"
        aria-label="Title contains"
        onEnter={() => {
          const text = titleText.trim()
          if (!text) return
          void condition.toggle([{ field: "title", value: text }])
          setTitleText("")
        }}
      />
    </aside>
  )
}
