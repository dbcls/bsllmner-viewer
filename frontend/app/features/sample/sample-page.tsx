import { Fragment, type ReactNode, useState } from "react"
import { Link, useLocation } from "react-router"

import { isClientError, loadFailureProps } from "~/lib/api/client"
import { useDataset, useEntry } from "~/lib/api/queries"
import type { EntryResponse } from "~/lib/api/types"
import { assayDotClass } from "~/lib/assays"
import { backHref } from "~/lib/back-link"
import { chipAtlasHref, ddbjSearchHref, ncbiHref, taxonomyHref } from "~/lib/external-links"
import { fieldLabel, hasStatusValue, statusInfo, VALUE_STATUSES } from "~/lib/labels"
import { crawlRel, ENTRIES_SECTION, pageTitle } from "~/lib/site"
import { Card, cn, ErrorNotice,ExternalLink, HelpHint, PageHeading, PageMeta, Pager, SectionHeading, Skeleton, StatusMeanings, StatusPill, Tag } from "~/ui"

import { entryDescription } from "./entry-description"
import { segmentText, type Span } from "./evidence"
import { TermPopover } from "./term-popover"

type SamplePageProps = {
  accession: string
}

type EntryMetadata = EntryResponse["metadata"][number]
type EntryAnnotation = EntryResponse["annotations"][number]
type EntryExperiment = EntryResponse["experiments"][number]
type EntryBioProject = EntryResponse["bioprojects"][number]

/** BioSample detail: the original metadata traced against the annotations extracted from it. */
export const SamplePage = ({ accession }: SamplePageProps) => {
  const back = backHref(useLocation().state)
  const entry = useEntry(accession)
  const dataset = useDataset()
  const targetAssays = dataset.data?.targetAssays ?? []
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const title = pageTitle(accession, ENTRIES_SECTION)

  if (!entry.data && !entry.isError) {
    return (
      <>
        <PageMeta title={title} />
        <SampleSkeleton accession={accession} back={back} annotationRows={dataset.data?.fields.length ?? SKELETON_ANNOTATIONS} />
      </>
    )
  }

  if (!entry.data) {
    // A client error other than 429 means that the dataset has no BioSample with this accession. For example, the api
    // answers 404 for an unknown accession and 422 for an accession that is too long.
    const notFound = isClientError(entry.error) && entry.error.problem.status !== 429
    return (
      <PageFrame>
        <PageMeta title={title} noindex />
        <BackLink href={back} />
        <div className="mt-3">
          <Card padding="lg">
            <AccessionHeading accession={accession} />
            {notFound ? (
              <div className="mt-1.5 text-fs-body-sm text-ink-soft">BioSample {accession} is not in the dataset.</div>
            ) : (
              <ErrorNotice {...loadFailureProps(entry.error, "load this BioSample", () => void entry.refetch())} className="mt-3" />
            )}
          </Card>
        </div>
      </PageFrame>
    )
  }

  const data = entry.data

  return (
    <PageFrame>
      <PageMeta title={title} description={entryDescription(data)} canonicalPath={`/entries/${encodeURIComponent(data.identifier)}`} />
      <BackLink href={back} />
      <div className="mt-3 mb-4">
        <Card padding="lg">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <AccessionHeading accession={data.identifier} />
              {data.title && <div className="mt-1.5 text-fs-h2 text-ink">{data.title}</div>}
              <div className="mt-1.5 flex gap-3.5 text-fs-body-sm text-ink-soft">
                {data.organism?.name && <ExternalLink href={taxonomyHref(data.organism.identifier)}>{data.organism.name}</ExternalLink>}
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
      <div className="grid grid-cols-2 items-start gap-4">
        <OriginalMetadata entry={data} highlighted={highlighted} />
        <Annotations entry={data} highlighted={highlighted} onHighlight={setHighlighted} />
      </div>
      <div className="mt-4 grid grid-cols-2 items-start gap-4">
        {/* Keyed by the BioSample, so that another BioSample opens on the first page of each card. */}
        <BioProjectsCard key={`bioprojects:${data.identifier}`} bioprojects={data.bioprojects} />
        <ExperimentsCard key={`experiments:${data.identifier}`} experiments={data.experiments} targetAssays={targetAssays} />
      </div>
    </PageFrame>
  )
}

/** The frame of the page: centered at the content width, with the gutter of the pages. */
const PageFrame = ({ busy = false, children }: { busy?: boolean; children: ReactNode }) => (
  <main id="main" aria-busy={busy || undefined} className="mx-auto w-full max-w-content-max px-page-gutter py-4">
    {children}
  </main>
)

const EntryLinks = ({ accession }: { accession: string }) => (
  <div className="flex shrink-0 gap-2">
    <ExternalLink kind="button" href={ddbjSearchHref("biosample", accession)}>
      DDBJ Search
    </ExternalLink>
    <ExternalLink kind="button" href={ncbiHref("biosample", accession)}>
      NCBI BioSample
    </ExternalLink>
  </div>
)

/** The name of the page: the accession of the BioSample. */
const AccessionHeading = ({ accession }: { accession: string }) => (
  <PageHeading>
    <span className="font-mono">{accession}</span>
  </PageHeading>
)

type CardHeadingProps = {
  children: string
  /** A help button, right after the title. */
  help?: ReactNode
  /** A control at the right end of the line. */
  aside?: ReactNode
}

/** The heading of a card under the BioSample, with the space under it that every card keeps. */
const CardHeading = ({ children, help, aside }: CardHeadingProps) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <span className="flex items-center">
      <SectionHeading>{children}</SectionHeading>
      {help}
    </span>
    {aside}
  </div>
)

const TH = "border-b border-border-soft px-1.5 py-2 text-left text-fs-label font-semibold text-ink-soft"

/**
 * The cells of a row of a table of a card (a row is a `group`). The last row has no rule: the bottom edge of the card ends
 * the table.
 */
const TD = "border-b border-brand-soft px-1.5 py-1.5 group-last:border-b-0"

/** The rule under a row of a card that lists rows without a table. The last row has none, as in the tables. */
const ROW_RULE = "border-b border-brand-soft last:border-b-0"

/** The rows of a table of a card on one page. A BioSample can have tens of thousands of SRA Experiments. */
const CARD_PER_PAGE = 20

/**
 * The rows of a table of a card on the current page, and the pager for the heading, or nothing when every row fits on
 * one page. The page is the card's own state, not part of the URL. The pager is taller than the heading. The negative
 * margin removes the extra height, so that the tables of both cards start at the same height.
 */
const usePagedRows = <T,>(rows: readonly T[]): { shown: readonly T[]; pager: ReactNode } => {
  const [page, setPage] = useState(1)
  const shown = rows.slice((page - 1) * CARD_PER_PAGE, page * CARD_PER_PAGE)
  const pager = rows.length > CARD_PER_PAGE && (
    <div className="-my-1.5">
      <Pager page={page} perPage={CARD_PER_PAGE} total={rows.length} onChange={setPage} />
    </div>
  )
  return { shown, pager }
}

/** A table of a card under the BioSample: the headings of its columns over its rows. */
const CardTable = ({ columns, children }: { columns: readonly string[]; children: ReactNode }) => (
  <table className="w-full border-collapse text-fs-body-sm">
    <thead>
      <tr>
        {columns.map((column) => (
          <th key={column} className={TH}>
            {column}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
)

const BIOPROJECT_COLUMNS = ["Accession", "Title", "Links"] as const
const EXPERIMENT_COLUMNS = ["Accession", "Assay", "SRA Runs", "Links"] as const

/** The annotation rows drawn before the description of the dataset arrives, on the first visit only. */
const SKELETON_ANNOTATIONS = 6

type SampleSkeletonProps = {
  accession: string
  back: string
  annotationRows: number
}

/** The page before the BioSample arrives: what the accession alone gives, and every card with skeleton rows. */
const SampleSkeleton = ({ accession, back, annotationRows }: SampleSkeletonProps) => (
  <PageFrame busy>
    <BackLink href={back} />
    <div className="mt-3 mb-4">
      <Card padding="lg">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <AccessionHeading accession={accession} />
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
    <div className="grid grid-cols-2 items-start gap-4">
      <SkeletonMetadataCard />
      <SkeletonCard title="Annotations" rows={annotationRows} />
    </div>
    <div className="mt-4 grid grid-cols-2 items-start gap-4">
      <SkeletonTableCard title="BioProjects" columns={BIOPROJECT_COLUMNS} widths={["w-20", "w-48", "w-20"]} rows={2} />
      <SkeletonTableCard title="SRA Experiments" columns={EXPERIMENT_COLUMNS} widths={["w-20", "w-16", "w-6", "w-24"]} rows={2} />
    </div>
  </PageFrame>
)

const SkeletonRows = ({ rows }: { rows: number }) =>
  Array.from({ length: rows }, (_, index) => (
    <div key={index} className={cn(ROW_RULE, "py-2 text-fs-body-sm")}>
      <Skeleton className="w-3/4" />
    </div>
  ))

const SkeletonCard = ({ title, rows }: { title: string; rows: number }) => (
  <Card padding="lg">
    <CardHeading>{title}</CardHeading>
    <SkeletonRows rows={rows} />
  </Card>
)

/** The original metadata before it arrives: rows for the description, the heading of the attributes, and their rows. */
const SkeletonMetadataCard = () => (
  <Card padding="lg">
    <CardHeading>Original metadata</CardHeading>
    <SkeletonRows rows={2} />
    <AttributesHeading />
    <SkeletonRows rows={4} />
  </Card>
)

type SkeletonTableCardProps = {
  title: string
  columns: readonly string[]
  /** The width class of the skeleton in each column, near the width of the column's values. */
  widths: readonly string[]
  rows: number
}

/** A card with a table before the BioSample arrives: the headings of the columns, and rows of skeletons. */
const SkeletonTableCard = ({ title, columns, widths, rows }: SkeletonTableCardProps) => (
  <Card padding="lg">
    <CardHeading>{title}</CardHeading>
    <CardTable columns={columns}>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden="true" className="group">
          {widths.map((width, column) => (
            <td key={column} className={cn(TD, "text-fs-label")}>
              <Skeleton className={width} />
            </td>
          ))}
        </tr>
      ))}
    </CardTable>
  </Card>
)

const BackLink = ({ href }: { href: string }) => (
  <Link to={href} rel={crawlRel(href)} className="text-fs-body-sm text-brand no-underline hover:text-brand-deep">
    ← Back to Samples
  </Link>
)

/**
 * The heading over the attributes. The heading separates the attributes from the items that describe the whole
 * BioSample. The heading is bold text aligned with the row names and has no rule, so that the heading looks like a group
 * inside the card and not like another card heading.
 */
const AttributesHeading = () => <h3 className="mt-3 mb-1 px-1.5 text-fs-body-sm font-semibold text-ink">Attributes</h3>

/**
 * The metadata of the BioSample in the order the api gives it: the description (title, description paragraphs, and
 * names) and the fields of the record that evidence points to, then the attributes under their own heading.
 */
const OriginalMetadata = ({ entry, highlighted }: { entry: EntryResponse; highlighted: string | null }) => {
  const firstAttribute = entry.metadata.findIndex((item) => item.kind === "attribute")
  return (
    <Card padding="lg">
      <CardHeading>Original metadata</CardHeading>
      {entry.metadata.map((item, index) => (
        <Fragment key={index}>
          {index === firstAttribute && <AttributesHeading />}
          <MetadataRow item={item} index={index} annotations={entry.annotations} highlighted={highlighted} />
        </Fragment>
      ))}
    </Card>
  )
}

type MetadataRowProps = {
  item: EntryMetadata
  /** The position of the item in the metadata, which evidence points to. */
  index: number
  annotations: EntryAnnotation[]
  highlighted: string | null
}

/**
 * One item of the metadata, with the evidence of every annotation marked in its value, or in its name when the evidence
 * is in the name of an attribute. An attribute is named as it was submitted, in a monospace font; the description and
 * the record are named by the api in words.
 */
const MetadataRow = ({ item, index, annotations, highlighted }: MetadataRowProps) => {
  const marks = (inName: boolean) => {
    const evidenceOf = (annotation: EntryAnnotation) =>
      annotation.evidence.filter((evidence) => evidence.metadataIndex === index && evidence.inName === inName)
    return {
      spans: annotations.flatMap(evidenceOf),
      active: annotations.filter((annotation) => annotation.field === highlighted).flatMap(evidenceOf),
    }
  }
  const name = marks(true)
  const value = marks(false)
  return (
    <div
      className={cn(
        "grid grid-cols-metadata-row gap-2.5 rounded-tag px-1.5 py-1.5 text-fs-body-sm",
        ROW_RULE,
        (name.active.length > 0 || value.active.length > 0) && "bg-selection-soft",
      )}
    >
      <span className={cn("text-fs-label wrap-anywhere text-ink-soft", item.kind === "attribute" && "font-mono")}>
        <MarkedText text={item.name} {...name} />
      </span>
      <span className="text-pretty">
        <MarkedText text={item.value} {...value} />
      </span>
    </div>
  )
}

/** Text with evidence marked in it, in yellow where the evidence of the annotation under the pointer is. */
const MarkedText = ({ text, spans, active }: { text: string; spans: Span[]; active: Span[] }) =>
  segmentText(text, spans, active).map((segment, index) =>
    segment.matched ? (
      <mark
        key={index}
        className={cn(
          "rounded-badge border-b-2 px-0.5 font-semibold text-ink",
          segment.active ? "border-selection bg-selection-mid" : "border-brand-light bg-brand-tint",
        )}
      >
        {segment.text}
      </mark>
    ) : (
      <Fragment key={index}>{segment.text}</Fragment>
    ),
  )

type AnnotationsProps = {
  entry: EntryResponse
  highlighted: string | null
  onHighlight: (field: string | null) => void
}

const Annotations = ({ entry, highlighted, onHighlight }: AnnotationsProps) => (
  <Card padding="lg">
    <CardHeading help={<HelpHint label="About annotation status">{STATUS_HELP}</HelpHint>}>Annotations</CardHeading>
    {entry.annotations.map((annotation) => (
      <AnnotationRow key={annotation.field} annotation={annotation} highlighted={highlighted} onHighlight={onHighlight} />
    ))}
  </Card>
)

const STATUS_HELP = (
  <StatusMeanings statuses={VALUE_STATUSES.map((code) => ({ code, ...statusInfo(code) }))}>
    {"A field without a value has no extracted value. The BioSample can still have the property."}
  </StatusMeanings>
)

const AnnotationRow = ({
  annotation,
  highlighted,
  onHighlight,
}: {
  annotation: EntryAnnotation
  highlighted: string | null
  onHighlight: (field: string | null) => void
}) => {
  const info = statusInfo(annotation.status)
  const shown = hasStatusValue(annotation.status)
  // The last column holds the widest status chip that a row shows, LLM selected, so that the values of every row start
  // and end at the same place; each chip keeps the width of its text, at the right end of the row.
  return (
    <div
      onMouseEnter={() => onHighlight(annotation.field)}
      onMouseLeave={() => onHighlight(null)}
      className={cn(
        "grid grid-cols-annotation-row items-center gap-x-2.5 rounded-tag px-1.5 py-1.5 text-fs-body-sm",
        ROW_RULE,
        highlighted === annotation.field && "bg-selection-soft",
      )}
    >
      <span className="text-ink-mid">{fieldLabel(annotation.field)}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {shown && annotation.value && <span className={info.group === "mapped" ? "text-ink" : "text-ink-soft"}>“{annotation.value}”</span>}
        {annotation.termId && (
          <>
            <span className="text-ink-soft">→</span>
            <TermPopover label={annotation.label ?? annotation.termId} termId={annotation.termId} clauses={annotation.clauses} />
          </>
        )}
      </span>
      {shown && (
        <span className="flex justify-end">
          <StatusPill mark={info.mark} tone={info.tone} label={info.label} />
        </span>
      )}
    </div>
  )
}

const ExperimentsCard = ({ experiments, targetAssays }: { experiments: EntryExperiment[]; targetAssays: readonly string[] }) => {
  const { shown, pager } = usePagedRows(experiments)
  return (
    <Card padding="lg">
      <CardHeading aside={pager}>SRA Experiments</CardHeading>
      <CardTable columns={EXPERIMENT_COLUMNS}>
        {shown.map((experiment) => (
          <tr
            key={experiment.accession}
            className="group"
          >
            <td className={cn(TD, "font-mono text-fs-label")}>{experiment.accession}</td>
            <td className={TD}>
              {experiment.libraryStrategy &&
                (experiment.inPopulation ? (
                  <Tag dot={assayDotClass(experiment.libraryStrategy, targetAssays)}>{experiment.libraryStrategy}</Tag>
                ) : (
                  <span className="text-fs-label text-ink-soft">{experiment.libraryStrategy}</span>
                ))}
            </td>
            <td className={cn(TD, "font-mono text-fs-label")}>{experiment.runs.length}</td>
            <td className={cn(TD, "text-fs-label")}>
              <span className="inline-flex gap-3">
                <ExternalLink href={ddbjSearchHref("sra-experiment", experiment.accession)}>DDBJ</ExternalLink>
                <ExternalLink href={ncbiHref("sra-experiment", experiment.accession)}>NCBI</ExternalLink>
                {experiment.chipAtlas.length > 0 && (
                  <ExternalLink href={chipAtlasHref(experiment.accession)}>ChIP-Atlas</ExternalLink>
                )}
              </span>
            </td>
          </tr>
        ))}
      </CardTable>
    </Card>
  )
}

const BioProjectsCard = ({ bioprojects }: { bioprojects: EntryBioProject[] }) => {
  const { shown, pager } = usePagedRows(bioprojects)
  return (
    <Card padding="lg">
      <CardHeading aside={pager}>BioProjects</CardHeading>
      {bioprojects.length === 0 ? (
        <div className="text-fs-body-sm text-ink-soft">No linked BioProject.</div>
      ) : (
        <CardTable columns={BIOPROJECT_COLUMNS}>
          {shown.map((bioproject) => (
            <tr key={bioproject.accession} className="group">
              <td className={cn(TD, "font-mono text-fs-label whitespace-nowrap")}>{bioproject.accession}</td>
              <td className={cn(TD, "wrap-anywhere")}>{bioproject.title}</td>
              <td className={cn(TD, "text-fs-label whitespace-nowrap")}>
                <span className="inline-flex gap-3">
                  <ExternalLink href={ddbjSearchHref("bioproject", bioproject.accession)}>DDBJ</ExternalLink>
                  <ExternalLink href={ncbiHref("bioproject", bioproject.accession)}>NCBI</ExternalLink>
                </span>
              </td>
            </tr>
          ))}
        </CardTable>
      )}
    </Card>
  )
}
