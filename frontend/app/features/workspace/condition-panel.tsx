import { useEffect, useState } from "react"

import { useDataset, useDistribution } from "~/lib/api/queries"
import type { Clause, Unit } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel, GROUP_LABELS, organismLabel, type StatusGroup } from "~/lib/labels"
import { Button, CheckboxRow, Chip, Clickable, cn, LinkButton, PaneHeading, Select, TextInput } from "~/ui"

import { clauseLabel, clausesOfField, groupLabel, selectedClauses } from "./ast"
import type { Condition } from "./use-condition"

type ConditionPanelProps = {
  q: string | null
  /** The counting unit of the views, so that the counts beside the assays and organisms are in the same unit. */
  unit: Unit
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
export const ConditionPanel = ({ q, unit, condition, onAddTerm }: ConditionPanelProps) => {
  const dataset = useDataset()
  const fields = dataset.data?.fields ?? []
  const assays = useDistribution({ field: "library_strategy", q, unit, selfExclusion: true, limit: 20 })
  const organisms = useDistribution({ field: "organism_id", q, unit, selfExclusion: true, limit: 2 })
  const selected = selectedClauses(condition.ast)
  const yearClause = selected.find((clause) => clause.field === "date_created" && clause.from !== undefined && clause.to !== undefined)
  const conditionFrom = yearClause?.from?.slice(0, 4) ?? ""
  const conditionTo = yearClause?.to?.slice(0, 4) ?? ""
  const [yearFrom, setYearFrom] = useState(conditionFrom)
  const [yearTo, setYearTo] = useState(conditionTo)
  useEffect(() => {
    setYearFrom(conditionFrom)
    setYearTo(conditionTo)
  }, [conditionFrom, conditionTo])
  const yearError = yearProblem(yearFrom, yearTo)

  const statusFields = selected.filter((clause) => clause.field.endsWith("_status")).map((clause) => clause.field.slice(0, -"_status".length))
  const firstStatusField = statusFields[0]
  const [statusField, setStatusField] = useState(firstStatusField ?? "disease")
  useEffect(() => {
    if (firstStatusField !== undefined) setStatusField((current) => (statusFields.includes(current) ? current : firstStatusField))
    // The select follows the condition only when the set of fields with a status condition changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFields.join(",")])

  const [valueField, setValueField] = useState("disease")
  const [valueText, setValueText] = useState("")
  const [titleText, setTitleText] = useState("")
  const textClauses = selected.filter((clause) => clause.field === "title" || clause.field.endsWith("_value"))
  const fieldOptions = fields.map((f) => ({ value: f.name, label: fieldLabel(f.name) }))
  const targetAssays = dataset.data?.targetAssays ?? []
  const assayCounts = new Map((assays.data?.elements ?? []).map((e) => [e.value, e.count]))

  const selectedFor = (field: string) => clausesOfField(condition.ast, field)

  return (
    <aside className="w-sidebar shrink-0 border-r border-border-soft bg-surface px-4 pt-3.5 pb-6 text-fs-body-sm">
      <PaneHeading>Annotation terms</PaneHeading>
      {fields.map((field) => {
        const terms = selectedFor(field.name)
        return (
          <div key={field.name} className="border-b border-brand-soft py-1.5">
            <div className="flex items-center justify-between">
              <span className={cn("font-medium", terms.length ? "text-brand" : "text-ink")}>{fieldLabel(field.name)}</span>
              <LinkButton onClick={() => onAddTerm(field.name)}>+ Add</LinkButton>
            </div>
            {terms.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {terms.map((clause) => (
                  <Chip key={clause.value} size="sm" onRemove={() => void condition.toggle([clause])} title={clause.value ?? ""}>
                    {clauseLabel(clause, condition.labels)}
                  </Chip>
                ))}
                {terms.length > 1 && <span className="text-fs-micro text-ink-soft">any of these</span>}
              </div>
            )}
          </div>
        )
      })}
      <PaneHeading spacing="top">Assay</PaneHeading>
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
      <PaneHeading spacing="top">Organism</PaneHeading>
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
      <PaneHeading spacing="top">Created year</PaneHeading>
      <div className="flex items-center gap-1.5">
        <TextInput value={yearFrom} onChange={setYearFrom} size="sm" mono widthClass="w-14" placeholder="from" inputMode="numeric" aria-label="From year" />
        <span className="text-ink-soft">–</span>
        <TextInput value={yearTo} onChange={setYearTo} size="sm" mono widthClass="w-14" placeholder="to" inputMode="numeric" aria-label="To year" />
        <Button
          kind="secondary"
          size="sm"
          disabled={yearError !== null || (yearFrom === conditionFrom && yearTo === conditionTo)}
          onClick={() => {
            if (yearFrom === "" && yearTo === "") {
              if (yearClause) void condition.toggle([yearClause])
              return
            }
            void condition.replaceField("date_created", { field: "date_created", from: `${yearFrom}-01-01`, to: `${yearTo}-12-31` })
          }}
        >
          Apply
        </Button>
      </div>
      {yearError && <div className="mt-1 text-fs-micro text-critical-fg">{yearError}</div>}
      <PaneHeading spacing="top">Annotation status</PaneHeading>
      <Select options={fieldOptions} value={statusField} onChange={setStatusField} size="sm" block aria-label="Status field" />
      <div className="mt-1.5 flex gap-1">
        {(Object.keys(GROUP_LABELS) as StatusGroup[]).map((group) => {
          const clause: Clause = { field: `${statusField}_status`, value: group }
          const on = condition.isSelected([clause])
          return (
            <Clickable
              key={group}
              aria-pressed={on}
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
      <div className="mt-1 text-fs-micro text-ink-soft">“No value” means that the attribute was not stated. It is not a negative result.</div>
      <PaneHeading spacing="top">Text match</PaneHeading>
      <Select options={fieldOptions} value={valueField} onChange={setValueField} size="sm" block aria-label="Value field" />
      <div className="mt-1.5">
        <TextInput
          value={valueText}
          onChange={setValueText}
          size="sm"
          block
          placeholder="Extracted value contains… (Enter)"
          aria-label="Extracted value contains"
          onEnter={() => {
            const text = valueText.trim()
            if (!text) return
            void condition.toggle([{ field: `${valueField}_value`, value: text }])
            setValueText("")
          }}
        />
      </div>
      <div className="mt-1.5">
        <TextInput
          value={titleText}
          onChange={setTitleText}
          size="sm"
          block
          placeholder="Title contains… (Enter)"
          aria-label="Title contains"
          onEnter={() => {
            const text = titleText.trim()
            if (!text) return
            void condition.toggle([{ field: "title", value: text }])
            setTitleText("")
          }}
        />
      </div>
      {textClauses.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {textClauses.map((clause) => (
            <Chip key={`${clause.field}:${clause.value}`} size="sm" onRemove={() => void condition.toggle([clause])} title={groupLabel(clause.field)}>
              {groupLabel(clause.field)} {clauseLabel(clause, condition.labels)}
            </Chip>
          ))}
        </div>
      )}
    </aside>
  )
}

/** What is wrong with the years of a range, or null when the range can be applied. */
const yearProblem = (from: string, to: string): string | null => {
  if (from === "" && to === "") return null
  if (!/^\d{4}$/.test(from) || !/^\d{4}$/.test(to)) return "Enter both years with four digits."
  if (Number(from) > Number(to)) return "The first year is after the last year."
  return null
}
