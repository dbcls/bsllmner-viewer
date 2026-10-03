import { Link } from "react-router"

import { useTerm } from "~/lib/api/queries"
import type { Clause } from "~/lib/api/types"
import { useConditionHref } from "~/lib/condition-href"
import { termPanelDetails } from "~/lib/terms"
import { ACTION_ICON, Icon, Popover, TermPanel } from "~/ui"

type TermPopoverProps = {
  /** The label of the term, as the annotation shows it. */
  label: string
  termId: string
  /** The clauses that select the term, as the annotation gives them. */
  clauses: Clause[]
}

/**
 * A term of an annotation, its label in the brand color and its ID after it, that opens the panel of its details: a
 * click on either opens and pins it, and the pointer resting on the ID opens it too.
 */
export const TermPopover = ({ label, termId, clauses }: TermPopoverProps) => (
  <Popover
    trigger={<span className="text-brand group-hover:text-brand-deep">{label}</span>}
    hoverTrigger={<span className="font-mono text-fs-micro text-ink-soft">{termId}</span>}
    triggerClassName="group inline-flex flex-wrap items-center gap-x-1.5"
    label={label}
  >
    <TermPanelLoader label={label} termId={termId} clauses={clauses} />
  </Popover>
)

/** The panel of a term with what the api gives for it, asked for when the panel opens, and the link to its BioSamples. */
const TermPanelLoader = ({ label, termId, clauses }: TermPopoverProps) => {
  const term = useTerm(termId)
  const { href, failed } = useConditionHref(clauses)
  const text = (
    <>
      Show BioSamples with this term <Icon name={ACTION_ICON.goTo} />
    </>
  )
  return (
    <TermPanel
      label={label}
      termId={termId}
      details={term.isError ? null : term.data && termPanelDetails(term.data)}
      action={
        href ? (
          <Link to={href} className="text-brand no-underline hover:text-brand-deep">
            {text}
          </Link>
        ) : (
          <span aria-disabled={failed || undefined} className={failed ? "text-ink-soft" : "text-brand"}>{text}</span>
        )
      }
    />
  )
}
