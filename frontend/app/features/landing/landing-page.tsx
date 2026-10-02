import { Link, useNavigate } from "react-router"

import { selectElement, useDataset, useDistribution, useParsedCondition } from "~/lib/api/queries"
import type { AstNode, Element, Unit } from "~/lib/api/types"
import { conditionLabels } from "~/lib/condition-labels"
import { formatCount } from "~/lib/format"
import { fieldLabel, organismLabel, unitLabel } from "~/lib/labels"
import { MATRIX_PRESETS, type Preset, QUESTION_PRESETS } from "~/lib/presets"
import { workspaceSearch } from "~/lib/workspace-state"
import { ACTION_ICON, Caption, Card, Clickable, ExternalLink, Icon, PageHeading, SectionHeading, Tag } from "~/ui"

import { TermSearch } from "./term-search"

const STATISTICS_FIELDS = ["library_strategy", "organism_id"] as const
const MK2_URL = "https://github.com/dbcls/bsllmner-mk2"

export const LandingPage = () => {
  const dataset = useDataset()
  const totals = dataset.data?.totals
  return (
    <div className="mx-auto w-full max-w-content-max flex-1 px-page-gutter py-8">
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-6">
        <Card padding="lg">
          <PageHeading rule="edge">bsllmner-viewer: Ontology-annotated BioSamples</PageHeading>
          <p className="mt-3 mb-8 max-w-2xl text-fs-body text-ink-mid text-pretty">
            Search BioSamples by the ontology terms that annotate them, and compare the results in tables and charts.{" "}
            <ExternalLink href={MK2_URL}>bsllmner-mk2</ExternalLink> uses a large language model (LLM) to extract values such as the cell line,
            the tissue, and the disease from the attributes of each BioSample. Then bsllmner-mk2 maps each value to an ontology term.
          </p>
          <div className="mb-3">
            <SectionHeading>Search by ontology terms</SectionHeading>
          </div>
          <TermSearch />
          <div className="mt-9 mb-3">
            <SectionHeading>Example questions</SectionHeading>
          </div>
          <PresetLinks presets={QUESTION_PRESETS} detail="values" />
        </Card>
        <div className="flex flex-col gap-6">
          <Card padding="lg">
            <SectionHeading>Statistics</SectionHeading>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Total unit="biosample" value={totals?.biosample} />
              <Total unit="sra-experiment" value={totals?.experiment} />
              <Total unit="bioproject" value={totals?.bioproject} />
            </div>
            {STATISTICS_FIELDS.map((field) => (
              <FieldStatistics key={field} field={field} />
            ))}
          </Card>
          <Card padding="lg">
            <div className="mb-3">
              <SectionHeading>Example heatmaps</SectionHeading>
            </div>
            <PresetLinks presets={MATRIX_PRESETS} detail="description" />
          </Card>
        </div>
      </div>
    </div>
  )
}

/** How an example is told apart from the others under its title: the values of its condition, or one sentence about what it shows. */
type PresetDetail = "values" | "description"

const PresetLinks = ({ presets, detail }: { presets: Preset[]; detail: PresetDetail }) => (
  <div className="flex flex-col gap-1.5">
    {presets.map((preset) => (
      <PresetLink key={preset.id} preset={preset} detail={detail} />
    ))}
  </div>
)

/** An example: its title and its detail, linked to the workspace in the state it describes. */
const PresetLink = ({ preset, detail }: { preset: Preset; detail: PresetDetail }) => {
  const parsed = useParsedCondition(detail === "values" ? (preset.state.q ?? null) : null)
  const values = parsed.data ? conditionLabels(parsed.data.ast as AstNode, parsed.data.labels) : []
  return (
    <Link
      to={`/entries${workspaceSearch(preset.state)}`}
      className="flex items-center gap-3 rounded-button border border-border-soft bg-surface px-3.5 py-2.5 text-ink no-underline hover:border-brand hover:bg-brand-soft"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-fs-body">{preset.title}</span>
        {detail === "values" && values.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {values.map((value) => (
              <Tag key={value}>{value}</Tag>
            ))}
          </span>
        )}
        {detail === "description" && preset.description && (
          <span className="mt-0.5 block text-fs-body-sm text-ink-soft">{preset.description}</span>
        )}
      </span>
      <Icon name={ACTION_ICON.goTo} className="text-brand" />
    </Link>
  )
}

const Total = ({ unit, value }: { unit: Unit; value: number | undefined }) => (
  <div>
    <Caption>{unitLabel(unit)}</Caption>
    <div className="mt-0.5 font-mono text-fs-h2 font-semibold text-ink">{value === undefined ? "…" : formatCount(value)}</div>
  </div>
)

const FieldStatistics = ({ field }: { field: (typeof STATISTICS_FIELDS)[number] }) => {
  const navigate = useNavigate()
  const distribution = useDistribution({ field, q: null, unit: "biosample", selfExclusion: true, limit: field === "organism_id" ? 2 : 3 })
  const elements: Element[] = distribution.data?.elements ?? []
  const max = Math.max(1, ...elements.map((e) => e.count))
  const open = async (element: Element) => {
    const condition = await selectElement({ q: null, clauses: element.clauses })
    await navigate(`/entries${workspaceSearch({ q: condition.dsl })}`)
  }
  return (
    <div className="mt-4 border-t border-border-soft pt-3.5">
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
    </div>
  )
}
