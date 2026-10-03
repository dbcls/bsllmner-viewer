import { api, unwrap } from "~/lib/api/client"

/** The term of an annotation field that a pasted label names: the term whose label it is, or else the first term found, or null when nothing matches. */
export const findTermId = async (field: string, label: string): Promise<string | null> => {
  const hits = unwrap(await api.GET("/api/terms", { params: { query: { field, query: label, facetSelfExclude: true, limit: 5 } } })).terms
  return (hits.find((h) => (h.label ?? "").toLowerCase() === label.toLowerCase()) ?? hits[0])?.termId ?? null
}
