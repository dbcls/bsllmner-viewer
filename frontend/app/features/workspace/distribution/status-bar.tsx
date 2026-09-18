import type { Element } from "~/lib/api/types"
import { formatPercent } from "~/lib/format"
import { statusLabel } from "~/lib/labels"
import { LinkButton } from "~/ui"

type StatusBarProps = {
  status: Element[]
  expanded: boolean
  onToggleExpanded: () => void
}

const SEGMENT_CLASS: Record<string, string> = {
  mapped: "bg-brand",
  unmapped: "bg-unmapped-mid",
  no_value: "bg-border-soft",
  mapped_exact: "bg-brand",
  mapped_selected: "bg-brand-light",
  unmapped_no_candidate: "bg-unmapped",
  unmapped_rejected: "bg-unmapped-light",
  not_stated: "bg-border-soft",
  extraction_failed: "bg-failed",
}

/** Status composition of a field as a thin stacked bar with a legend; three groups or six states. */
export const StatusBar = ({ status, expanded, onToggleExpanded }: StatusBarProps) => {
  const sum = status.reduce((acc, s) => acc + s.count, 0)
  return (
    <>
      <div className="mt-2 mb-1 flex h-1.5 gap-px overflow-hidden rounded-badge">
        {status.map((segment) => (
          <div
            key={segment.value}
            className={SEGMENT_CLASS[segment.value] ?? "bg-border-soft"}
            style={{ width: `${sum ? (segment.count / sum) * 100 : 0}%` }}
            title={`${statusLabel(segment.value)} ${formatPercent(segment.count, sum)}`}
          />
        ))}
      </div>
      <div className="mb-2 flex flex-wrap gap-x-2.5 gap-y-1 text-fs-micro text-ink-soft">
        {status.map((segment) => (
          <span key={segment.value} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-badge ${SEGMENT_CLASS[segment.value] ?? "bg-border-soft"}`} />
            {statusLabel(segment.value)} <span className="font-mono">{formatPercent(segment.count, sum)}</span>
          </span>
        ))}
        <LinkButton onClick={onToggleExpanded}>{expanded ? "3 groups" : "6 states"}</LinkButton>
      </div>
    </>
  )
}
