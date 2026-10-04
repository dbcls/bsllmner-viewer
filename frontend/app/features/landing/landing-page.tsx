import { Link } from "react-router"

import { loadFailureProps } from "~/lib/api/client"
import { queryFailed, useDataset } from "~/lib/api/queries"
import type { Clause, DatasetResponse, Unit } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel, organismLabel, unitLabel } from "~/lib/labels"
import { MATRIX_PRESETS, type Preset, QUESTION_PRESETS } from "~/lib/presets"
import { crawlRel, SITE_DESCRIPTION, SITE_NAME, SITE_PURPOSE } from "~/lib/site"
import { workspaceSearch } from "~/lib/workspace-state"
import { ACTION_ICON, Caption, Card, ErrorNotice,ExternalLink, Icon, PageHeading, PageMeta, SectionHeading, Skeleton, Tag } from "~/ui"

import { ConditionLink } from "./condition-link"
import { CountBar, countBarRowClass, CountBarSkeleton } from "./count-bar"
import { DATASET_NAME, datasetSchema } from "./dataset-schema"
import { TermSearch } from "./term-search"

const STATISTICS_FIELDS = ["library_strategy", "organism_id"] as const
const MK2_URL = "https://github.com/dbcls/bsllmner-mk2"

export const LandingPage = () => {
  const dataset = useDataset()
  const totals = dataset.data?.totals
  return (
    <main id="main" className="mx-auto w-full max-w-content-max flex-1 px-page-gutter py-4">
      <PageMeta title={SITE_NAME} description={SITE_DESCRIPTION} canonicalPath="/" />
      {dataset.data && <DatasetSchema dataset={dataset.data} />}
      <div className="grid grid-cols-landing items-start gap-4">
        <Card padding="lg">
          <PageHeading>{`${SITE_NAME}: ${DATASET_NAME}`}</PageHeading>
          <p className="mt-3 mb-8 max-w-2xl text-fs-body text-ink-mid text-pretty">
            {SITE_PURPOSE}{" "}
            <ExternalLink kind="inline" href={MK2_URL}>bsllmner-mk2</ExternalLink> reads the attributes of each BioSample with a large language model (LLM).
            It extracts values such as the cell line, the tissue, and the disease, and then maps each value to an ontology term.
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
        <div className="flex flex-col gap-4">
          <Card padding="lg">
            <SectionHeading>Statistics</SectionHeading>
            {queryFailed(dataset) ? (
              <ErrorNotice {...loadFailureProps(dataset.error, "load the dataset statistics", () => void dataset.refetch())} className="mt-4" />
            ) : (
              <>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Total unit="biosample" value={totals?.biosample} />
                  <Total unit="sra-experiment" value={totals?.experiment} />
                  <Total unit="bioproject" value={totals?.bioproject} />
                </div>
                {STATISTICS_FIELDS.map((field) => (
                  <FieldStatistics key={field} field={field} />
                ))}
              </>
            )}
          </Card>
          <Card padding="lg">
            <div className="mb-3">
              <SectionHeading>Example heatmaps</SectionHeading>
            </div>
            <PresetLinks presets={MATRIX_PRESETS} detail="description" />
          </Card>
        </div>
      </div>
    </main>
  )
}

/** The schema.org Dataset of the page, which dataset search engines read. The browser does not run it. */
const DatasetSchema = ({ dataset }: { dataset: DatasetResponse }) => (
  <script type="application/ld+json">{JSON.stringify(datasetSchema(dataset, globalThis.location.origin))}</script>
)

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
  const values = preset.values ?? []
  const href = `/entries${workspaceSearch(preset.state)}`
  return (
    <Link
      to={href}
      rel={crawlRel(href)}
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
    <div className="mt-0.5 font-mono text-fs-h2 font-semibold text-ink">{value === undefined ? <Skeleton className="w-24" /> : formatCount(value)}</div>
  </div>
)

/** A bar of the statistics: a value of a field of the whole dataset, its BioSamples, and the clause that selects it. */
type StatisticsBar = { value: string; label: string; count: number; clauses: Clause[] }

/** The bars of a field of the statistics, from the counts of the whole dataset that build made, in descending order. */
const statisticsBars = (field: (typeof STATISTICS_FIELDS)[number], dataset: DatasetResponse): StatisticsBar[] =>
  field === "library_strategy"
    ? dataset.assays.map(({ name, biosampleCount }) => ({ value: name, label: name, count: biosampleCount, clauses: [{ field, value: name }] }))
    : dataset.organisms.map(({ identifier, name, biosampleCount }) => ({
      value: identifier,
      label: organismLabel(identifier, name),
      count: biosampleCount,
      clauses: [{ field, value: identifier }],
    }))

const FieldStatistics = ({ field }: { field: (typeof STATISTICS_FIELDS)[number] }) => {
  const limit = field === "organism_id" ? 2 : 3
  const dataset = useDataset()
  const elements = dataset.data ? statisticsBars(field, dataset.data).slice(0, limit) : []
  const max = Math.max(1, ...elements.map((e) => e.count))
  return (
    <div className="mt-4 border-t border-border-soft pt-3.5">
      <div className="mb-1.5 font-semibold">{fieldLabel(field)}</div>
      {dataset.data === undefined && Array.from({ length: limit }, (_, index) => <CountBarSkeleton key={index} padding="sm" />)}
      {elements.map((element) => (
        <ConditionLink key={element.value} clauses={element.clauses} className={countBarRowClass("sm")}>
          <CountBar label={element.label} count={formatCount(element.count)} ratio={element.count / max} />
        </ConditionLink>
      ))}
    </div>
  )
}
