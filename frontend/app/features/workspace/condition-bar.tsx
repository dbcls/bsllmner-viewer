import { Fragment, useEffect, useState } from "react"

import { failureMessage, isInvalidCondition, loadFailureProps } from "~/lib/api/client"
import { queryFailed, useDataset, useDistribution, useEntries, useParsedCondition, useProjects } from "~/lib/api/queries"
import { formatCount } from "~/lib/format"
import { unitLabel } from "~/lib/labels"
import { ACTION_ICON, Button, Chip, cn, CopyButton, ErrorNotice, LinkButton, Segmented, Skeleton, TextArea } from "~/ui"

import { clauseLabel, type ConditionGroup, conditionGroups, describeAst, groupLabel } from "./ast"
import { TermIdHover } from "./term-id-hover"
import type { Condition } from "./use-condition"

type Mode = "visual" | "query"

type ConditionBarProps = {
  q: string | null
  condition: Condition
  onShare: () => Promise<boolean>
  onApi: () => void
  exportMenu: React.ReactNode
}

const LINE = "absolute bg-brand-light"

type RailProps = {
  index: number
  count: number
}

/**
 * The left column of one row of the condition. The first row holds the badge; a line runs from it down to the last row
 * and turns into each row at the height of the row's first line (`top-3.5`, the middle of `h-7`).
 */
const Rail = ({ index, count }: RailProps) => {
  const first = index === 0
  const last = index === count - 1
  return (
    <span className="relative w-rail-col shrink-0 self-stretch">
      <span aria-hidden="true">
        {!last && <span className={cn(LINE, "-bottom-1 left-1/2 w-0.5 -translate-x-1/2", first ? "top-3.5" : "top-0")} />}
        {last && !first ? (
          <span className="absolute top-0 left-1/2 -right-1 h-3.75 -translate-x-px rounded-bl-md border-b-2 border-l-2 border-brand-light" />
        ) : (
          <span className={cn(LINE, "top-3.5 left-1/2 -right-1 h-0.5 -translate-y-1/2")} />
        )}
      </span>
      {first && (
        <span className="absolute top-3.5 left-1/2 flex h-4 w-9 -translate-1/2 items-center justify-center rounded-tag bg-brand text-fs-badge leading-none font-bold tracking-widest text-white">
          {count > 1 ? "AND" : "ALL"}
        </span>
      )}
    </span>
  )
}

type RowProps = {
  index: number
  count: number
  label: string
  children: React.ReactNode
}

/** One AND-ed part of the condition: the rail, the field name in a fixed column, and the values. */
const Row = ({ index, count, label, children }: RowProps) => (
  <div className="flex items-start">
    <Rail index={index} count={count} />
    <span className="flex h-7 w-condition-label shrink-0 items-center pr-2 pl-2.5 text-fs-body-sm text-ink-mid">
      <span className="truncate py-1 text-trim-cap">{label}</span>
    </span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
)

type TreeProps = {
  groups: ConditionGroup[]
  condition: Condition
  /** The fields whose values are ontology terms. Their chips show the term ID after the label. */
  termFields: ReadonlySet<string>
}

const Tree = ({ groups, condition, termFields }: TreeProps) => (
  <div className="flex flex-col gap-1">
    {groups.map((group, index) =>
      group.kind === "keyword" ? (
        <Row key="keyword" index={index} count={groups.length} label="Keyword">
          <span className="inline-flex min-h-7 max-w-full items-center border border-transparent px-1">
            <Chip name={group.text} onRemove={() => void condition.setKeyword("")}>
              {group.text}
            </Chip>
          </span>
        </Row>
      ) : group.kind === "clauses" ? (
        <Row key={group.field} index={index} count={groups.length} label={groupLabel(group.field)}>
          <span className="inline-flex min-h-7 max-w-full flex-wrap items-center gap-1 border border-transparent px-1">
            {group.clauses.map((clause, clauseIndex) => (
              <Fragment key={`${clause.field}:${clause.value ?? clause.from}`}>
                {clauseIndex > 0 && <span className="px-0.5 text-fs-badge leading-none font-bold tracking-widest text-brand">OR</span>}
                <Chip name={clauseLabel(clause, condition.labels)} onRemove={() => void condition.remove([clause])}>
                  {clauseLabel(clause, condition.labels)}
                  {termFields.has(clause.field) && clause.value && (
                    <>
                      {" "}
                      <TermIdHover termId={clause.value} label={clauseLabel(clause, condition.labels)} />
                    </>
                  )}
                </Chip>
              </Fragment>
            ))}
          </span>
        </Row>
      ) : (
        <Row key={`expression-${index}`} index={index} count={groups.length} label="Expression">
          <span className="inline-flex min-h-7 max-w-full items-center border border-transparent px-1">
            <Chip kind="soft">
              {describeAst(group.node, condition.labels)}
            </Chip>
          </span>
        </Row>
      ),
    )}
  </div>
)

type Total = {
  /** Undefined while the count is on its way, and null when it cannot be had. */
  count: number | null | undefined
  unit: string
}

/** The counts of the condition in each unit. A count on its way is a skeleton beside its unit, so the line keeps its place. */
const Totals = ({ totals }: { totals: Total[] }) => (
  <p aria-live="polite" aria-busy={totals.some((total) => total.count === undefined) || undefined} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
    {totals.map(({ count, unit }) => (
      <span key={unit} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-fs-body font-semibold text-ink tabular-nums">{count === undefined ? <Skeleton className="w-16" /> : count === null ? "–" : formatCount(count)}</span>
        <span className="text-fs-label text-ink-soft">{unit}</span>
      </span>
    ))}
  </p>
)

/**
 * The number of rows that the tree of a condition string will take: one per field that the string names. Values in
 * quotes are left out, since a term ID such as `"EFO:0004038"` looks like a field. Used for the skeleton rows while the
 * condition is parsed, so that the bar has its height before the tree arrives.
 */
export const estimatedRows = (q: string): number => {
  const unquoted = q.replace(/"[^"]*"/g, '""')
  const fields = [...unquoted.matchAll(/(?:^|[\s(])([A-Za-z_]\w*):/g)].map((match) => match[1])
  return Math.max(1, new Set(fields).size)
}

const SkeletonRows = ({ count }: { count: number }) => (
  <div aria-busy="true" className="flex flex-col gap-1">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="flex h-7 items-center">
        <span className="w-rail-col shrink-0" />
        <span className="w-condition-label shrink-0 pr-2 pl-2.5">
          <Skeleton className="w-20" />
        </span>
        <Skeleton kind="block" className="h-6 w-40" />
      </div>
    ))}
  </div>
)

/** The current condition as a query tree or as the editable string, with its totals and the outputs that belong to it. */
export const ConditionBar = ({ q, condition, onShare, onApi, exportMenu }: ConditionBarProps) => {
  const [mode, setMode] = useState<Mode>("visual")
  const [draft, setDraft] = useState(q ?? "")
  const [draftError, setDraftError] = useState<string | null>(null)
  const draftParse = useParsedCondition(draftError === "pending" ? draft : null)
  // The counts are not asked for while the condition cannot be read.
  const readable = !condition.parseError
  const biosamples = useEntries({ q, page: 1, perPage: 1 }, readable)
  // Experiments are not entries; the total of any distribution counted in experiments is the count of the condition.
  const experiments = useDistribution({ field: "library_strategy", q, unit: "sra-experiment", selfExclusion: false, limit: 1 }, readable)
  const projects = useProjects({ q, selfExclusion: false, sort: "biosampleCount:desc", page: 1, perPage: 1 }, readable)
  const groups = conditionGroups(condition.ast, condition.selected, condition.keywordText)
  const dataset = useDataset()
  const termFields = new Set(dataset.data?.dslFields.filter((field) => field.kind === "term").map((field) => field.name))

  useEffect(() => {
    setDraft(q ?? "")
  }, [q])

  const apply = () => {
    const text = draft.trim()
    if (!text) {
      condition.clear()
      setDraftError(null)
      return
    }
    setDraftError("pending")
  }

  useEffect(() => {
    if (draftError !== "pending") return
    if (draftParse.data) {
      setDraftError(null)
      condition.applyText(draftParse.data.q)
    } else if (draftParse.error) {
      setDraftError(failureMessage(draftParse.error, "load the condition"))
    }
  }, [draftError, draftParse.data, draftParse.error, condition])

  const countOf = (query: { isError: boolean; data: unknown }, count: number | undefined) => (!readable || queryFailed(query) ? null : count)
  const totals: Total[] = [
    { count: countOf(biosamples, biosamples.data?.pagination.total), unit: unitLabel("biosample") },
    { count: countOf(experiments, experiments.data?.total), unit: unitLabel("sra-experiment") },
    { count: countOf(projects, projects.data?.pagination.total), unit: unitLabel("bioproject") },
  ]

  return (
    <section aria-label="Condition" className="flex shrink-0 items-start gap-3 border-b border-border-soft bg-surface px-workspace-gutter py-2.5">
      <div className="flex min-w-0 flex-1 flex-col self-stretch overflow-hidden rounded-card border border-border-soft bg-surface shadow-card">
        <div className="flex flex-1 items-start gap-4 px-3 py-2">
          <div className="min-w-0 flex-1">
            {mode === "visual" ? (
              condition.parseError ? (
                isInvalidCondition(condition.parseError) ? (
                  <ErrorNotice message={`The condition in the URL is not valid: ${condition.parseError.message}`} />
                ) : (
                  <ErrorNotice {...loadFailureProps(condition.parseError, "load the condition", condition.retryParse)} />
                )
              ) : condition.parsing && q ? (
                <SkeletonRows count={estimatedRows(q)} />
              ) : groups.length === 0 ? (
                <div className="flex min-h-7 items-center px-1 text-fs-body-sm text-ink-soft">No condition. All entries of the dataset are shown.</div>
              ) : (
                <Tree groups={groups} condition={condition} termFields={termFields} />
              )
            ) : (
              <div className="px-1">
                <div className="flex items-start gap-2">
                  <TextArea
                    value={draft}
                    onChange={setDraft}
                    rows={2}
                    mono
                    spellCheck={false}
                    placeholder='disease:"MONDO:0007254" AND library_strategy:ATAC-seq'
                    aria-label="Condition"
                  />
                  <Button size="sm" onClick={apply}>
                    Apply
                  </Button>
                </div>
                {draftError && draftError !== "pending" && (
                  <div role="alert" className="mt-1 text-fs-body-sm text-critical-fg">
                    {draftError}
                  </div>
                )}
              </div>
            )}
          </div>
          <Segmented
            ariaLabel="Condition display"
            size="md"
            options={[
              { value: "visual", label: "Visual" },
              { value: "query", label: "Query" },
            ]}
            value={mode}
            onChange={(value) => {
              setMode(value)
              setDraft(q ?? "")
              setDraftError(null)
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border-soft bg-surface-subtle px-4 py-1.5">
          <Totals totals={totals} />
          {q && (
            <LinkButton size="md" icon={ACTION_ICON.clear} onClick={condition.clear}>
              Clear all
            </LinkButton>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <CopyButton size="xs" block onCopy={onShare}>
          Share
        </CopyButton>
        {exportMenu}
        <Button kind="secondary" size="xs" block icon={ACTION_ICON.openDialog} onClick={onApi} aria-haspopup="dialog">
          API
        </Button>
      </div>
    </section>
  )
}
