import { Link } from "react-router"

import type { Unit } from "~/lib/api/types"
import { cn, Segmented, Toggle } from "~/ui"

import { type Tab, TABS, workspaceSearch,type WorkspaceState } from "./state"

const TAB_LABELS: Record<Tab, string> = {
  samples: "Samples",
  distribution: "Distribution",
  heatmap: "Heatmap",
  trend: "Trend",
  projects: "Projects",
}

type TabsProps = {
  state: WorkspaceState
  onUnit: (unit: Unit) => void
  onSelfExclusion: () => void
}

export const Tabs = ({ state, onUnit, onSelfExclusion }: TabsProps) => (
  <div className="mb-3.5 flex items-end justify-between border-b border-border-soft">
    <nav className="flex gap-0.5" aria-label="Views">
      {TABS.map((tab) => {
        const active = tab === state.tab
        return (
          <Link
            key={tab}
            to={`/w${workspaceSearch({ ...state, tab, page: 1 })}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3.5 pt-3 pb-2.5 text-fs-body no-underline hover:text-brand-deep",
              active ? "border-brand font-semibold text-brand" : "border-transparent text-ink-mid",
            )}
          >
            {TAB_LABELS[tab]}
          </Link>
        )
      })}
    </nav>
    {state.tab !== "samples" && (
      <div className="flex items-center gap-4 pb-2 text-fs-label text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          Count
          <Segmented
            ariaLabel="Counting unit"
            options={[
              { value: "biosample", label: "BioSamples" },
              { value: "experiment", label: "Experiments" },
              { value: "bioproject", label: "BioProjects" },
            ]}
            value={state.unit}
            onChange={onUnit}
          />
        </span>
        <Toggle
          checked={state.selfExclusion}
          onChange={onSelfExclusion}
          label={state.selfExclusion ? "Each view ignores its own filter" : "Each view applies its own filter"}
          title="Each chart is computed without its own field's condition, so unselected values stay visible for comparison."
        />
      </div>
    )}
  </div>
)
