import { fetchTerms } from "~/lib/api/queries"
import type { Unit } from "~/lib/api/types"

/**
 * The term of an annotation field that a pasted label names: the term whose label it is, or else the first term found in the
 * counting unit of the view, or null when nothing matches.
 */
export const findTermId = async (field: string, label: string, unit: Unit): Promise<string | null> => {
  const hits = (await fetchTerms({ field, query: label, q: null, unit, selfExclusion: true, limit: 5 })).terms
  return (hits.find((h) => (h.label ?? "").toLowerCase() === label.toLowerCase()) ?? hits[0])?.termId ?? null
}
