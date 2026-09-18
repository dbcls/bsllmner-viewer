/** Fields whose elements the trend can plot: the annotation fields, assay, and organism. */
export const trendFields = (fields: string[]): string[] => [...fields, "library_strategy", "organism_id"]

/**
 * The field plotted by the trend: the one chosen, else the first annotation field in the condition,
 * else the heatmap's row dimension when it can be plotted, else the first annotation field.
 */
export const trendFieldOf = (chosen: string | null, row: string, fields: string[], conditionFields: string[]): string =>
  chosen ?? fields.find((f) => conditionFields.includes(f)) ?? (trendFields(fields).includes(row) ? row : fields[0]) ?? "library_strategy"
