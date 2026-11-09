import type { ReactNode } from "react"

import { useDataset } from "~/lib/api/queries"
import {
  ANNOTATION_LICENSE,
  archivePath,
  type Crate,
  CRATE_AUTHORS,
  CRATE_CONTENTS,
  CRATE_ONTOLOGIES,
  CRATE_PARTS,
  crateFilePath,
  crateOfModel,
  CRATES,
  downloadCommands,
  PAPER,
  partPath,
} from "~/lib/crate"
import { copyText } from "~/lib/export"
import { formatCount, formatSize } from "~/lib/format"
import { pageTitle } from "~/lib/site"
import {
  ACTION_ICON,
  Alert,
  buttonClass,
  Card,
  cn,
  CopyButton,
  DownloadLink,
  ExternalLink,
  HelpHint,
  Icon,
  PageHeading,
  PageMeta,
  SectionHeading,
  Tag,
  useAlert,
} from "~/ui"

import { crateSchema } from "./crate-schema"

const DATASETS_TITLE = "Datasets"

const DATASETS_DESCRIPTION =
  "Download the RO-Crates of the annotations of bsllmner-mk2, one for each model, with the BioSample records, the ontology files, and the logs of every run."

/** The files of an RO-Crate that a reader opens before downloading the whole RO-Crate. */
const CRATE_FILES = ["README.md", "ro-crate-metadata.json", "provenance/checksums.sha256"]

const ROW = "grid gap-2.5 border-b border-brand-soft py-1.5 text-fs-body-sm last:border-b-0"

/** A name and its value in a list of the facts of an RO-Crate. */
const Row = ({ name, children, columns = "grid-cols-metadata-row" }: { name: ReactNode; children: ReactNode; columns?: string }) => (
  <div className={cn(ROW, columns)}>
    <dt className="text-fs-label text-ink-soft">{name}</dt>
    <dd className="text-pretty">{children}</dd>
  </div>
)

export const DatasetsPage = () => {
  const dataset = useDataset()
  const served = dataset.data ? crateOfModel(dataset.data.datasetVersion.model) : undefined
  const [alert, showAlert] = useAlert()

  return (
    <main id="main" className="mx-auto w-full max-w-content-max flex-1 px-page-gutter py-4">
      <PageMeta title={pageTitle(DATASETS_TITLE)} description={DATASETS_DESCRIPTION} canonicalPath="/datasets" />
      <CratesSchema />
      <Alert message={alert} />
      <div className="flex flex-col gap-4">
        <Card padding="lg">
          <PageHeading>{DATASETS_TITLE}</PageHeading>
          <p className="mt-3 max-w-2xl text-fs-body text-ink-mid text-pretty">
            The annotations are published as RO-Crates, one for each model that made them.
          </p>
        </Card>
        <div className="grid grid-cols-2 items-start gap-4">
          {CRATES.map((crate) => (
            <CrateCard key={crate.id} crate={crate} served={crate === served} onAlert={showAlert} />
          ))}
        </div>
        <div className="grid grid-cols-2 items-start gap-4">
          <ContentsCard />
          <div className="flex flex-col gap-4">
            <LicenseCard />
            <AuthorsCard />
          </div>
        </div>
      </div>
    </main>
  )
}

/** The schema.org Datasets of the RO-Crates, which dataset search engines read. The browser does not run it. */
const CratesSchema = () => (
  <script type="application/ld+json">{JSON.stringify(CRATES.map((crate) => crateSchema(crate, globalThis.location.origin)))}</script>
)

type CrateCardProps = {
  crate: Crate
  /** The RO-Crate holds the annotations that this viewer shows. */
  served: boolean
  onAlert: (message: string) => void
}

/** An RO-Crate: its model, its counts, its downloads with the commands that check them, and its files to read first. */
const CrateCard = ({ crate, served, onAlert }: CrateCardProps) => {
  const commands = downloadCommands(crate, globalThis.location.origin)
  return (
    <Card padding="lg" id={crate.id}>
      <div className="flex items-center gap-2.5">
        <SectionHeading>
          <span className="font-mono">{crate.model}</span>
        </SectionHeading>
        {served && <Tag>Shown in this viewer</Tag>}
      </div>
      <p className="mt-2 text-fs-body-sm text-ink-mid">{crate.name}</p>
      <dl className="mt-3">
        <Row name="Published">{crate.datePublished}</Row>
        <Row name="BioSamples">{formatCount(crate.biosamples)}</Row>
        <Row name="Sources">{crate.sources.join(", ")}</Row>
        <Row name="Size">{`${formatSize(crate.bytes)} in ${formatCount(crate.files)} files`}</Row>
      </dl>
      <div className="mt-5">
        <DownloadLink href={archivePath(crate)} className={buttonClass("secondary", "sm")}>
          <Icon name={ACTION_ICON.download} />
          <span className="text-trim-cap">{`Download archive (${formatSize(crate.archiveBytes)})`}</span>
        </DownloadLink>
      </div>
      <div className="relative mt-3">
        <pre
          tabIndex={0}
          role="region"
          aria-label={`Commands that download ${crate.model}`}
          className="overflow-auto rounded-button bg-ink py-3 pr-28 pl-3.5 font-mono text-fs-label leading-relaxed break-all whitespace-pre-wrap text-brand-soft"
        >
          {commands}
        </pre>
        <span className="absolute top-2 right-2">
          <CopyButton
            kind="inverse"
            onCopy={async () => {
              const ok = await copyText(commands)
              if (!ok) onAlert("Copy failed.")
              return ok
            }}
          >
            Copy
          </CopyButton>
        </span>
      </div>
      <div className="mt-4 flex items-center text-fs-body-sm font-semibold text-ink">
        By directory
        <HelpHint label={`About the archive of a directory of ${crate.model}`}>
          Each archive unpacks into its directory, as in the RO-Crate. To check the files, also unpack provenance.tar.gz in the same place, and run
          sha256sum -c --ignore-missing provenance/checksums.sha256.
        </HelpHint>
      </div>
      <ul className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-fs-body-sm">
        {CRATE_PARTS.map((part) => (
          <li key={part} className="flex items-center justify-between gap-2">
            <DownloadLink href={partPath(crate, part)} className="inline-flex items-center gap-1 font-mono text-fs-label text-brand hover:text-brand-deep">
              <Icon name={ACTION_ICON.download} />
              {`${part}.tar.gz`}
            </DownloadLink>
            <span className="text-fs-label text-ink-soft">{formatSize(crate.partBytes[part])}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-fs-body-sm">
        {CRATE_FILES.map((path) => (
          <ExternalLink key={path} href={crateFilePath(crate, path)}>
            <span className="font-mono">{path}</span>
          </ExternalLink>
        ))}
      </div>
    </Card>
  )
}

const ContentsCard = () => (
  <Card padding="lg">
    <SectionHeading>Contents of an RO-Crate</SectionHeading>
    <dl className="mt-3">
      {CRATE_CONTENTS.map(({ path, description }) => (
        <Row key={path} name={<span className="font-mono">{path}</span>} columns="grid-cols-crate-row">
          {description}
        </Row>
      ))}
    </dl>
  </Card>
)

const LicenseCard = () => (
  <Card padding="lg">
    <SectionHeading>License</SectionHeading>
    <p className="mt-3 text-fs-body-sm text-ink-mid text-pretty">
      The annotations and the RO-Crates are under <ExternalLink kind="inline" href={ANNOTATION_LICENSE.url}>{ANNOTATION_LICENSE.name}</ExternalLink>.
      The ontology files in <span className="font-mono">ontology/</span> keep the license of their ontology.
    </p>
    <dl className="mt-2">
      {CRATE_ONTOLOGIES.map((ontology) => (
        <div key={ontology.name} className={cn(ROW, "grid-cols-ontology-row")}>
          <dt>
            <ExternalLink href={ontology.url}>{ontology.name}</ExternalLink>
          </dt>
          <dd>
            <ExternalLink href={ontology.license.url}>{ontology.license.name}</ExternalLink>
          </dd>
        </div>
      ))}
    </dl>
  </Card>
)

const AuthorsCard = () => (
  <Card padding="lg">
    <SectionHeading>Authors</SectionHeading>
    <ul className="mt-3 flex flex-col gap-2.5 text-fs-body-sm">
      {CRATE_AUTHORS.map((author) => (
        <li key={author.orcid}>
          <span className="font-semibold text-ink">{author.name}</span>{" "}
          <ExternalLink href={author.orcid}>
            <span className="font-mono text-fs-label">{new URL(author.orcid).pathname.slice(1)}</span>
          </ExternalLink>
          <span className="mt-0.5 block text-ink-soft">{author.affiliations.join("; ")}</span>
        </li>
      ))}
    </ul>
    <p className="mt-4 border-t border-border-soft pt-3 text-fs-body-sm text-ink-mid">
      Related paper: <ExternalLink kind="inline" href={PAPER.url}>{`doi:${PAPER.doi}`}</ExternalLink>
    </p>
  </Card>
)
