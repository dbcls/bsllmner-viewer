import { useState } from "react"

import { loadFailureProps } from "~/lib/api/client"
import { queryFailed, useDataset, useTerms } from "~/lib/api/queries"
import { formatCount } from "~/lib/format"
import { fieldLabel } from "~/lib/labels"
import { ALL_FIELDS, SKELETON_TERMS, TERM_SEARCH_DEBOUNCE_MS, termFieldOptions, termHitRowProps, useResultListRef } from "~/lib/terms"
import { useDebounced } from "~/lib/use-debounced"
import { ACTION_ICON, busyClass, Button, Card, CardHeader, Clickable, cn, ErrorNotice,Select, termRowClass, TermRowContent, TermRowSkeleton, TextInput } from "~/ui"

import { ConditionLink } from "./condition-link"
import { CountBar, countBarRowClass, CountBarSkeleton } from "./count-bar"

/** The name of the result list: the terms of one field or of every field, and the text they match. */
const resultTitle = (field: string | null, query: string): string => {
  const terms = field ? `${field} terms` : "Terms"
  return query ? `${terms} matching “${query}”` : terms
}

/** Search terms across the annotation fields, or browse one field, and open the workspace with the chosen term. */
export const TermSearch = () => {
  const dataset = useDataset()
  const fieldCounts = dataset.data?.fields ?? []
  const fields = fieldCounts.map((f) => f.name)
  const total = dataset.data?.totals.biosample ?? 0
  const [field, setField] = useState(ALL_FIELDS)
  const [query, setQuery] = useState("")
  const debounced = useDebounced(query.trim(), TERM_SEARCH_DEBOUNCE_MS)
  const everyField = field === ALL_FIELDS
  const active = query.trim() !== "" || !everyField
  const terms = useTerms(
    { ...(everyField ? {} : { field }), query: debounced, q: null, unit: "biosample", selfExclusion: true, limit: 20 },
    active && (!everyField || debounced !== ""),
  )
  const list = useResultListRef(terms.data?.query, terms.data?.field)
  const failed = queryFailed(terms)
  const datasetFailed = queryFailed(dataset)

  const clear = () => {
    setField(ALL_FIELDS)
    setQuery("")
  }

  return (
    <div>
      <div className="flex gap-2">
        <Select options={termFieldOptions(fields)} value={field} onChange={setField} aria-label="Field" />
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
              <span className="font-semibold text-ink">{resultTitle(everyField ? null : fieldLabel(field), debounced)}</span>
              <Button kind="secondary" size="sm" icon={ACTION_ICON.clear} onClick={clear}>
                Clear search
              </Button>
            </CardHeader>
            <div
              ref={list}
              aria-busy={(!terms.data && !failed) || terms.isPlaceholderData || undefined}
              className={cn("max-h-picker-list overflow-auto", busyClass(terms.isPlaceholderData))}
            >
              {failed && (
                <div className="px-6 py-4">
                  <ErrorNotice {...loadFailureProps(terms.error, "search terms", () => void terms.refetch())} />
                </div>
              )}
              {!terms.data && !failed && Array.from({ length: SKELETON_TERMS }, (_, index) => <TermRowSkeleton key={index} />)}
              {(terms.data?.terms ?? []).map((hit) => (
                <ConditionLink
                  key={`${hit.field}:${hit.termId}`}
                  clauses={hit.clauses}
                  enabled={!terms.isPlaceholderData}
                  className={termRowClass()}
                >
                  <TermRowContent {...termHitRowProps(hit, everyField, terms.data?.query)} />
                </ConditionLink>
              ))}
              {terms.data && terms.data.terms.length === 0 && (
                <div className="px-6 py-6 text-center text-fs-body-sm text-ink-soft">No matching term. Try a synonym or a term ID.</div>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <div className="mt-3">
          <Card padding="sm">
            <div className="mb-1.5 font-semibold">Annotation terms</div>
            <div className="grid grid-cols-3 gap-x-5">
              {datasetFailed && (
                <div className="col-span-3">
                  <ErrorNotice {...loadFailureProps(dataset.error, "load the terms", () => void dataset.refetch())} />
                </div>
              )}
              {dataset.data === undefined && !datasetFailed && Array.from({ length: SKELETON_FIELDS }, (_, index) => <CountBarSkeleton key={index} padding="md" />)}
              {fieldCounts.map(({ name, mappedBiosampleCount }) => (
                <FieldRow key={name} field={name} mapped={mappedBiosampleCount} total={total} onSelect={() => setField(name)} />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

/** The field rows drawn before the description of the dataset arrives, on the first visit only. */
const SKELETON_FIELDS = 6

type FieldRowProps = {
  field: string
  /** The BioSamples with a term in the field, of the whole dataset, as build counted them. */
  mapped: number
  total: number
  onSelect: () => void
}

const FieldRow = ({ field, mapped, total, onSelect }: FieldRowProps) => (
  <Clickable onClick={onSelect} aria-label={`Browse ${fieldLabel(field)} terms`} className={countBarRowClass("md")}>
    <CountBar label={fieldLabel(field)} count={formatCount(mapped)} ratio={total > 0 ? mapped / total : 0} />
  </Clickable>
)
