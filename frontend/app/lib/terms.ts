import { type RefObject, useEffect, useRef } from "react"

import type { TermHit, TermResponse } from "./api/types"
import { formatCount } from "./format"
import { fieldLabel } from "./labels"

/** The field choice that searches every annotation field. */
export const ALL_FIELDS = "*"

/** How long the search text rests before the terms are searched. */
export const TERM_SEARCH_DEBOUNCE_MS = 200

/** The rows that hold the place of a term search result before it arrives. */
export const SKELETON_TERMS = 8

/** The choices of a field Select for a term search: every field, then each annotation field. */
export const termFieldOptions = (fields: string[]): { value: string; label: string }[] => [
  { value: ALL_FIELDS, label: "All fields" },
  ...fields.map((f) => ({ value: f, label: fieldLabel(f) })),
]

/** The props of a term row for a search hit. The field is named only when the search covers every field. */
export const termHitRowProps = (hit: TermHit, everyField: boolean, query: string | undefined) => ({
  label: hit.label ?? hit.termId,
  id: hit.termId,
  count: formatCount(hit.count),
  ...(everyField ? { field: fieldLabel(hit.field) } : {}),
  ...(hit.matchedSynonym ? { synonym: hit.matchedSynonym } : {}),
  highlight: query ?? "",
})

/** A ref for the scrolling result list, which returns to the top whenever the query or the field of the result changes. */
export const useResultListRef = (query: string | undefined, field: string | null | undefined): RefObject<HTMLDivElement | null> => {
  const list = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0
  }, [query, field])
  return list
}

/**
 * The details of a term as its panel shows them: the parents by label (or ID), and the name of the ontology for the link
 * to the page of the term on the site of the ontology.
 */
export const termPanelDetails = (term: TermResponse) => ({
  synonyms: term.synonyms,
  parents: term.parents.map((parent) => parent.label ?? parent.termId),
  ontologyName: term.ontology?.name ?? null,
  url: term.url,
})
