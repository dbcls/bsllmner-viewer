import { useState } from "react"
import { Link, useSearchParams } from "react-router"

import { ApiError } from "~/lib/api/client"
import { useDataset, useEntry } from "~/lib/api/queries"
import type { EntryResponse, Evidence } from "~/lib/api/types"
import { assayDotClass } from "~/lib/assays"
import { fieldLabel, statusInfo } from "~/lib/labels"
import { Caption, Card, cn, ExternalLink, Skeleton, StatusPill, Tag } from "~/ui"

import { evidenceContext, segmentText } from "./evidence"
import { backHref, bioprojectHref, termHref } from "./links"

type SamplePageProps = {
  accession: string
}

type EntryAttribute = EntryResponse["attributes"][number]
type EntryAnnotation = EntryResponse["annotations"][number]
type EntryExperiment = EntryResponse["experiments"][number]
type EntryBioProject = EntryResponse["bioprojects"][number]

/** BioSample detail: original attributes traced against the annotations extracted from them. */
export const SamplePage = ({ accession }: SamplePageProps) => {
  const [searchParams] = useSearchParams()
  const from = searchParams.get("from")
  const entry = useEntry(accession)
  const dataset = useDataset()
  const targetAssays = dataset.data?.targetAssays ?? []
  const [highlighted, setHighlighted] = useState<string | null>(null)

  if (!entry.data && !entry.isError) {
    return <SampleSkeleton accession={accession} back={backHref(from)} annotationRows={dataset.data?.fields.length ?? SKELETON_ANNOTATIONS} />
  }

  if (!entry.data) {
    const notFound = entry.error instanceof ApiError && entry.error.problem.status === 404
    return (
      <div className="mx-auto w-full max-w-content-max px-page-gutter py-4">
        <BackLink href={backHref(from)} />
        <div className="mt-3">
          <Card>
            <Caption>BioSample</Caption>
            <div className="mt-0.5 font-mono text-fs-h1 font-semibold tracking-h1 text-ink">{accession}</div>
            <div className="mt-1.5 text-fs-body-sm text-ink-soft">
              {notFound ? `BioSample ${accession} is not in the dataset.` : "Something went wrong loading this BioSample."}
            </div>
          </Card>
        </div>
      </div>
    )
  }

  const data = entry.data

  return (
    <div className="mx-auto w-full max-w-content-max px-page-gutter py-4">
      <BackLink href={backHref(from)} />
      <div className="mt-3 mb-4">
        <Card>
          <div className="flex items-start justify-between gap-6">
            <div>
              <Caption>BioSample</Caption>
              <div className="mt-0.5 font-mono text-fs-h1 font-semibold tracking-h1 text-ink">{data.identifier}</div>
              {data.title && <div className="mt-1.5 text-fs-h2 text-ink">{data.title}</div>}
              <div className="mt-1.5 flex gap-3.5 text-fs-body-sm text-ink-soft">
                {data.organism?.name && <span>{data.organism.name}</span>}
                {data.datePublished && (
                  <span>
                    Published <span className="font-mono">{data.datePublished}</span>
                  </span>
                )}
              </div>
            </div>
            <EntryLinks accession={data.identifier} />
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-[2fr_3fr] items-start gap-4">
        <OriginalAttributes entry={data} highlighted={highlighted} />
        <Annotations entry={data} highlighted={highlighted} onHighlight={setHighlighted} />
      </div>
      <div className="mt-4 grid grid-cols-[3fr_2fr] items-start gap-4">
        <ExperimentsCard experiments={data.experiments} targetAssays={targetAssays} />
        <BioProjectsCard bioprojects={data.bioprojects} />
      </div>
    </div>
  )
}

const EntryLinks = ({ accession }: { accession: string }) => (
  <div className="flex shrink-0 gap-2">
    <ExternalLink kind="button" href={`https://ddbj.nig.ac.jp/search/entry/biosample/${accession}`}>
      DDBJ Search
    </ExternalLink>
    <ExternalLink kind="button" href={`https://www.ncbi.nlm.nih.gov/biosample/${accession}`}>
      NCBI BioSample
    </ExternalLink>
  </div>
)

/** The annotation rows drawn before the description of the dataset arrives, on the first visit only. */
const SKELETON_ANNOTATIONS = 6

type SampleSkeletonProps = {
  accession: string
  back: string
  annotationRows: number
}

/** The page before the BioSample arrives: what the accession alone gives, and every card with skeleton rows. */
const SampleSkeleton = ({ accession, back, annotationRows }: SampleSkeletonProps) => (
  <div aria-busy="true" className="mx-auto w-full max-w-content-max px-page-gutter py-4">
    <BackLink href={back} />
    <div className="mt-3 mb-4">
      <Card>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <Caption>BioSample</Caption>
            <div className="mt-0.5 font-mono text-fs-h1 font-semibold tracking-h1 text-ink">{accession}</div>
            <div className="mt-1.5 text-fs-h2">
              <Skeleton className="w-96" />
            </div>
            <div className="mt-1.5 text-fs-body-sm">
              <Skeleton className="w-56" />
            </div>
          </div>
          <EntryLinks accession={accession} />
        </div>
      </Card>
    </div>
    <div className="grid grid-cols-[2fr_3fr] items-start gap-4">
      <SkeletonCard title="Original attributes" rows={6} />
      <SkeletonCard title="Annotations" rows={annotationRows} />
    </div>
    <div className="mt-4 grid grid-cols-[3fr_2fr] items-start gap-4">
      <SkeletonCard title="SRA Experiments" rows={2} />
      <SkeletonCard title="BioProject" rows={2} />
    </div>
  </div>
)

const SkeletonCard = ({ title, rows }: { title: string; rows: number }) => (
  <Card>
    <div className="mb-2 font-semibold">{title}</div>
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="border-b border-brand-soft py-2 text-fs-body-sm">
        <Skeleton className="w-3/4" />
      </div>
    ))}
  </Card>
)

const BackLink = ({ href }: { href: string }) => (
  <Link to={href} className="text-fs-body-sm text-brand no-underline hover:text-brand-deep">
    ← Back to results
  </Link>
)

type AttributeRow = { key: string; value: string; index: number }

const OriginalAttributes = ({ entry, highlighted }: { entry: EntryResponse; highlighted: string | null }) => {
  const rows: AttributeRow[] = [
    { key: "title", value: entry.title ?? "", index: -1 },
    ...entry.attributes.map((attribute: EntryAttribute, index: number) => ({ key: attribute.name, value: attribute.value, index })),
  ]
  return (
    <Card>
      <div className="mb-2 font-semibold">Original attributes</div>
      {rows.map((row) => (
        <AttributeRowView key={row.index} row={row} annotations={entry.annotations} highlighted={highlighted} />
      ))}
      <div className="mt-2 text-fs-micro text-ink-soft">
        As submitted to BioSample.{" "}
        <mark className="rounded-badge border-b-2 border-brand-light bg-brand-tint px-0.5 text-ink">Highlighted</mark> text is where an extracted
        value was found; hover an annotation on the right to trace it.
      </div>
    </Card>
  )
}

const AttributeRowView = ({
  row,
  annotations,
  highlighted,
}: {
  row: AttributeRow
  annotations: EntryAnnotation[]
  highlighted: string | null
}) => {
  const evidences = annotations.flatMap((annotation) => annotation.evidence.filter((evidence) => evidence.attributeIndex === row.index))
  const fields = new Set(
    annotations.filter((annotation) => annotation.evidence.some((evidence) => evidence.attributeIndex === row.index)).map((a) => a.field),
  )
  const isHighlighted = highlighted !== null && fields.has(highlighted)
  const segments = segmentText(row.value, evidences)
  return (
    <div
      className={cn(
        "grid grid-cols-[130px_1fr] gap-2.5 rounded-tag border-b border-brand-soft px-1.5 py-1.5 text-fs-body-sm",
        isHighlighted && "bg-selection-soft",
      )}
    >
      <span className="font-mono text-fs-label break-all text-ink-soft">{row.key}</span>
      <span className="text-pretty">
        {segments.map((segment, index) =>
          segment.matched ? (
            <mark
              key={index}
              className={cn(
                "rounded-badge border-b-2 px-0.5 font-semibold text-ink",
                isHighlighted ? "border-selection bg-selection-mid" : "border-brand-light bg-brand-tint",
              )}
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </span>
    </div>
  )
}

type AnnotationsProps = {
  entry: EntryResponse
  highlighted: string | null
  onHighlight: (field: string | null) => void
}

const Annotations = ({ entry, highlighted, onHighlight }: AnnotationsProps) => (
  <Card>
    <div className="mb-2 flex items-center justify-between">
      <span className="font-semibold">Annotations</span>
      <span className="text-fs-micro text-ink-soft">
        bsllmner-mk2 · <span className="font-mono">{entry.run}</span>
      </span>
    </div>
    {entry.annotations.map((annotation) => (
      <AnnotationRow key={annotation.field} entry={entry} annotation={annotation} highlighted={highlighted} onHighlight={onHighlight} />
    ))}
    <div className="mt-2 text-fs-micro text-ink-soft">
      Click a term to search for other samples with it. Exact match: the value matched a label or a synonym of the term. LLM selected: the
      LLM chose the term from candidates. No candidate: the ontology has no similar term. Rejected: candidates existed, but none was adopted.
      Not stated: no value was extracted. Extraction failed: the output of the LLM could not be read.
    </div>
  </Card>
)

const evidenceSource = (entry: EntryResponse, evidence: Evidence): string =>
  evidence.attributeIndex === -1 ? (entry.title ?? "") : (entry.attributes[evidence.attributeIndex]?.value ?? "")

const AnnotationRow = ({
  entry,
  annotation,
  highlighted,
  onHighlight,
}: {
  entry: EntryResponse
  annotation: EntryAnnotation
  highlighted: string | null
  onHighlight: (field: string | null) => void
}) => {
  const info = statusInfo(annotation.status)
  return (
    <div
      onMouseEnter={() => onHighlight(annotation.field)}
      onMouseLeave={() => onHighlight(null)}
      className={cn(
        "grid grid-cols-[130px_1fr_150px] items-center gap-x-2.5 gap-y-1 rounded-tag border-b border-brand-soft px-1.5 py-1.5 text-fs-body-sm hover:bg-brand-soft",
        highlighted === annotation.field && "bg-selection-soft",
      )}
    >
      <span className="text-ink-mid">{fieldLabel(annotation.field)}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={annotation.value ? "text-ink" : "text-ink-soft"}>{annotation.value ? `“${annotation.value}”` : "—"}</span>
        {annotation.termId && (
          <>
            <span className="text-ink-soft">→</span>
            <Link to={termHref(annotation.field, annotation.termId)} className="text-brand no-underline hover:text-brand-deep">
              {annotation.label}
            </Link>
            <span className="font-mono text-fs-micro text-ink-soft">{annotation.termId}</span>
          </>
        )}
      </span>
      <StatusPill status={annotation.status} label={info.label} />
      {annotation.evidence.length > 0 && (
        <div className="col-span-2 col-start-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-fs-label text-ink-soft">
          <span className="text-fs-micro font-semibold">
            {annotation.evidence.length > 1 ? `Found in ${annotation.evidence.length} attributes` : "Found in"}
          </span>
          {annotation.evidence.map((evidence, index) => {
            const context = evidenceContext(evidenceSource(entry, evidence), evidence.start, evidence.end)
            return (
              <span key={index}>
                <span className="font-mono text-fs-micro">{evidence.attribute}</span>: {context.pre}
                <mark className="rounded-badge border-b-2 border-brand-light bg-brand-tint px-0.5 font-semibold text-ink">{context.match}</mark>
                {context.post}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ExperimentsCard = ({ experiments, targetAssays }: { experiments: EntryExperiment[]; targetAssays: readonly string[] }) => (
  <Card>
    <div className="mb-2 font-semibold">SRA Experiments</div>
    <table className="w-full border-collapse text-fs-body-sm">
      <thead>
        <tr>
          <th className="border-b border-border-soft px-2 py-1.5 text-left text-fs-label font-semibold text-ink-soft">
            Accession
          </th>
          <th className="border-b border-border-soft px-2 py-1.5 text-left text-fs-label font-semibold text-ink-soft">
            Assay
          </th>
          <th className="border-b border-border-soft px-2 py-1.5 text-right text-fs-label font-semibold text-ink-soft">
            SRA Runs
          </th>
          <th className="border-b border-border-soft px-2 py-1.5 text-left text-fs-label font-semibold text-ink-soft">
            Links
          </th>
        </tr>
      </thead>
      <tbody>
        {experiments.map((experiment) => (
          <tr
            key={experiment.accession}
            title={experiment.inPopulation ? undefined : "Not in the population (assay outside the target assays)"}
          >
            <td className="border-b border-brand-soft px-2 py-1.5 font-mono text-fs-label">{experiment.accession}</td>
            <td className="border-b border-brand-soft px-2 py-1.5">
              {experiment.libraryStrategy &&
                (experiment.inPopulation ? (
                  <Tag dot={assayDotClass(experiment.libraryStrategy, targetAssays)}>{experiment.libraryStrategy}</Tag>
                ) : (
                  <span className="text-fs-label text-ink-soft">{experiment.libraryStrategy}</span>
                ))}
            </td>
            <td className="border-b border-brand-soft px-2 py-1.5 text-right font-mono text-fs-label">{experiment.runs.length}</td>
            <td className="border-b border-brand-soft px-2 py-1.5 text-fs-label">
              <ExternalLink href={`https://ddbj.nig.ac.jp/search/entry/sra-experiment/${experiment.accession}`}>DDBJ</ExternalLink>
              {experiment.chipAtlas.length > 0 && (
                <>
                  {" · "}
                  <ExternalLink href={`https://chip-atlas.org/view?id=${experiment.accession}`}>ChIP-Atlas</ExternalLink>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
)

const BioProjectsCard = ({ bioprojects }: { bioprojects: EntryBioProject[] }) => (
  <Card>
    <div className="mb-2 font-semibold">BioProject</div>
    {bioprojects.length === 0 && <div className="text-fs-body-sm text-ink-soft">No linked BioProject.</div>}
    {bioprojects.map((bioproject, index) => (
      <div key={bioproject.accession} className={index > 0 ? "mt-3" : undefined}>
        <Link to={bioprojectHref(bioproject.accession)} className="font-mono text-fs-body-sm text-brand no-underline hover:text-brand-deep">
          {bioproject.accession}
        </Link>
        <div className="mt-1 text-fs-body-sm text-ink-mid">{bioproject.title}</div>
        <div className="mt-1.5 text-fs-micro text-ink-soft">Click to restrict the condition to this project.</div>
      </div>
    ))}
  </Card>
)
