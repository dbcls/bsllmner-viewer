import type { RecordUnit, Unit } from "./api/types"

export const TABS = ["samples", "distribution", "heatmap", "trend", "projects"] as const
export type Tab = (typeof TABS)[number]

export type HeatmapColor = "count" | "residual"

/** The whole UI state of the workspace. Every member is carried by the URL. */
export type WorkspaceState = {
  q: string | null
  tab: Tab
  unit: Unit
  selfExclusion: boolean
  rows: RecordUnit
  page: number
  row: string
  col: string
  rowTerms: string[] | null
  colTerms: string[] | null
  color: HeatmapColor
  trendField: string | null
  trendTerms: string[] | null
  expandedStatus: boolean
  expanded: string[]
}

export const DEFAULTS: WorkspaceState = {
  q: null,
  tab: "samples",
  unit: "biosample",
  selfExclusion: true,
  rows: "biosample",
  page: 1,
  row: "cell_line",
  col: "library_strategy",
  rowTerms: null,
  colTerms: null,
  color: "count",
  trendField: null,
  trendTerms: null,
  expandedStatus: false,
  expanded: [],
}

const UNITS: readonly Unit[] = ["biosample", "experiment", "bioproject"]

const list = (value: string | null): string[] | null =>
  value === null ? null : value.split(",").map((s) => s.trim()).filter(Boolean)

export const readState = (params: URLSearchParams): WorkspaceState => {
  const tab = params.get("tab")
  const unit = params.get("unit")
  const page = Number(params.get("page") ?? "1")
  return {
    q: params.get("q")?.trim() || null,
    tab: TABS.includes(tab as Tab) ? (tab as Tab) : DEFAULTS.tab,
    unit: UNITS.includes(unit as Unit) ? (unit as Unit) : DEFAULTS.unit,
    selfExclusion: params.get("se") !== "0",
    rows: params.get("rows") === "experiment" ? "experiment" : "biosample",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    row: params.get("row") ?? DEFAULTS.row,
    col: params.get("col") ?? DEFAULTS.col,
    rowTerms: list(params.get("row_terms")),
    colTerms: list(params.get("col_terms")),
    color: params.get("color") === "residual" ? "residual" : "count",
    trendField: params.get("trend_field"),
    trendTerms: list(params.get("trend_terms")),
    expandedStatus: params.get("states") === "6",
    expanded: list(params.get("expand")) ?? [],
  }
}

export const writeState = (state: WorkspaceState): URLSearchParams => {
  const params = new URLSearchParams()
  if (state.q) params.set("q", state.q)
  if (state.tab !== DEFAULTS.tab) params.set("tab", state.tab)
  if (state.unit !== DEFAULTS.unit) params.set("unit", state.unit)
  if (!state.selfExclusion) params.set("se", "0")
  if (state.rows !== DEFAULTS.rows) params.set("rows", state.rows)
  if (state.page !== 1) params.set("page", String(state.page))
  if (state.row !== DEFAULTS.row) params.set("row", state.row)
  if (state.col !== DEFAULTS.col) params.set("col", state.col)
  if (state.rowTerms) params.set("row_terms", state.rowTerms.join(","))
  if (state.colTerms) params.set("col_terms", state.colTerms.join(","))
  if (state.color !== DEFAULTS.color) params.set("color", state.color)
  if (state.trendField) params.set("trend_field", state.trendField)
  if (state.trendTerms) params.set("trend_terms", state.trendTerms.join(","))
  if (state.expandedStatus) params.set("states", "6")
  if (state.expanded.length) params.set("expand", state.expanded.join(","))
  return params
}

export type Patch = Partial<WorkspaceState>

/** The search string for a workspace URL with the given state. */
export const workspaceSearch = (state: Partial<WorkspaceState>): string => {
  const query = writeState({ ...DEFAULTS, ...state }).toString()
  return query ? `?${query}` : ""
}
