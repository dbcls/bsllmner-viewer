import type { ProjectSort, Unit } from "./api/types"

export const TABS = ["samples", "projects", "distribution", "heatmap", "trend"] as const

/** The numbers of rows that a page of the tables (Samples and Projects) can hold. The first is the default. */
export const TABLE_PER_PAGES = [20, 50, 100] as const
export type TablePerPage = (typeof TABLE_PER_PAGES)[number]
export type Tab = (typeof TABS)[number]

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
  trendField: string | null
  trendTerms: string[] | null
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
  trendField: null,
  trendTerms: null,
}

const UNITS: readonly Unit[] = ["biosample", "sra-experiment", "bioproject"]

const list = (value: string | null): string[] | null =>
  value === null ? null : value.split(",").map((s) => s.trim()).filter(Boolean)

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
    trendField: params.get("trend_field"),
    trendTerms: list(params.get("trend_terms")),
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
  if (state.trendField) params.set("trend_field", state.trendField)
  if (state.trendTerms) params.set("trend_terms", state.trendTerms.join(","))
  return params
}

export type Patch = Partial<WorkspaceState>

/** The search string for a workspace URL with the given state. */
export const workspaceSearch = (state: Partial<WorkspaceState>): string => {
  const query = writeState({ ...DEFAULTS, ...state }).toString()
  return query ? `?${query}` : ""
}
