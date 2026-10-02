/** Fields whose elements the trend can split the condition by: the annotation fields, assay, and organism. */
export const trendFields = (fields: string[]): string[] => [...fields, "library_strategy", "organism_id"]

/** The field the trend is split by, or null when the stored choice is not one of the fields. */
export const splitFieldOf = (chosen: string | null, fields: string[]): string | null =>
  chosen !== null && trendFields(fields).includes(chosen) ? chosen : null
