import { useDataset } from "~/lib/api/queries"
import { buildCommit } from "~/lib/build-info"
import { formatCount } from "~/lib/format"
import { ExternalLink } from "~/ui"

const COPYRIGHT_YEAR = 2026
const BSI_URL = "https://bsi.rois.ac.jp/"

/** Dataset information (population, model, and build time), the copyright, and the commit of the frontend, always visible. */
export const Footer = () => {
  const dataset = useDataset()
  const commit = buildCommit()
  const data = dataset.data
  const assays = data?.targetAssays ?? []
  const assayText = assays.length > 1 ? `${assays.slice(0, -1).join(", ")}, or ${assays.at(-1)}` : assays.join("")
  return (
    <footer className="flex shrink-0 justify-between gap-6 border-t border-border-soft bg-surface px-workspace-gutter py-2.5 text-fs-label text-ink-soft">
      <span>
        {data ? (
          <>
            Dataset: BioSamples with {assayText} experiments · {formatCount(data.totals.biosample)} BioSamples ·
            Annotations by <span className="font-mono">{data.datasetVersion.model}</span> · Built{" "}
            <span className="font-mono">{data.datasetVersion.createdAt.slice(0, 10)}</span>
          </>
        ) : (
          "Dataset information is loading"
        )}
      </span>
      <span>
        © {COPYRIGHT_YEAR} <ExternalLink href={BSI_URL}>BioData Science Initiative (BSI)</ExternalLink>
        {commit && (
          <>
            {" "}· Commit <span className="font-mono">{commit}</span>
          </>
        )}
      </span>
    </footer>
  )
}
