import type { ProjectSort, Unit } from "./api/types"

export const TABS = ["samples", "projects", "distribution", "heatmap", "trend"] as const

/** The numbers of rows that a page of the tables (Samples and Projects) can hold. The first is the default. */
export const TABLE_PER_PAGES = [20, 50, 100] as const
export type TablePerPage = (typeof TABLE_PER_PAGES)[number]
export type Tab = (typeof TABS)[number]

export const TAB_LABELS: Record<Tab, string> = {
  samples: "Samples",
  distribution: "Distribution",
  heatmap: "Heatmap",
  trend: "Trend",
  projects: "Projects",
}

export type HeatmapColor = "count" | "ratio"

// A record rather than a list, so that the type checker reports a sort that the api adds and this list lacks.
const PROJECT_SORT_SET: Record<ProjectSort, true> = {
  "biosampleCount:desc": true,
  "biosampleCount:asc": true,
  "experimentCount:desc": true,
  "experimentCount:asc": true,
}

export const PROJECT_SORTS = Object.keys(PROJECT_SORT_SET) as ProjectSort[]

/** The whole UI state of the workspace. Every member is carried by the URL. */
export type WorkspaceState = {
  q: string | null
  tab: Tab
  unit: Unit
  page: number
  perPage: TablePerPage
  sort: ProjectSort
  row: string
  col: string
  rowTerms: string[] | null
  colTerms: string[] | null
  color: HeatmapColor
  /** The dimension whose elements the trend draws as lines. */
  trendField: string
  trendTerms: string[] | null
  /** The first and the last year that the trend shows, or null for the first and the last year with a match. */
  trendFrom: number | null
  trendTo: number | null
  /** The trend draws the line of the condition. A workspace without a condition has no line of its own for it. */
  trendCondition: boolean
  /** The trend draws the line of the whole dataset. */
  trendAll: boolean
  /** The trend writes the count of each point above it. */
  trendLabels: boolean
  /** The charts (Distribution, Heatmap, and Trend) write the term ID after the label of a term. */
  termIds: boolean
}

export const DEFAULTS: WorkspaceState = {
  q: null,
  tab: "samples",
  unit: "biosample",
  page: 1,
  perPage: TABLE_PER_PAGES[0],
  sort: "biosampleCount:desc",
  row: "cell_line",
  col: "library_strategy",
  rowTerms: null,
  colTerms: null,
  color: "count",
  trendField: "disease",
  trendTerms: null,
  trendFrom: null,
  trendTo: null,
  trendCondition: true,
  trendAll: false,
  trendLabels: false,
  termIds: false,
}

// A record rather than a list, so that the type checker reports a unit that the api adds and this list lacks.
const UNIT_SET: Record<Unit, true> = {
  biosample: true,
  "sra-experiment": true,
  bioproject: true,
}

export const UNITS = Object.keys(UNIT_SET) as Unit[]

const list = (value: string | null): string[] | null =>
  value === null ? null : value.split(",").map((s) => s.trim()).filter(Boolean)

const year = (value: string | null): number | null => (value !== null && /^\d+$/.test(value) ? Number(value) : null)

export const readState = (params: URLSearchParams): WorkspaceState => {
  const tab = params.get("tab")
  const unit = params.get("unit")
  const sort = params.get("sort")
  const page = Number(params.get("page") ?? "1")
  const perPage = Number(params.get("perPage"))
  const row = params.get("row") ?? DEFAULTS.row
  const named = params.get("col") ?? DEFAULTS.col
  // A dimension against itself shows nothing and the api rejects it, so the columns of such a URL take the default
  // column dimension, or the default row dimension when the rows have that, without the terms named for them.
  const col = named !== row ? named : DEFAULTS.col !== row ? DEFAULTS.col : DEFAULTS.row
  return {
    q: params.get("q")?.trim() || null,
    tab: TABS.includes(tab as Tab) ? (tab as Tab) : DEFAULTS.tab,
    unit: UNITS.includes(unit as Unit) ? (unit as Unit) : DEFAULTS.unit,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    perPage: TABLE_PER_PAGES.includes(perPage as TablePerPage) ? (perPage as TablePerPage) : DEFAULTS.perPage,
    sort: PROJECT_SORTS.includes(sort as ProjectSort) ? (sort as ProjectSort) : DEFAULTS.sort,
    row,
    col,
    rowTerms: list(params.get("row_terms")),
    colTerms: col === named ? list(params.get("col_terms")) : null,
    color: params.get("color") === "ratio" ? "ratio" : "count",
    trendField: params.get("trend_field") || DEFAULTS.trendField,
    trendTerms: list(params.get("trend_terms")),
    trendFrom: year(params.get("trend_from")),
    trendTo: year(params.get("trend_to")),
    trendCondition: params.get("trend_condition") !== "off",
    trendAll: params.get("trend_all") === "on",
    trendLabels: params.get("trend_labels") === "on",
    termIds: params.get("term_ids") === "on",
  }
}

export const writeState = (state: WorkspaceState): URLSearchParams => {
  const params = new URLSearchParams()
  if (state.q) params.set("q", state.q)
  if (state.tab !== DEFAULTS.tab) params.set("tab", state.tab)
  if (state.unit !== DEFAULTS.unit) params.set("unit", state.unit)
  if (state.page !== 1) params.set("page", String(state.page))
  if (state.perPage !== DEFAULTS.perPage) params.set("perPage", String(state.perPage))
  if (state.sort !== DEFAULTS.sort) params.set("sort", state.sort)
  if (state.row !== DEFAULTS.row) params.set("row", state.row)
  if (state.col !== DEFAULTS.col) params.set("col", state.col)
  if (state.rowTerms) params.set("row_terms", state.rowTerms.join(","))
  if (state.colTerms) params.set("col_terms", state.colTerms.join(","))
  if (state.color !== DEFAULTS.color) params.set("color", state.color)
  if (state.trendField !== DEFAULTS.trendField) params.set("trend_field", state.trendField)
  if (state.trendTerms) params.set("trend_terms", state.trendTerms.join(","))
  if (state.trendFrom !== null) params.set("trend_from", String(state.trendFrom))
  if (state.trendTo !== null) params.set("trend_to", String(state.trendTo))
  if (!state.trendCondition) params.set("trend_condition", "off")
  if (state.trendAll) params.set("trend_all", "on")
  if (state.trendLabels) params.set("trend_labels", "on")
  if (state.termIds) params.set("term_ids", "on")
  return params
}

export type Patch = Partial<WorkspaceState>

/** The search string for a workspace URL with the given state. */
export const workspaceSearch = (state: Partial<WorkspaceState>): string => {
  const query = writeState({ ...DEFAULTS, ...state }).toString()
  return query ? `?${query}` : ""
}
