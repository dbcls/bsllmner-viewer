/**
 * The text that Paste list starts with: the values of the elements on the axis, one per line. Values, not labels, so
 * that replacing the axis with the text as it is leaves the axis as it is: a term ID names one term, and a label can
 * name several.
 */
export const axisTermsText = (values: readonly string[]): string => values.join("\n")

/** The entries of a pasted list: one per line, without blanks. A label can hold a comma or a semicolon. */
export const pastedLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

/** The entries of a pasted list that name elements: their values, and how many entries name nothing. */
export type Pasted = { terms: string[]; missed: number }

/** A term ID: a prefix, a colon, and a local ID, without blanks. */
const TERM_ID = /^[^\s:]+:\S+$/

/**
 * The element values that pasted entries name, in the order of the entries and without repeats, and the number of entries
 * that name nothing. On an annotation field, an entry in the form of a term ID is taken as it is, and any other entry is a
 * label that `findTerm` resolves to a term ID, or to null when nothing matches. On another dimension, such as the assay,
 * an entry is the value itself.
 */
export const resolvePasted = async (
  entries: readonly string[],
  termField: boolean,
  findTerm: (label: string) => Promise<string | null>,
): Promise<Pasted> => {
  const found: string[] = []
  let missed = 0
  for (const entry of entries) {
    if (!termField || TERM_ID.test(entry)) {
      found.push(entry)
      continue
    }
    const id = await findTerm(entry)
    if (id === null) missed += 1
    else found.push(id)
  }
  return { terms: [...new Set(found)], missed }
}

/** The most terms that the api takes for one dimension of an aggregation. */
export const MAX_AXIS_TERMS = 500

/** The most terms that an axis shows, and the subject of the alert that says so. */
export type TermLimit = { max: number; subject: string }

/** The alert that says that an axis cannot take more terms. */
export const limitAlert = (limit: TermLimit): string => `${limit.subject} shows up to ${limit.max} terms`

/**
 * The terms of an axis after a found term is picked: without the term when the axis has it, and with the term at the end
 * when it lacks it. At the limit, the terms stay and the alert says why.
 */
export const toggleTerm = (values: readonly string[], value: string, limit?: TermLimit): { terms: string[]; alert: string | null } => {
  if (values.includes(value)) return { terms: values.filter((v) => v !== value), alert: null }
  if (limit && values.length >= limit.max) return { terms: [...values], alert: limitAlert(limit) }
  return { terms: [...values, value], alert: null }
}

/**
 * The terms that pasted entries make the axis show, with the alert that says what happened: the first terms up to the
 * limit, or null terms when no entry names a term.
 */
export const replaceTerms = async (
  entries: readonly string[],
  resolve: (entries: readonly string[]) => Promise<Pasted>,
  limit?: TermLimit,
): Promise<{ terms: string[] | null; alert: string }> => {
  const { terms: unique, missed } = await resolve(entries)
  if (unique.length === 0) return { terms: null, alert: "No terms recognised" }
  if (limit && unique.length > limit.max) return { terms: unique.slice(0, limit.max), alert: `The first ${limit.max} of ${unique.length} terms are shown` }
  return { terms: unique, alert: `${entries.length - missed} of ${entries.length} terms recognised` }
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
