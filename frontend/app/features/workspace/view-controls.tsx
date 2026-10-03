import type { ReactNode } from "react"

import type { Unit } from "~/lib/api/types"
import { Card, HelpHint, InlineLabel, Segmented } from "~/ui"

type ViewControlsProps = {
  unit: Unit
  onUnit: (unit: Unit) => void
  /** What the counts of the view mean, in a "?" after the control. */
  help?: ReactNode
  /** More inline controls after the counting unit, in the same row. */
  controls?: ReactNode
  /** Content under the row, in the same card and separated by a line. */
  children?: ReactNode
}

/**
 * The counting unit of a chart view, in a card at the top of the view. Every chart view puts the card in the same place,
 * so that the control does not move when the view changes. The unit belongs to the workspace, so a view opens with the
 * unit of the previous one. Chart views always count with self-exclusion, so they have no control for it.
 */
export const ViewControls = ({ unit, onUnit, help, controls, children }: ViewControlsProps) => (
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
          {help && (
            <span className="ml-1 inline-flex">
              <HelpHint label="About the counts">{help}</HelpHint>
            </span>
          )}
        </span>
        {controls}
      </div>
      {children && <div className="mt-3 border-t border-border-soft pt-3">{children}</div>}
    </Card>
  </div>
)
