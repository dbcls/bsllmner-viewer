import { useDataset } from "~/lib/api/queries"
import { formatCount } from "~/lib/format"

/** Dataset information, always visible: population, model, and build time. */
export const Footer = () => {
  const dataset = useDataset()
  const data = dataset.data
  const assays = data?.target_assays ?? []
  const assayText = assays.length > 1 ? `${assays.slice(0, -1).join(", ")}, or ${assays.at(-1)}` : assays.join("")
  return (
    <footer className="flex shrink-0 justify-between border-t border-border-soft bg-surface px-workspace-gutter py-2.5 text-fs-label text-ink-soft">
      <span>
        {data ? (
          <>
            Dataset: Human &amp; Mouse BioSamples with {assayText} experiments · {formatCount(data.totals.biosample)} BioSamples ·
            Annotations by <span className="font-mono">{data.dataset_version.model}</span> · Built{" "}
            <span className="font-mono">{data.dataset_version.created_at.slice(0, 10)}</span>
          </>
        ) : (
          "Dataset information is loading"
        )}
      </span>
      <span>BioData Science Initiative (DDBJ / DBCLS)</span>
    </footer>
  )
}
