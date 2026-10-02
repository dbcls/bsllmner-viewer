import type { TermHit } from "./api/types"
import { formatCount } from "./format"
import { ontologyLabel } from "./labels"

const PATH_STEPS = 3

/** The nearest ancestors of a term, with an ellipsis for the ones above. */
const shortPath = (path: string[]): string =>
  path.length > PATH_STEPS ? `… › ${path.slice(-PATH_STEPS).join(" › ")}` : path.join(" › ")

/** Where a term sits: its ontology, the path from its ancestors, and how many descendant terms a condition on it covers. */
export const termDetail = (hit: TermHit): string => {
  const parts = [ontologyLabel(hit.ontology)]
  if (hit.path.length) parts.push(`${shortPath(hit.path)} › ${hit.label ?? hit.term_id}`)
  if (hit.n_descendants > 0) parts.push(`includes ${formatCount(hit.n_descendants)} descendant terms`)
  return parts.join(" · ")
}
