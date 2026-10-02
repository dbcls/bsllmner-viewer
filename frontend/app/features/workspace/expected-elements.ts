import type { DatasetResponse } from "~/lib/api/types"

/**
 * How many elements an aggregation on a dimension is expected to return, for the skeleton rows that hold their place.
 * Named elements are returned as named. Assays and organisms are known from the description of the dataset. Other
 * dimensions return up to `limit` elements; the years of `date_created` are not known before the answer, so they take
 * `limit` as a guess.
 */
export const expectedElements = (dimension: string, dataset: DatasetResponse | undefined, limit: number, named?: readonly string[] | null): number => {
  if (named) return named.length
  if (dimension === "library_strategy" && dataset) return dataset.targetAssays.length
  if (dimension === "organism_id" && dataset) return Math.min(limit, dataset.organisms.length)
  return limit
}
