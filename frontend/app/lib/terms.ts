import type { TermResponse } from "./api/types"

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
