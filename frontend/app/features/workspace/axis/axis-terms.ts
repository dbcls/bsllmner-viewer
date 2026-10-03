/**
 * The text that Paste list starts with: the values of the elements on the axis, one per line. Values, not labels, so
 * that replacing the axis with the text as it is leaves the axis as it is: a term ID names one term, and a label can
 * name several.
 */
export const axisTermsText = (values: readonly string[]): string => values.join("\n")

/** The entries of a pasted list: one per line, or separated by commas or semicolons, without blanks. */
export const pastedLines = (text: string): string[] =>
  text
    .split(/[\n,;]/)
    .map((line) => line.trim())
    .filter(Boolean)

/**
 * The element values that pasted entries name, in the order of the entries and without repeats. On an annotation field,
 * an entry with a colon is a term ID and is taken as it is, and any other entry is a label that `findTerm` resolves to a
 * term ID, or to null when nothing matches. On another dimension, such as the assay, an entry is the value itself.
 */
export const resolvePasted = async (
  entries: readonly string[],
  termField: boolean,
  findTerm: (label: string) => Promise<string | null>,
): Promise<string[]> => {
  const found: string[] = []
  for (const entry of entries) {
    if (!termField || entry.includes(":")) {
      found.push(entry)
      continue
    }
    const id = await findTerm(entry)
    if (id !== null) found.push(id)
  }
  return [...new Set(found)]
}

/**
 * What an axis shows on one dimension: the terms that the user chose, or null for the top terms. The terms are all that it
 * takes, as the rows draw their tree from their own order and parents.
 */
export type AxisChoice = { terms: string[] | null }

/** What each dimension of an axis showed when the axis last left it. */
export type AxisMemory = Record<string, AxisChoice>

const TOP: AxisChoice = { terms: null }

/**
 * Moves an axis from one dimension to another. The axis remembers what it shows on `from`, and shows on `to` what it
 * showed there the last time, or the top terms on a dimension that it has not shown.
 */
export const switchDimension = (memory: AxisMemory, from: string, to: string, current: AxisChoice): { memory: AxisMemory; next: AxisChoice } =>
  from === to ? { memory, next: current } : { memory: { ...memory, [from]: current }, next: memory[to] ?? TOP }
