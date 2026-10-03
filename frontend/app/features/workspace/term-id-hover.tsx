import { useTerm } from "~/lib/api/queries"
import { termPanelDetails } from "~/lib/terms"
import { cn, HoverPopover, TermPanel } from "~/ui"

type TermIdHoverProps = {
  termId: string
  /** The label of the term, for the panel. */
  label: string
  /** The classes of the ID, where it needs more than the grey monospace of a term ID, such as a line of its own. */
  className?: string
  /** The ID is on the tinted ground of a chip, where the grey is one step darker to keep a contrast of 4.5:1. */
  onTint?: boolean
}

/**
 * The ID of a term in the workspace, in the grey monospace of term IDs, that opens the details of the term while the
 * pointer rests on it. The panel has no link to the BioSamples with the term: a click on the ID goes to what the ID is
 * part of, and the workspace changes the condition by its own controls.
 */
export const TermIdHover = ({ termId, label, className, onTint = false }: TermIdHoverProps) => (
  <HoverPopover trigger={termId} triggerClassName={cn("font-mono text-fs-micro font-normal", onTint ? "text-ink-mid" : "text-ink-soft", className)} label={label}>
    <TermIdPanel termId={termId} label={label} />
  </HoverPopover>
)

/** The panel of a term with what the api gives for it, asked for when the panel opens. */
const TermIdPanel = ({ termId, label }: { termId: string; label: string }) => {
  const term = useTerm(termId)
  return <TermPanel label={label} termId={termId} details={term.isError ? null : term.data && termPanelDetails(term.data)} />
}
