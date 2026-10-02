import { type ReactNode, useEffect, useRef, useState } from "react"

import { useDataset, useDistribution } from "~/lib/api/queries"
import type { Clause, Unit } from "~/lib/api/types"
import { type DateRange, enteredRange, isoDate, RECENT_YEARS, recentRange, recentYearsOf } from "~/lib/date-range"
import { formatCount } from "~/lib/format"
import { fieldLabel, GROUP_LABELS, organismLabel, type StatusGroup } from "~/lib/labels"
import { ACTION_ICON, Caption, CheckboxRow, Chip, Clickable, cn, HelpHint, LinkButton, PaneHeading, Select, Skeleton, TextInput } from "~/ui"

import { AssayTag } from "./assay-tags"
import { clauseLabel, clausesOfField, keywordText, selectedClauses } from "./ast"
import type { Condition } from "./use-condition"

type ConditionPanelProps = {
  q: string | null
  /** The counting unit of the views, so that the counts beside the assays and organisms are in the same unit. */
  unit: Unit
  condition: Condition
  onAddTerm: (field: string) => void
}

/** The organisms the panel lists: those with at least this share of the dataset's BioSamples. */
const ORGANISM_MIN_SHARE = 0.01

/** The condition inputs: terms per field, assay, organism, creation year, annotation status, and text matches. */
export const ConditionPanel = ({ q, unit, condition, onAddTerm }: ConditionPanelProps) => {
  const dataset = useDataset()
  const fields = dataset.data?.fields ?? []
  const assays = useDistribution({ field: "library_strategy", q, unit, selfExclusion: true, limit: 20 })
  const organismCounts = useDistribution({ field: "organism_id", q, unit, selfExclusion: true, limit: 20 })
  const selected = selectedClauses(condition.ast)

  const statusFields = selected.filter((clause) => clause.field.endsWith("_status")).map((clause) => clause.field.slice(0, -"_status".length))
  const firstStatusField = statusFields[0]
  const [statusField, setStatusField] = useState(firstStatusField ?? "disease")
  useEffect(() => {
    if (firstStatusField !== undefined) setStatusField((current) => (statusFields.includes(current) ? current : firstStatusField))
    // The select follows the condition only when the set of fields with a status condition changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFields.join(",")])

  const fieldOptions = fields.map((f) => ({ value: f.name, label: fieldLabel(f.name) }))
  const targetAssays = dataset.data?.targetAssays ?? []
  const assayCounts = countsOf(assays.data?.elements)
  const datasetOrganisms = dataset.data?.organisms ?? []
  const datasetTotal = datasetOrganisms.reduce((total, organism) => total + organism.biosampleCount, 0)
  const organisms = datasetOrganisms
    .filter((organism) => organism.biosampleCount >= datasetTotal * ORGANISM_MIN_SHARE)
    .sort((a, b) => b.biosampleCount - a.biosampleCount)
  const organismCount = countsOf(organismCounts.data?.elements)

  const selectedFor = (field: string) => clausesOfField(condition.ast, field)

  return (
    <aside className="w-sidebar shrink-0 border-r border-border-soft bg-surface px-4 pt-3.5 pb-6 text-fs-body-sm">
      <KeywordSearch condition={condition} />
      <PaneHeading spacing="top">Annotation terms</PaneHeading>
      <Section>
        {dataset.data === undefined && <SkeletonRows count={FIELD_ROWS} className="border-b border-brand-soft py-1.5" />}
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
      </Section>
      <PaneHeading spacing="top">Assay</PaneHeading>
      <Section>
        {dataset.data === undefined && <SkeletonRows count={ASSAY_ROWS} className="py-1" />}
        {targetAssays.map((assay) => {
          const clause: Clause = { field: "library_strategy", value: assay }
          return (
            <CheckboxRow
              key={assay}
              checked={condition.isSelected([clause])}
              onChange={() => void condition.toggle([clause])}
              label={<AssayTag assay={assay} targetAssays={targetAssays} />}
              count={assayCounts(assay)}
            />
          )
        })}
      </Section>
      <PaneHeading spacing="top">Organism</PaneHeading>
      <Section>
        {dataset.data === undefined && <SkeletonRows count={ORGANISM_ROWS} className="py-1" />}
        {organisms.map((organism) => {
          const clause: Clause = { field: "organism_id", value: organism.identifier }
          return (
            <CheckboxRow
              key={organism.identifier}
              checked={condition.isSelected([clause])}
              onChange={() => void condition.toggle([clause])}
              label={organismLabel(organism.identifier, organism.name)}
              count={organismCount(organism.identifier)}
            />
          )
        })}
      </Section>
      <PaneHeading spacing="top">Creation date</PaneHeading>
      <Section>
        <CreationDate condition={condition} />
      </Section>
      <PaneHeading spacing="top" aside={<HelpHint label="About annotation status" side="top">{STATUS_HELP}</HelpHint>}>
        Annotation status
      </PaneHeading>
      <Section>
        <Select options={fieldOptions} value={statusField} onChange={setStatusField} size="sm" block aria-label="Status field" />
        <div className="mt-1.5 flex gap-1">
          {(Object.keys(GROUP_LABELS) as StatusGroup[]).map((group) => {
            const clause: Clause = { field: `${statusField}_status`, value: group }
            const on = condition.isSelected([clause])
            return (
              <Choice key={group} on={on} onClick={() => void condition.toggle([clause])}>
                {GROUP_LABELS[group]}
              </Choice>
            )
          })}
        </div>
      </Section>
    </aside>
  )
}

/**
 * The count shown beside each value of a field: a skeleton while the counts load, and 0 for a value that no entry of the
 * condition has, since an aggregation leaves such values out.
 */
const countsOf = (elements: { value: string; count: number }[] | undefined) => {
  const counts = new Map((elements ?? []).map((element) => [element.value, element.count]))
  return (value: string): ReactNode => (elements === undefined ? <Skeleton className="w-10" /> : formatCount(counts.get(value) ?? 0))
}

/**
 * How many skeleton rows a section shows before the description of the dataset arrives. Only the first visit needs a
 * guess; later visits draw the rows from the stored description.
 */
const FIELD_ROWS = 6
const ASSAY_ROWS = 3
const ORGANISM_ROWS = 2

/** Skeleton rows as tall as the rows that replace them: one line of text inside the rows' own padding. */
const SkeletonRows = ({ count, className }: { count: number; className: string }) => (
  <div aria-busy="true">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className={className}>
        <Skeleton className="w-28" />
      </div>
    ))}
  </div>
)

/** The items under a heading of the pane, set in a little from the heading's rule. */
const Section = ({ children }: { children: ReactNode }) => <div className="pl-1">{children}</div>

type ChoiceProps = {
  on: boolean
  onClick: () => void
  children: ReactNode
}

/** One of a row of equal buttons that turn a value of the condition on and off. */
const Choice = ({ on, onClick, children }: ChoiceProps) => (
  <Clickable
    aria-pressed={on}
    onClick={onClick}
    className={cn(
      "flex-1 cursor-pointer rounded-button border py-1 text-fs-label whitespace-nowrap",
      on ? "border-brand-light bg-brand-tint text-brand" : "border-border-soft bg-surface text-ink-mid hover:bg-brand-soft",
    )}
  >
    {children}
  </Clickable>
)

const STATUS_HELP = (
  <>
    The status of the annotation of the chosen field.
    <span className="mt-1.5 block">
      <span className="font-semibold">Mapped</span>: an ontology term was assigned to the extracted value.
    </span>
    <span className="mt-1 block">
      <span className="font-semibold">Unmapped</span>: a value was extracted, but no ontology term was assigned to it.
    </span>
    <span className="mt-1 block">
      <span className="font-semibold">No value</span>: no value was extracted, or the extraction failed. It does not mean that the sample lacks the
      property.
    </span>
  </>
)

/** How long typed keywords wait before they change the condition, so each pause in typing searches once. */
const KEYWORD_TYPING_MS = 500

/**
 * The keyword box: words and quoted phrases, searched in the text and the accessions of the entries. Typing changes the
 * condition after a pause, and Enter at once. While the box has focus it keeps what is typed; otherwise it shows the
 * keywords of the condition.
 */
const KeywordSearch = ({ condition }: { condition: Condition }) => {
  const current = keywordText(condition.ast)
  const [text, setText] = useState(current)
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const applied = useRef(current)

  useEffect(() => {
    if (focused) return
    setText(current)
    applied.current = current
  }, [current, focused])

  const apply = async (next: string) => {
    applied.current = next
    try {
      await condition.setKeyword(next)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  useEffect(() => {
    if (text === applied.current) return
    const timer = setTimeout(() => void apply(text), KEYWORD_TYPING_MS)
    return () => clearTimeout(timer)
    // The typed text is the trigger; the condition is read when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <div>
      <TextInput
        value={text}
        onChange={setText}
        onEnter={() => void apply(text)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        icon={ACTION_ICON.search}
        size="lg"
        block
        spellCheck={false}
        placeholder="Keyword or accession"
        aria-label="Keyword"
      />
      {error && (
        <div role="alert" className="mt-1 text-fs-micro text-critical-fg">
          {error}
        </div>
      )}
    </div>
  )
}

/** How long the typed dates wait before they change the condition, so a half-typed year is not applied. */
const DATE_TYPING_MS = 500

const DATE_FIELD = "date_created"

/**
 * The creation-date condition: the last 1, 5, or 10 years, or a range of days. A preset or a finished date changes the
 * condition at once; there is no apply step. An empty end means today.
 */
const CreationDate = ({ condition }: { condition: Condition }) => {
  const today = isoDate(new Date())
  const ranges = clausesOfField(condition.ast, DATE_FIELD).filter((clause) => clause.from !== undefined && clause.to !== undefined)
  const only = ranges.length === 1 ? ranges[0] : undefined
  const range: DateRange | null = only?.from !== undefined && only.to !== undefined ? { from: only.from, to: only.to } : null
  const recent = range ? recentYearsOf(range, today) : null
  const [from, setFrom] = useState(range?.from ?? "")
  const [to, setTo] = useState(range?.to ?? "")
  useEffect(() => {
    setFrom(range?.from ?? "")
    setTo(range?.to ?? "")
  }, [range?.from, range?.to])

  const entered = enteredRange(from, to, today)
  const unchanged = from === (range?.from ?? "") && to === (range?.to ?? "")
  const apply = (next: DateRange | null) => {
    if (next === null) {
      if (ranges.length) void condition.toggle(ranges)
      return
    }
    void condition.replaceField(DATE_FIELD, { field: DATE_FIELD, ...next })
  }

  useEffect(() => {
    if (unchanged) return
    const cleared = from === "" && to === ""
    if (!cleared && (entered === null || entered === "reversed")) return
    const timer = setTimeout(() => apply(cleared ? null : (entered as DateRange)), DATE_TYPING_MS)
    return () => clearTimeout(timer)
    // The typed dates are the trigger; the condition is read when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  return (
    <>
      <div className="flex gap-1">
        <Choice on={ranges.length === 0} onClick={() => apply(null)}>
          All
        </Choice>
        {RECENT_YEARS.map((years) => (
          <Choice key={years} on={recent === years} onClick={() => apply(recentRange(today, years))}>
            {years === 1 ? "1 year" : `${years} years`}
          </Choice>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <label className="flex items-center gap-2">
          <span className="w-8 shrink-0">
            <Caption>From</Caption>
          </span>
          <TextInput type="date" value={from} onChange={setFrom} size="sm" block max={today} aria-label="Created from" />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-8 shrink-0">
            <Caption>To</Caption>
          </span>
          <TextInput type="date" value={to} onChange={setTo} size="sm" block max={today} aria-label="Created to" />
        </label>
      </div>
      {entered === "reversed" && <div className="mt-1 text-fs-micro text-critical-fg">The start is after the end.</div>}
    </>
  )
}
