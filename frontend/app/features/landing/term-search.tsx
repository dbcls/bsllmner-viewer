import { useEffect, useState } from "react"
import { useNavigate } from "react-router"

import { selectElement, useDataset, useDistribution, useTerms } from "~/lib/api/queries"
import type { TermHit } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel } from "~/lib/labels"
import { termDetail } from "~/lib/terms"
import { workspaceSearch } from "~/lib/workspace-state"
import { ACTION_ICON, Button, Card, CardHeader, Clickable, Icon, Select, TermRow, TextInput } from "~/ui"

/** The field choice that searches every annotation field. */
const ALL_FIELDS = "*"
const DEBOUNCE_MS = 200

const useDebounced = (value: string, delay: number): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** The name of the result list: the terms of one field or of every field, and the text they match. */
const resultTitle = (field: string | null, query: string): string => {
  const terms = field ? `${field} terms` : "Terms"
  return query ? `${terms} matching “${query}”` : terms
}

/** Search terms across the annotation fields, or browse one field, and open the workspace with the chosen term. */
export const TermSearch = () => {
  const navigate = useNavigate()
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const total = dataset.data?.totals.biosample ?? 0
  const [field, setField] = useState(ALL_FIELDS)
  const [query, setQuery] = useState("")
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS)
  const everyField = field === ALL_FIELDS
  const active = query.trim() !== "" || !everyField
  const terms = useTerms(
    { ...(everyField ? {} : { field }), query: debounced, q: null, unit: "biosample", selfExclusion: true, limit: 20 },
    active,
  )
  const options = [{ value: ALL_FIELDS, label: "All fields" }, ...fields.map((f) => ({ value: f, label: fieldLabel(f) }))]

  const clear = () => {
    setField(ALL_FIELDS)
    setQuery("")
  }

  const open = async (hit: TermHit) => {
    const condition = await selectElement({ q: null, clauses: hit.clauses })
    await navigate(`/entries${workspaceSearch({ q: condition.dsl })}`)
  }

  return (
    <div>
      <div className="flex gap-2">
        <Select options={options} value={field} onChange={setField} aria-label="Field" />
        <TextInput
          value={query}
          onChange={setQuery}
          icon={ACTION_ICON.search}
          placeholder="liver, TP53, MCF-7"
          aria-label="Search terms by label, synonym, or ID"
          block
        />
      </div>
      {active ? (
        <div className="mt-3">
          <Card padding="none" flush>
            <CardHeader>
              <span>
                <span className="font-semibold text-ink">{resultTitle(everyField ? null : fieldLabel(field), debounced)}</span> · BioSamples with
                the term
              </span>
              <Button kind="secondary" size="sm" onClick={clear}>
                <Icon name={ACTION_ICON.clear} />
                Clear search
              </Button>
            </CardHeader>
            <div className="max-h-picker-list overflow-auto">
              {(terms.data?.terms ?? []).map((hit) => (
                <TermRow
                  key={`${hit.field}:${hit.termId}`}
                  label={hit.label ?? hit.termId}
                  id={hit.termId}
                  detail={termDetail(hit)}
                  count={formatCount(hit.count)}
                  {...(everyField ? { field: fieldLabel(hit.field) } : {})}
                  onClick={() => void open(hit)}
                />
              ))}
              {terms.data && terms.data.terms.length === 0 && (
                <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">No matching term. Try a synonym or a term ID.</div>
              )}
              {!terms.data && <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">Searching…</div>}
            </div>
          </Card>
        </div>
      ) : (
        <div className="mt-3">
          <Card padding="sm">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="font-semibold">Annotation terms</span>
              <span className="text-fs-micro text-ink-soft">BioSamples with a term</span>
            </div>
            <div className="grid grid-cols-3 gap-x-5">
              {fields.map((name) => (
                <FieldRow key={name} field={name} total={total} onSelect={() => setField(name)} />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

type FieldRowProps = {
  field: string
  total: number
  onSelect: () => void
}

const FieldRow = ({ field, total, onSelect }: FieldRowProps) => {
  const status = useDistribution({ field: `${field}_status`, q: null, unit: "biosample", selfExclusion: true })
  const mapped = status.data?.elements.find((element) => element.value === "mapped")?.count
  return (
    <Clickable
      onClick={onSelect}
      aria-label={`Browse ${fieldLabel(field)} terms`}
      className="flex w-full cursor-pointer items-center gap-2 rounded-tag py-1 text-left hover:bg-brand-soft"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-fs-body-sm">{fieldLabel(field)}</span>
        <span className="mt-0.5 block h-1.5 overflow-hidden rounded-badge bg-brand-soft">
          <span className="block h-full bg-brand-light" style={{ width: `${total > 0 && mapped !== undefined ? (mapped / total) * 100 : 0}%` }} />
        </span>
      </span>
      <span className="w-17 shrink-0 text-right font-mono text-fs-label text-ink-mid">{mapped === undefined ? "…" : formatCount(mapped)}</span>
    </Clickable>
  )
}
