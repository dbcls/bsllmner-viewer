import { isClientError } from "~/lib/api/client"
import { AXIS_TERM_LIMIT } from "~/lib/workspace-state"

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

/** The entries of a pasted list that name elements: their values, how many entries name nothing, and how many the api does not take. */
export type Pasted = { terms: string[]; missed: number; rejected: number }

/** The longest entry that the api takes as an element. A longer entry is not sent. */
export const MAX_ENTRY_LENGTH = 256

/** The limits that the api puts on the elements of an organism axis (up to 2**31 - 1) and of a publication year axis (from 1000 to 9999). */
const ORGANISM_ID_MAX = 2 ** 31 - 1
const YEAR_MIN = 1000

/**
 * The check of a pasted value for a dimension whose elements the api takes only in one form: the NCBI Taxonomy ID of an
 * organism and the year of a publication date, as canonical numbers. Null for a dimension that takes any text.
 */
export const elementValidator = (dimension: string): ((entry: string) => boolean) | null => {
  if (dimension === "organism_id") return (entry) => /^[1-9]\d{0,9}$/.test(entry) && Number(entry) <= ORGANISM_ID_MAX
  if (dimension === "date_published") return (entry) => /^[1-9]\d{3}$/.test(entry) && Number(entry) >= YEAR_MIN
  return null
}

/** What the screen says when the pasted entries cannot be looked up because the server or the network failed. */
export const LOOKUP_FAILED = "Could not look up the terms."

/** A term ID: a prefix, a colon, and a local ID, without blanks. */
const TERM_ID = /^[^\s:]+:\S+$/

/**
 * The most labels that are looked up at the same time. Each lookup is a term search, which takes one of the slots that a
 * worker of the api has for the requests that read the store, so the lookups leave slots for the views.
 */
export const LABEL_LOOKUPS = 4

/** What an entry names: an element value, nothing (null), or a value that the api does not take. */
type Named = string | null | typeof REJECTED

const REJECTED = Symbol("rejected")

/**
 * The element values that pasted entries name, in the order of the entries and without repeats, the number of entries
 * that name nothing, and the number of entries that the api does not take (too long, or refused with a 4xx response). On
 * an annotation field, an entry in the form of a term ID is taken as it is, and any other entry is a label that
 * `findTerm` resolves to a term ID, or to null when nothing matches. On another dimension, such as the assay, an entry is
 * the value itself. Up to `LABEL_LOOKUPS` labels are looked up at the same time. A failure of the server or of the
 * network is thrown after the lookups in progress end, and no lookup starts after it.
 */
export const resolvePasted = async (
  entries: readonly string[],
  termField: boolean,
  findTerm: (label: string) => Promise<string | null>,
  isValid: (entry: string) => boolean = () => true,
): Promise<Pasted> => {
  const named: Named[] = entries.map((entry) => {
    const asIs = !termField || TERM_ID.test(entry)
    if (!asIs) return null
    if (entry.length > MAX_ENTRY_LENGTH) return REJECTED
    return isValid(entry) ? entry : null
  })
  const labels = entries.flatMap((entry, index) => (termField && !TERM_ID.test(entry) ? [{ entry, index }] : []))
  const queue = labels.values()
  const failures: unknown[] = []
  const lookUp = async () => {
    while (failures.length === 0) {
      const next = queue.next()
      if (next.done) return
      const { entry, index } = next.value
      try {
        named[index] = await findTerm(entry)
      } catch (error) {
        if (isClientError(error)) named[index] = REJECTED
        else failures.push(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LABEL_LOOKUPS, labels.length) }, lookUp))
  if (failures.length > 0) throw failures[0]
  const found = named.filter((value): value is string => typeof value === "string")
  return {
    terms: [...new Set(found)],
    missed: named.filter((value) => value === null).length,
    rejected: named.filter((value) => value === REJECTED).length,
  }
}

/** The most terms that the api takes for one dimension of an aggregation. */
export const MAX_AXIS_TERMS = AXIS_TERM_LIMIT

/**
 * What the screen calls the elements of a dimension: the terms of an annotation field, and the values of any other
 * dimension, such as an assay, an organism, or a year.
 */
export type ElementNoun = "term" | "value"

export const elementNoun = (dimension: string, fields: readonly string[]): ElementNoun =>
  // Until the dataset lists its fields, every dimension is taken for a field, as most are.
  fields.length === 0 || fields.includes(dimension) ? "term" : "value"

/** The noun after a number of elements: "1 term", "3 values". */
export const nounFor = (count: number, noun: ElementNoun): string => (count === 1 ? noun : `${noun}s`)

/** The most elements that an axis shows, the subject of the alert that says so, and what the elements are called (terms when not given). */
export type TermLimit = { max: number; subject: string; noun?: ElementNoun }

/** The alert that says that an axis cannot take more elements. */
export const limitAlert = (limit: TermLimit): string => `${limit.subject} shows up to ${limit.max} ${nounFor(limit.max, limit.noun ?? "term")}.`

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
 * limit, or null terms when no entry names a term. The alert names the entries that the api rejected.
 */
export const replaceTerms = async (
  entries: readonly string[],
  resolve: (entries: readonly string[]) => Promise<Pasted>,
  limit?: TermLimit,
): Promise<{ terms: string[] | null; alert: string }> => {
  const { terms: unique, missed, rejected } = await resolve(entries)
  const nouns = `${limit?.noun ?? "term"}s`
  const rejectedNote = rejected > 0 ? `, ${rejected} not valid` : ""
  if (unique.length === 0) return { terms: null, alert: `No ${nouns} recognized${rejectedNote}.` }
  if (limit && unique.length > limit.max) return { terms: unique.slice(0, limit.max), alert: `The first ${limit.max} of ${unique.length} ${nouns} are shown${rejectedNote}.` }
  return { terms: unique, alert: `${entries.length - missed - rejected} of ${entries.length} ${nouns} recognized${rejectedNote}.` }
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
