import type { TermHit } from "./api/types"
import { formatCount } from "./format"

const PATH_STEPS = 2

/** The nearest ancestors of a term, with an ellipsis for the ones above. */
const shortPath = (path: string[]): string =>
  path.length > PATH_STEPS ? `… › ${path.slice(-PATH_STEPS).join(" › ")}` : path.join(" › ")

/**
 * Where a term sits: the path from its nearest ancestors to the term, and how many descendant terms a condition on it covers.
 * The ontology is not named: the prefix of the term ID already says which one it is.
 */
export const termDetail = (hit: TermHit): string => {
  const parts: string[] = []
  if (hit.path.length) parts.push(`${shortPath(hit.path)} › ${hit.label ?? hit.termId}`)
  if (hit.descendantCount > 0) parts.push(`includes ${formatCount(hit.descendantCount)} descendant terms`)
  return parts.join("\n")
}
