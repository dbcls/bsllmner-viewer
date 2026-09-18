import { useEffect, useState } from "react"

import { useParsedCondition, useProjects, useRecords } from "~/lib/api/queries"
import { formatCount } from "~/lib/format"
import { Button, Chip, cn, LinkButton, Segmented, TextArea } from "~/ui"

import { clauseLabel, conditionGroups, groupLabel } from "./ast"
import type { Condition } from "./use-condition"

type Mode = "visual" | "query"

type ConditionBarProps = {
  q: string | null
  condition: Condition
  onShare: () => void
  onExport: () => void
  onApi: () => void
  exportMenu: React.ReactNode
}

const FIELD_HINT = "disease, cell_line, … disease_value, disease_status, library_strategy, organism_id, date_created, bioproject, title"

/** The current condition as a query tree or as the editable string, with the outputs that belong to it. */
export const ConditionBar = ({ q, condition, onShare, onExport, onApi, exportMenu }: ConditionBarProps) => {
  const [mode, setMode] = useState<Mode>("visual")
  const [draft, setDraft] = useState(q ?? "")
  const [draftError, setDraftError] = useState<string | null>(null)
  const draftParse = useParsedCondition(draftError === "pending" ? draft : null)
  const biosamples = useRecords({ q, unit: "biosample", page: 1, perPage: 1 })
  const experiments = useRecords({ q, unit: "experiment", page: 1, perPage: 1 })
  const projects = useProjects({ q, selfExclusion: false, sort: "biosample", page: 1, perPage: 1, compositionFields: "" })
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
      ? `${formatCount(biosamples.data.total)} BioSamples · ${formatCount(experiments.data.total)} Experiments · ${formatCount(projects.data.total)} BioProjects`
      : "Counting…"

  return (
    <section aria-label="Condition" className="flex shrink-0 items-start gap-4 border-b border-border-soft bg-surface px-workspace-gutter py-2.5">
      <div className="min-w-0 flex-1">
        {mode === "visual" ? (
          groups.length === 0 ? (
            <div className="flex min-h-7 items-center text-fs-body-sm text-ink-soft">
              No condition — the whole dataset. Add terms from the panel, or click any bar, cell, point, or row.
            </div>
          ) : (
            <div className="flex items-stretch">
              <div className="relative z-10 flex w-rail-col shrink-0 flex-col items-center pt-1.5">
                <span className="rounded-tag bg-brand px-1.5 py-0.5 text-fs-badge leading-none font-bold tracking-widest text-white">
                  {groups.length > 1 ? "AND" : "ALL"}
                </span>
                <span className="mt-1 mb-3 w-0.5 flex-1 bg-border-soft" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 pl-3">
                {groups.map((group, index) => (
                  <div key={index} className="flex min-h-7 items-center gap-2">
                    <span className="-ml-rail-offset h-0.5 w-rail-width shrink-0 bg-border-soft" />
                    {group.kind === "clauses" ? (
                      <>
                        <span className="min-w-16 text-fs-micro tracking-tag whitespace-nowrap text-ink-soft uppercase">{groupLabel(group.field)}</span>
                        {group.clauses.length > 1 && (
                          <span className="rounded-tag bg-brand-tint px-1.5 py-0.5 text-fs-badge leading-none font-bold tracking-widest text-brand">OR</span>
                        )}
                        <span
                          className={cn(
                            "flex flex-wrap items-center gap-1 rounded-button border px-1 py-0.5",
                            group.clauses.length > 1 ? "border-brand-light" : "border-transparent",
                          )}
                        >
                          {group.clauses.map((clause) => (
                            <Chip
                              key={`${clause.field}:${clause.value ?? clause.from}`}
                              title={clause.value ?? `${clause.from} TO ${clause.to}`}
                              onRemove={() => void condition.toggle([clause])}
                            >
                              {clauseLabel(clause, condition.labels)}
                            </Chip>
                          ))}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="min-w-16 text-fs-micro tracking-tag whitespace-nowrap text-ink-soft uppercase">Expression</span>
                        <Chip kind="soft" title="Edit this part of the condition in Query mode">
                          <span className="font-mono text-fs-label">{group.text}</span>
                        </Chip>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <div>
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
              <Button size="sm" onClick={apply}>
                Apply
              </Button>
            </div>
            <div className="mt-1 flex gap-2.5 text-fs-label text-ink-soft">
              <span>
                Fields: <span className="font-mono">{FIELD_HINT}</span>. ⌘/Ctrl+Enter applies.
              </span>
              {draftError && draftError !== "pending" && <span className="text-critical-fg">{draftError}</span>}
            </div>
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-fs-label text-ink-soft">
          <span className="text-ink-mid">{totals}</span>
          {q && (
            <>
              <span className="text-border-soft">|</span>
              <LinkButton tone="soft" onClick={condition.clear}>
                Clear all
              </LinkButton>
            </>
          )}
        </div>
      </div>
      <div className="relative flex shrink-0 items-start gap-2">
        <span className="mr-2">
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
        </span>
        <Button kind="secondary" size="sm" onClick={onShare}>
          Share
        </Button>
        <Button kind="secondary" size="sm" onClick={onExport} aria-haspopup="menu">
          Export ▾
        </Button>
        <Button kind="secondary" size="sm" onClick={onApi}>
          <span className="font-mono">API</span>
        </Button>
        {exportMenu}
      </div>
    </section>
  )
}
