const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Assays in the order of the dataset's target assays, so that every view lists them in the same order however many
 * target assays the dataset has. An assay that is not a target assay comes after them, in alphabetical order.
 */
export const orderAssays = (assays: readonly string[], targetAssays: readonly string[]): string[] => {
  const rank = (assay: string): number => {
    const index = targetAssays.indexOf(assay)
    return index < 0 ? targetAssays.length : index
  }
  return [...new Set(assays)].sort((a, b) => rank(a) - rank(b) || compareText(a, b))
}

const DOT_CLASSES = ["bg-assay-1", "bg-assay-2", "bg-assay-3"] as const

/** The class of the dot that marks an assay: one color per target assay, in their order, and gray for the others. */
export const assayDotClass = (assay: string, targetAssays: readonly string[]): string => DOT_CLASSES[targetAssays.indexOf(assay)] ?? "bg-ink-softer"
