import { Link, useNavigate } from "react-router"

import { useDataset, useDistribution } from "~/lib/api/queries"
import type { Element } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel, organismLabel } from "~/lib/labels"
import { MATRIX_PRESETS, QUESTION_PRESETS } from "~/lib/presets"
import { workspaceSearch } from "~/lib/workspace-state"
import { Card, Clickable, SectionLabel } from "~/ui"

const PREVIEW_FIELDS = ["library_strategy", "organism_id", "disease"] as const

export const LandingPage = () => {
  const dataset = useDataset()
  const totals = dataset.data?.totals
  return (
    <div className="mx-auto w-full max-w-content-max flex-1 px-page-gutter pt-12 pb-16">
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-12">
        <div>
          <h1 className="mb-2.5 text-fs-h1 leading-tight font-bold tracking-h1 text-ink text-pretty">
            Search public sequencing samples by what the LLM read in their descriptions
          </h1>
          <p className="mb-7 max-w-xl text-fs-body text-ink-mid text-pretty">
            Cell lines, tissues, diseases, drugs, and gene perturbations extracted from BioSample attributes and mapped
            to ontology terms by bsllmner-mk2. Every annotation carries its mapping status, so you can tell an exact
            match from an LLM guess.
          </p>
          <div className="mb-8 grid grid-cols-3 gap-3">
            <TotalCard label="BioSamples" value={totals?.biosample} />
            <TotalCard label="Experiments" value={totals?.experiment} />
            <TotalCard label="BioProjects" value={totals?.bioproject} />
          </div>
          <div className="mb-2.5">
            <SectionLabel trailing="— click to open the workspace with the condition and axes set">Start from a matrix</SectionLabel>
          </div>
          <div className="mb-7 grid grid-cols-2 gap-2.5">
            {MATRIX_PRESETS.map((preset) => (
              <Link
                key={preset.id}
                to={`/w${workspaceSearch(preset.state)}`}
                className="flex items-center justify-between gap-3 rounded-card border border-border-soft bg-surface px-4 py-3.5 text-ink no-underline shadow-card hover:border-brand hover:bg-brand-soft hover:shadow-card-hover"
              >
                <span className="min-w-0">
                  <span className="block text-fs-body font-semibold">{preset.title}</span>
                  <span className="mt-0.5 block text-fs-label text-ink-soft">{preset.description}</span>
                </span>
                <span className="shrink-0 text-fs-label font-semibold whitespace-nowrap text-brand">Open heatmap →</span>
              </Link>
            ))}
          </div>
          <div className="mb-2.5">
            <SectionLabel>Or ask a question</SectionLabel>
          </div>
          <div className="flex flex-col gap-1.5">
            {QUESTION_PRESETS.map((preset) => (
              <Link
                key={preset.id}
                to={`/w${workspaceSearch(preset.state)}`}
                className="flex items-center justify-between gap-3 rounded-button border border-border-soft bg-surface px-3.5 py-2.5 text-ink no-underline hover:border-brand hover:bg-brand-soft"
              >
                <span className="text-fs-body">{preset.title}</span>
                <span className="text-fs-label font-semibold whitespace-nowrap text-brand">Open {preset.description} →</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <SectionLabel>Whole dataset</SectionLabel>
          {PREVIEW_FIELDS.map((field) => (
            <PreviewCard key={field} field={field} />
          ))}
          <div className="px-0.5 py-1 text-fs-label text-ink-soft">Click any bar to start a condition. Counts are BioSamples.</div>
        </div>
      </div>
    </div>
  )
}

const TotalCard = ({ label, value }: { label: string; value: number | undefined }) => (
  <Card>
    <SectionLabel>{label}</SectionLabel>
    <div className="mt-1 font-mono text-fs-total font-semibold text-ink">{value === undefined ? "…" : formatCount(value)}</div>
  </Card>
)

const PreviewCard = ({ field }: { field: (typeof PREVIEW_FIELDS)[number] }) => {
  const navigate = useNavigate()
  const distribution = useDistribution({ field, q: null, unit: "biosample", selfExclusion: true, limit: field === "organism_id" ? 2 : 3 })
  const elements: Element[] = distribution.data?.elements ?? []
  const max = Math.max(1, ...elements.map((e) => e.count))
  return (
    <Card padding="sm">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-semibold">{fieldLabel(field)}</span>
        <span className="text-fs-micro text-ink-soft">BioSamples</span>
      </div>
      {elements.map((element) => (
        <Clickable
          key={element.value}
          onClick={() => navigate(`/w${workspaceSearch({ q: clauseToQ(element) })}`)}
          className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_72px] items-center gap-2 rounded-tag py-0.5 text-left hover:bg-brand-soft"
        >
          <span className="min-w-0">
            <span className="block truncate text-fs-body-sm">{field === "organism_id" ? organismLabel(element.value, element.label) : element.label}</span>
            <span className="mt-0.5 block h-1.5 overflow-hidden rounded-badge bg-brand-soft">
              <span className="block h-full bg-brand-light" style={{ width: `${(element.count / max) * 100}%` }} />
            </span>
          </span>
          <span className="text-right font-mono text-fs-label text-ink-mid">{formatCount(element.count)}</span>
        </Clickable>
      ))}
    </Card>
  )
}

const clauseToQ = (element: Element): string => {
  const clause = element.clauses[0]
  if (!clause) return ""
  if (clause.from !== undefined && clause.to !== undefined) return `${clause.field}:[${clause.from} TO ${clause.to}]`
  const value = clause.value ?? ""
  return /^[A-Za-z0-9_\-.]+$/.test(value) ? `${clause.field}:${value}` : `${clause.field}:"${value}"`
}
