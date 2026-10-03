import { apiUrl } from "~/lib/api/client"
import {
  type CrosstabParams,
  crosstabQuery,
  type DistributionParams,
  distributionQuery,
  type EntriesParams,
  entriesQuery,
  type ProjectsParams,
  projectsQuery,
  type TrendParams,
  trendQuery,
} from "~/lib/api/queries"
import { type Patch, TREND_LIMIT, type WorkspaceState } from "~/lib/workspace-state"

import { offeredDimension, trendFields } from "./trend/field"

/** The number of elements that a card of the Distribution view asks for. */
export const DISTRIBUTION_LIMIT = 10
/** The number of elements per axis that the Heatmap view asks for when it names none. */
export const HEATMAP_LIMIT = 10

/** The cards of the Distribution view, one per annotation field, in the order of the dataset. */
export const distributionFields = (fields: string[]): string[] => [...fields]

/** The dimensions that a Heatmap axis can take: the annotation fields, assay, organism, and publication year. */
export const crosstabDimensions = (fields: string[]): string[] => [...fields, "library_strategy", "organism_id", "date_published"]

export const distributionParams = (state: WorkspaceState, field: string): DistributionParams => ({
  field,
  q: state.q,
  unit: state.unit,
  selfExclusion: true,
  limit: DISTRIBUTION_LIMIT,
})

/** What a Heatmap draws: its row and column dimensions, and the terms named for them. `fields` is null before the dataset is known. */
export const crosstabAxes = (state: WorkspaceState, fields: string[] | null) => {
  const dimensions = fields === null ? null : crosstabDimensions(fields)
  const wanted = offeredDimension(state.col, dimensions)
  const row = offeredDimension(state.row, dimensions, wanted)
  // A column that the dataset lacks falls back to the first dimension, which can be the row; the column then takes the next one.
  const col = wanted === row ? offeredDimension(state.col, dimensions, row) : wanted
  // The terms of a dimension that the dataset lacks are not terms of the dimension that takes its place.
  return {
    row,
    col,
    rowTerms: row === state.row ? state.rowTerms : null,
    colTerms: col === state.col ? state.colTerms : null,
  }
}

export const crosstabParams = (state: WorkspaceState, fields: string[] | null): CrosstabParams => {
  const { row, col, rowTerms, colTerms } = crosstabAxes(state, fields)
  return {
    row,
    col,
    q: state.q,
    unit: state.unit,
    selfExclusion: true,
    ...(rowTerms ? { rowElements: rowTerms.join(",") } : {}),
    ...(colTerms ? { colElements: colTerms.join(",") } : {}),
    limit: HEATMAP_LIMIT,
  }
}

/** The field whose elements the Trend view draws as lines. */
export const trendLineField = (state: WorkspaceState, fields: string[] | null): string =>
  offeredDimension(state.trendField, fields === null ? null : trendFields(fields))

/** What the Trend view draws as lines: the line field and the terms named for it. The terms of a field that the dataset lacks are not terms of the field that takes its place. */
export const trendAxis = (state: WorkspaceState, fields: string[] | null) => {
  const field = trendLineField(state, fields)
  return { field, terms: field === state.trendField ? state.trendTerms : null }
}

/**
 * The patch that makes the URL name the dimensions that the current tab draws, when the URL names one that the dataset does
 * not offer, or null when it names what is drawn. The terms of a dimension that is replaced are dropped with it.
 * `fields` is null before the dataset is known.
 */
export const offeredDimensionsPatch = (state: WorkspaceState, fields: string[] | null): Patch | null => {
  if (fields === null) return null
  if (state.tab === "heatmap") {
    const axes = crosstabAxes(state, fields)
    const patch: Patch = {
      ...(axes.row !== state.row ? { row: axes.row, rowTerms: null } : {}),
      ...(axes.col !== state.col ? { col: axes.col, colTerms: null } : {}),
    }
    return Object.keys(patch).length > 0 ? patch : null
  }
  if (state.tab === "trend") {
    const field = trendLineField(state, fields)
    return field !== state.trendField ? { trendField: field, trendTerms: null } : null
  }
  return null
}

export const trendParams = (state: WorkspaceState, fields: string[] | null): TrendParams => {
  const { field, terms } = trendAxis(state, fields)
  return {
    field,
    q: state.q,
    unit: state.unit,
    selfExclusion: true,
    ...(terms ? { elements: terms.join(",") } : {}),
    limit: TREND_LIMIT,
    ...(state.trendFrom !== null ? { yearFrom: state.trendFrom } : {}),
    ...(state.trendTo !== null ? { yearTo: state.trendTo } : {}),
  }
}

export const projectsParams = (state: WorkspaceState): ProjectsParams => ({
  q: state.q,
  selfExclusion: true,
  sort: state.sort,
  page: state.page,
  perPage: state.perPage,
})

export const entriesParams = (state: WorkspaceState): EntriesParams => ({
  q: state.q,
  page: state.page,
  perPage: state.perPage,
})

/**
 * The api requests that return the current view, in the order that the view makes them: the Distribution view makes one
 * per card, the others one. `fields` is the annotation fields of the dataset, or null before it is known.
 */
export const apiRequestsFor = (state: WorkspaceState, fields: string[] | null): string[] => {
  switch (state.tab) {
    case "samples":
      return [apiUrl("/api/entries/biosample", entriesQuery(entriesParams(state)))]
    case "distribution":
      return distributionFields(fields ?? []).map((field) => apiUrl("/api/distribution", distributionQuery(distributionParams(state, field))))
    case "heatmap":
      return [apiUrl("/api/crosstab", crosstabQuery(crosstabParams(state, fields)))]
    case "trend":
      return [apiUrl("/api/trend", trendQuery(trendParams(state, fields)))]
    case "projects":
      return [apiUrl("/api/projects", projectsQuery(projectsParams(state)))]
  }
}
