import { Fragment, useEffect, useState } from "react"

import { useEntries, useParsedCondition, useProjects } from "~/lib/api/queries"
import { formatCount } from "~/lib/format"
import { ACTION_ICON, Button, Chip, cn, CopyButton, LinkButton, Segmented, TextArea } from "~/ui"

import { clauseLabel, type ConditionGroup, conditionGroups, describeAst, groupLabel } from "./ast"
import type { Condition } from "./use-condition"

type Mode = "visual" | "query"

type ConditionBarProps = {
  q: string | null
  condition: Condition
  onShare: () => Promise<boolean>
  onExport: () => void
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
    <span title={label} className="flex h-7 w-condition-label shrink-0 items-center pr-2 pl-2.5 text-fs-body-sm text-ink-mid">
      <span className="truncate">{label}</span>
    </span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
)

type TreeProps = {
  groups: ConditionGroup[]
  condition: Condition
}

const Tree = ({ groups, condition }: TreeProps) => (
  <div className="flex flex-col gap-1">
    {groups.map((group, index) =>
      group.kind === "clauses" ? (
        <Row key={group.field} index={index} count={groups.length} label={groupLabel(group.field)}>
          <span
            className={cn(
              "inline-flex min-h-7 max-w-full flex-wrap items-center gap-1 rounded-button border px-1",
              group.clauses.length > 1 ? "border-brand-light" : "border-transparent",
            )}
          >
            {group.clauses.map((clause, clauseIndex) => (
              <Fragment key={`${clause.field}:${clause.value ?? clause.from}`}>
                {clauseIndex > 0 && <span className="px-0.5 text-fs-badge leading-none font-bold tracking-widest text-brand">OR</span>}
                <Chip title={clause.value ?? `${clause.from} TO ${clause.to}`} onRemove={() => void condition.toggle([clause])}>
                  {clauseLabel(clause, condition.labels)}
                </Chip>
              </Fragment>
            ))}
          </span>
        </Row>
      ) : (
        <Row key={`expression-${index}`} index={index} count={groups.length} label="Expression">
          <span className="inline-flex min-h-7 max-w-full items-center border border-transparent px-1">
            <Chip kind="soft" title="Edit this part of the condition in Query mode">
              {describeAst(group.node, condition.labels)}
            </Chip>
          </span>
        </Row>
      ),
    )}
  </div>
)

type Total = {
  count: number
  unit: string
}

const Totals = ({ totals }: { totals: Total[] | null }) => (
  <p aria-live="polite" className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
    {totals === null ? (
      <span className="text-fs-label text-ink-soft">Counting…</span>
    ) : (
      totals.map(({ count, unit }) => (
        <span key={unit} className="whitespace-nowrap">
          <span className="text-fs-body font-semibold text-ink tabular-nums">{formatCount(count)}</span>{" "}
          <span className="text-fs-label text-ink-soft">{unit}</span>
        </span>
      ))
    )}
  </p>
)

/** The current condition as a query tree or as the editable string, with its totals and the outputs that belong to it. */
export const ConditionBar = ({ q, condition, onShare, onExport, onApi, exportMenu }: ConditionBarProps) => {
  const [mode, setMode] = useState<Mode>("visual")
  const [draft, setDraft] = useState(q ?? "")
  const [draftError, setDraftError] = useState<string | null>(null)
  const draftParse = useParsedCondition(draftError === "pending" ? draft : null)
  const biosamples = useEntries({ q, type: "biosample", page: 1, perPage: 1 })
  const experiments = useEntries({ q, type: "sra-experiment", page: 1, perPage: 1 })
  const projects = useProjects({ q, selfExclusion: false, sort: "biosampleCount:desc", page: 1, perPage: 1, compositionFields: "" })
  const groups = conditionGroups(condition.ast)

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
      setDraftError(draftParse.error.message)
    }
  }, [draftError, draftParse.data, draftParse.error, condition])

  const totals =
    biosamples.data && experiments.data && projects.data
      ? [
        { count: biosamples.data.pagination.total, unit: "BioSamples" },
        { count: experiments.data.pagination.total, unit: "SRA Experiments" },
        { count: projects.data.pagination.total, unit: "BioProjects" },
      ]
      : null

  return (
    <section aria-label="Condition" className="flex shrink-0 items-start gap-3 border-b border-border-soft bg-surface px-workspace-gutter py-2.5">
      <div className="flex min-w-0 flex-1 flex-col self-stretch overflow-hidden rounded-card border border-border-soft bg-surface shadow-card">
        <div className="flex flex-1 items-start gap-4 px-3 py-2">
          <div className="min-w-0 flex-1">
            {mode === "visual" ? (
              groups.length === 0 ? (
                <div className="flex min-h-7 items-center px-1 text-fs-body-sm text-ink-soft">No condition. Every entry of the dataset matches.</div>
              ) : (
                <Tree groups={groups} condition={condition} />
              )
            ) : (
              <div className="px-1">
                <div className="flex items-start gap-2">
                  <TextArea
                    value={draft}
                    onChange={setDraft}
                    onSubmit={apply}
                    rows={2}
                    mono
                    spellCheck={false}
                    placeholder='disease:"MONDO:0007254" AND library_strategy:ATAC-seq'
                    aria-label="Condition"
                  />
                  <Button size="sm" onClick={apply} title="Apply (⌘/Ctrl+Enter)">
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
        <span className="relative flex">
          <Button
            kind="secondary"
            size="xs"
            block
            icon={ACTION_ICON.download}
            trailingIcon={ACTION_ICON.openList}
            onClick={onExport}
            aria-haspopup="menu"
          >
            Export
          </Button>
          {exportMenu}
        </span>
        <Button kind="secondary" size="xs" block icon={ACTION_ICON.openDialog} onClick={onApi} aria-haspopup="dialog">
          API
        </Button>
      </div>
    </section>
  )
}
