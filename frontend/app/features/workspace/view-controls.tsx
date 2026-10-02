import type { ReactNode } from "react"

import type { Unit } from "~/lib/api/types"
import { Card, InlineLabel, Segmented } from "~/ui"

type ViewControlsProps = {
  unit: Unit
  onUnit: (unit: Unit) => void
  /** Legends and notes of the view, after the controls. */
  children?: ReactNode
}

/**
 * The counting unit of a chart view, in a card at the top of the view. Every chart view puts the card in the same place,
 * so that the control does not move when the view changes. The unit belongs to the workspace, so a view opens with the
 * unit of the previous one. Chart views always count with self-exclusion, so they have no control for it.
 */
export const ViewControls = ({ unit, onUnit, children }: ViewControlsProps) => (
  <div className="mb-4">
    <Card padding="sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-fs-label text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <InlineLabel>Count</InlineLabel>
          <Segmented
            ariaLabel="Counting unit"
            options={[
              { value: "biosample", label: "BioSamples" },
              { value: "sra-experiment", label: "SRA Experiments" },
              { value: "bioproject", label: "BioProjects" },
            ]}
            value={unit}
            onChange={onUnit}
          />
        </span>
        {children}
      </div>
    </Card>
  </div>
)
