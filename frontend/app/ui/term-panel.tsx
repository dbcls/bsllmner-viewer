import type { ReactNode } from "react"

import { Skeleton } from "./skeleton"
import { ExternalLink } from "./text-link"

/** What the panel of a term shows besides its label and ID, as text ready to show. */
export type TermPanelDetails = {
  synonyms: string[]
  /** The parent terms, each by its label or, without one, its ID. */
  parents: string[]
  /** The name of the ontology of the term, or null for an ontology that the dataset does not describe. */
  ontologyName: string | null
  /** The page of the term on the site of its ontology, or null when there is none. */
  url: string | null
}

type TermPanelProps = {
  /** The label of the term, drawn before the details arrive. */
  label: string
  termId: string
  /** Undefined while the details are on their way, and null when there are none. */
  details: TermPanelDetails | null | undefined
  /** An action at the right end of the last line, such as a link to the BioSamples with the term. */
  action?: ReactNode
}

const DetailRow = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className="grid grid-cols-[92px_1fr] gap-2.5 py-1">
    <span className="text-fs-label font-medium text-ink-soft">{name}</span>
    <span className="text-fs-body-sm text-ink">{children}</span>
  </div>
)

/**
 * The details of a term in a popover: the label, the ID, the synonyms, and the parent terms, with a link to the page of
 * the term on the site of its ontology, named after the ontology, and an action. A row without values, a link without
 * a URL, and a last line without a link or an action are left out.
 */
export const TermPanel = ({ label, termId, details, action }: TermPanelProps) => {
  const link = details?.url && details.ontologyName ? <ExternalLink href={details.url}>{details.ontologyName}</ExternalLink> : null
  return (
    <>
      <div className="text-fs-body font-semibold text-ink">{label}</div>
      <div className="mt-0.5 mb-2 font-mono text-fs-label text-ink-soft">{termId}</div>
      {details === undefined ? (
        <div aria-hidden="true">
          <DetailRow name="Synonyms">
            <Skeleton className="w-48" />
          </DetailRow>
          <DetailRow name="Parent terms">
            <Skeleton className="w-32" />
          </DetailRow>
        </div>
      ) : (
        details && (
          <>
            {details.synonyms.length > 0 && <DetailRow name="Synonyms">{details.synonyms.join(", ")}</DetailRow>}
            {details.parents.length > 0 && <DetailRow name="Parent terms">{details.parents.join(", ")}</DetailRow>}
          </>
        )
      )}
      {(link || action) && (
        <div className="mt-2 flex items-center justify-between gap-4 border-t border-border-soft pt-2.5 text-fs-body-sm">
          <span>{link}</span>
          {action}
        </div>
      )}
    </>
  )
}
