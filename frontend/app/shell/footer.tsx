import type { ReactNode } from "react"

import { queryFailed, useDataset } from "~/lib/api/queries"
import { buildCommit } from "~/lib/build-info"
import { formatCount } from "~/lib/format"
import { assayList } from "~/lib/labels"
import { cn, ExternalLink, Skeleton } from "~/ui"

const CRATE_URL = "https://biosampleplus.s3.ap-northeast-1.amazonaws.com/index.html"
const SUPERCOMPUTER_URL = "https://sc.ddbj.nig.ac.jp/en/"
const REPOSITORY_URL = "https://github.com/dbcls/bsllmner-viewer"

/**
 * The organizations that develop and run bsllmner-mk2 and bsllmner-viewer, in the order of their logos. Each logo has its
 * own height, so that the logos look equally large: a tall logo with small lettering (DBCLS) is drawn taller, and a wide
 * one (Chiba University) shorter.
 */
const ORGANIZATIONS = [
  { name: "BioData Science Initiative (BSI)", url: "https://bsi.rois.ac.jp/", logo: "/logos/bsi.svg", height: "h-6" },
  { name: "DNA Data Bank of Japan (DDBJ)", url: "https://www.ddbj.nig.ac.jp/index-e.html", logo: "/logos/ddbj.svg", height: "h-6.25" },
  { name: "Database Division for Life Science (DBCLS)", url: "https://dbcls.rois.ac.jp/index-en.html", logo: "/logos/dbcls.svg", height: "h-7.5" },
  { name: "Chiba University", url: "https://www.chiba-u.ac.jp/e/", logo: "/logos/chiba-u.svg", height: "h-5" },
]

/** The dataset line while the description of the dataset is on its way. */
const DatasetLineSkeleton = () => (
  <span aria-busy="true" className="w-96">
    <Skeleton />
  </span>
)

/**
 * Two lines of text on the left, the dataset and where its annotations are published with their license, and the
 * logos of the organizations on the right across both lines, always visible. The items of a line are set apart by
 * space, not by a separator character. The first line holds what is known of the dataset.
 */
const FooterFrame = ({ dataset }: { dataset: ReactNode }) => {
  const commit = buildCommit()
  return (
    <footer className="flex shrink-0 items-center justify-between gap-6 border-t border-border-soft bg-surface px-workspace-gutter py-2.5 text-fs-label text-ink-soft">
      <div className="min-w-0">
        <p className="flex flex-wrap gap-x-4">{dataset}</p>
        <p className="flex flex-wrap gap-x-4">
          <span>
            RO-Crate: <ExternalLink href={CRATE_URL}>BioSample Plus</ExternalLink> (CC BY 4.0)
          </span>
          <span>
            Computed on the <ExternalLink href={SUPERCOMPUTER_URL}>NIG supercomputer</ExternalLink>
          </span>
          {commit && (
            <span>
              Version{" "}
              <ExternalLink href={`${REPOSITORY_URL}/commit/${commit}`}>
                <span className="font-mono">{commit}</span>
              </ExternalLink>
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-5">
        {ORGANIZATIONS.map((organization) => (
          <a key={organization.name} href={organization.url} target="_blank" rel="noreferrer" className="shrink-0">
            <img src={organization.logo} alt={organization.name} className={cn("w-auto", organization.height)} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ))}
      </div>
    </footer>
  )
}

export const Footer = () => {
  const dataset = useDataset()
  const data = dataset.data
  return (
    <FooterFrame
      dataset={
        data ? (
          <>
            <span>Dataset: BioSamples with {assayList(data.targetAssays)} experiments</span>
            <span>{formatCount(data.totals.biosample)} BioSamples</span>
            <span>
              Annotations by <span className="font-mono">{data.datasetVersion.model}</span>
            </span>
          </>
        ) : queryFailed(dataset) ? (
          <span>Dataset information is unavailable</span>
        ) : (
          <DatasetLineSkeleton />
        )
      }
    />
  )
}

/** The footer drawn before the JavaScript runs, when the description of the dataset cannot be asked for yet. */
export const FooterFallback = () => <FooterFrame dataset={<DatasetLineSkeleton />} />
