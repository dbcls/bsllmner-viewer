/** Fields whose elements the trend can draw as lines: the annotation fields, assay, and organism. */
export const trendFields = (fields: string[]): string[] => [...fields, "library_strategy", "organism_id"]

/**
 * The dimension that a view draws: the chosen one, or the first of the dimensions that the dataset offers when it does
 * not offer the chosen one, skipping `other`, the dimension of the other axis. Before the dataset is known (`offered` is
 * null), the chosen dimension is taken as it is.
 */
export const offeredDimension = (chosen: string, offered: string[] | null, other?: string): string =>
  offered === null || offered.includes(chosen) ? chosen : (offered.find((d) => d !== other) ?? chosen)
