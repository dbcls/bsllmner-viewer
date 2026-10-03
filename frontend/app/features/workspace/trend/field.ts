/** Fields whose elements the trend can draw as lines: the annotation fields, assay, and organism. */
export const trendFields = (fields: string[]): string[] => [...fields, "library_strategy", "organism_id"]

/**
 * The field whose elements the trend draws: the chosen field, or the first field of the dataset when the dataset does
 * not have the chosen one. Before the dataset is known, the chosen field is taken as it is.
 */
export const lineFieldOf = (chosen: string, fields: string[] | null): string =>
  fields === null || trendFields(fields).includes(chosen) ? chosen : (trendFields(fields)[0] ?? chosen)
