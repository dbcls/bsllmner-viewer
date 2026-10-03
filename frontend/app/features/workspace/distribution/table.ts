export const DISTRIBUTION_HEADER = ["value", "label", "count"]

/** The label of the row for the part that has no term of the field, as on the page. */
export const WITHOUT_TERM_LABEL = "No term"

/**
 * The rows of the TSV of a distribution: the elements as the api counts them, then the part without a term when the
 * field has one, then the total. The two rows after the elements have no value, as they are not values of the field.
 */
export const distributionRows = (
  elements: readonly { value: string; label: string; count: number }[],
  withoutTerm: number | null | undefined,
  total: number,
): (string | number)[][] => [
  ...elements.map((e) => [e.value, e.label, e.count]),
  ...(withoutTerm == null ? [] : [["", WITHOUT_TERM_LABEL, withoutTerm]]),
  ["", "Total", total],
]
