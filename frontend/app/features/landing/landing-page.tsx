import { Link, useNavigate } from "react-router"

import { selectElement, useDataset, useDistribution } from "~/lib/api/queries"
import type { Element } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel, organismLabel } from "~/lib/labels"
import { MATRIX_PRESETS, QUESTION_PRESETS } from "~/lib/presets"
import { workspaceSearch } from "~/lib/workspace-state"
import { Caption, Card, Clickable, ExternalLink, PageHeading, SectionHeading } from "~/ui"

import { TermSearch } from "./term-search"

const STATISTICS_FIELDS = ["library_strategy", "organism_id"] as const
const MK2_URL = "https://github.com/dbcls/bsllmner-mk2"

export const LandingPage = () => {
  const dataset = useDataset()
  const totals = dataset.data?.totals
  return (
    <div className="mx-auto w-full max-w-content-max flex-1 px-page-gutter pt-12 pb-16">
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-12">
        <div>
          <PageHeading>Ontology-annotated BioSamples</PageHeading>
          <p className="mt-3 mb-8 max-w-2xl text-fs-body text-ink-mid text-pretty">
            This site contains human and mouse BioSamples that have RNA-Seq, ChIP-Seq, or ATAC-seq experiments.{" "}
            <ExternalLink href={MK2_URL}>bsllmner-mk2</ExternalLink> uses a large language model (LLM) to extract values such as the cell line,
            the tissue, the disease, the drug, and the knockout gene from the attributes of each BioSample. bsllmner-mk2 maps each value to an
            ontology term. Each annotation shows whether the term is an exact match or a term that the LLM selected.
          </p>
          <div className="mb-3">
            <SectionHeading>Search by ontology terms</SectionHeading>
          </div>
          <TermSearch />
          <div className="mt-9 mb-3">
            <SectionHeading>Example questions</SectionHeading>
          </div>
          <div className="flex flex-col gap-1.5">
            {QUESTION_PRESETS.map((preset) => (
              <Link
                key={preset.id}
                to={`/w${workspaceSearch(preset.state)}`}
                className="flex items-center justify-between gap-3 rounded-button border border-border-soft bg-surface px-3.5 py-2.5 text-ink no-underline hover:border-brand hover:bg-brand-soft"
              >
                <span className="text-fs-body">{preset.title}</span>
                <span aria-hidden="true" className="text-brand">→</span>
              </Link>
            ))}
          </div>
          <div className="mt-9 mb-3">
            <SectionHeading>Example heatmaps</SectionHeading>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {MATRIX_PRESETS.map((preset) => (
              <Link
                key={preset.id}
                to={`/w${workspaceSearch(preset.state)}`}
                className="flex items-center justify-between gap-3 rounded-button border border-border-soft bg-surface px-3.5 py-2.5 text-ink no-underline hover:border-brand hover:bg-brand-soft"
              >
                <span className="text-fs-body">{preset.title}</span>
                <span aria-hidden="true" className="text-brand">→</span>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-3">
            <SectionHeading>Statistics</SectionHeading>
          </div>
          <div className="flex flex-col gap-3">
            <Card padding="sm">
              <div className="grid grid-cols-3 gap-3">
                <Total label="BioSamples" value={totals?.biosample} />
                <Total label="Experiments" value={totals?.experiment} />
                <Total label="BioProjects" value={totals?.bioproject} />
              </div>
            </Card>
            {STATISTICS_FIELDS.map((field) => (
              <StatisticsCard key={field} field={field} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const Total = ({ label, value }: { label: string; value: number | undefined }) => (
  <div>
    <Caption>{label}</Caption>
    <div className="mt-0.5 font-mono text-fs-h2 font-semibold text-ink">{value === undefined ? "…" : formatCount(value)}</div>
  </div>
)

const StatisticsCard = ({ field }: { field: (typeof STATISTICS_FIELDS)[number] }) => {
  const navigate = useNavigate()
  const distribution = useDistribution({ field, q: null, unit: "biosample", selfExclusion: true, limit: field === "organism_id" ? 2 : 3 })
  const elements: Element[] = distribution.data?.elements ?? []
  const max = Math.max(1, ...elements.map((e) => e.count))
  const open = async (element: Element) => {
    const condition = await selectElement({ q: null, clauses: element.clauses })
    await navigate(`/w${workspaceSearch({ q: condition.q })}`)
  }
  return (
    <Card padding="sm">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-semibold">{fieldLabel(field)}</span>
        <span className="text-fs-micro text-ink-soft">BioSamples</span>
      </div>
      {elements.map((element) => (
        <Clickable
          key={element.value}
          onClick={() => void open(element)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-tag py-0.5 text-left hover:bg-brand-soft"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-fs-body-sm">{field === "organism_id" ? organismLabel(element.value, element.label) : element.label}</span>
            <span className="mt-0.5 block h-1.5 overflow-hidden rounded-badge bg-brand-soft">
              <span className="block h-full bg-brand-light" style={{ width: `${(element.count / max) * 100}%` }} />
            </span>
          </span>
          <span className="w-17 shrink-0 text-right font-mono text-fs-label text-ink-mid">{formatCount(element.count)}</span>
        </Clickable>
      ))}
    </Card>
  )
}
