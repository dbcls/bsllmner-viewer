import type { APIRequestContext } from "@playwright/test"

export type Unit = "biosample" | "sra-experiment" | "bioproject"

export type Clause = { field: string; value?: string; from?: string; to?: string }

export type Element = { value: string; label: string; clauses: Clause[]; count: number }

export type TermElement = Element & { countExact: number; countSelected: number; hasChildren: boolean }

export type Distribution = { q: string | null; populationQ: string | null; total: number; elements: TermElement[]; status: Element[] }

export type Crosstab = {
  q: string | null
  populationQ: string | null
  total: number
  rows: TermElement[]
  cols: TermElement[]
  cells: { row: string; col: string; count: number; residual: number | null; classification: string | null }[]
}

export type TrendPoint = { year: number; count: number; clauses: Clause[] }

export type Trend = {
  populationQ: string | null
  years: number[]
  total: TrendPoint[]
  series: { value: string; label: string; points: TrendPoint[] }[]
}

export type Term = { field: string; termId: string; label: string | null; count: number }

export type Project = { identifier: string; biosampleCount: number; clauses: Clause[] }

export type Dataset = { targetAssays: string[]; fields: { name: string }[] }

type Params = Record<string, string | number | boolean | null | undefined>

const query = (params: Params): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value))
  }
  return search.toString()
}

/** GET a JSON document from the api of the site under test. */
export const get = async <T>(request: APIRequestContext, path: string, params: Params = {}): Promise<T> => {
  const response = await request.get(`${path}?${query(params)}`)
  if (!response.ok()) throw new Error(`GET ${path} returned ${response.status()}: ${await response.text()}`)
  return (await response.json()) as T
}

export const dataset = (request: APIRequestContext): Promise<Dataset> => get(request, "/api/dataset")

/** A distribution as the UI requests it: ten elements, with self-exclusion unless turned off. */
export const distribution = (
  request: APIRequestContext,
  field: string,
  options: { q?: string | null; unit?: Unit; selfExclude?: boolean; limit?: number; expandedStatus?: boolean } = {},
): Promise<Distribution> =>
  get(request, "/api/distribution", {
    field,
    q: options.q,
    unit: options.unit ?? "biosample",
    facetSelfExclude: options.selfExclude ?? true,
    limit: options.limit ?? 10,
    expandedStatus: options.expandedStatus,
  })

export const crosstab = (
  request: APIRequestContext,
  row: string,
  col: string,
  options: { q?: string | null; unit?: Unit; selfExclude?: boolean } = {},
): Promise<Crosstab> =>
  get(request, "/api/crosstab", {
    row,
    col,
    q: options.q,
    unit: options.unit ?? "biosample",
    facetSelfExclude: options.selfExclude ?? true,
    limit: 10,
  })

export const trend = (
  request: APIRequestContext,
  options: { field?: string; q?: string | null; unit?: Unit; selfExclude?: boolean } = {},
): Promise<Trend> =>
  get(request, "/api/trend", {
    field: options.field,
    q: options.q,
    unit: options.unit ?? "biosample",
    facetSelfExclude: options.selfExclude ?? true,
    limit: 5,
  })

export const terms = async (request: APIRequestContext, field: string, text: string): Promise<Term[]> =>
  (await get<{ terms: Term[] }>(request, "/api/terms", { field, query: text, facetSelfExclude: true, limit: 30 })).terms

export const children = async (request: APIRequestContext, field: string, termId: string, q?: string | null): Promise<TermElement[]> =>
  (await get<{ children: TermElement[] }>(request, "/api/terms/children", { field, termId, q, facetSelfExclude: true })).children

/** The condition that the api derives from selecting clauses, as the UI derives it. */
export const select = async (
  request: APIRequestContext,
  q: string | null,
  clauses: Clause[],
  mode: "toggle" | "narrow" = "toggle",
): Promise<string> => {
  const response = await request.post("/api/dsl/select", { data: { q, clauses, mode } })
  if (!response.ok()) throw new Error(`POST /api/dsl/select returned ${response.status()}: ${await response.text()}`)
  return ((await response.json()) as { dsl: string }).dsl
}

/** The count of the matches of a condition in a unit. */
export const countOf = async (request: APIRequestContext, q: string, unit: Unit = "biosample"): Promise<number> =>
  (await distribution(request, "library_strategy", { q, unit, selfExclude: false, limit: 1 })).total

/** BioProjects with 2 to 20 BioSamples, in the order of accession, for tests that need a small population. */
export const smallProjects = async (request: APIRequestContext): Promise<Project[]> => {
  const { items } = await get<{ items: Project[] }>(request, "/api/projects", { sort: "identifier:asc", perPage: 100 })
  const small = items.filter((project) => project.biosampleCount >= 2 && project.biosampleCount <= 20)
  if (small.length === 0) throw new Error("no BioProject with 2 to 20 BioSamples among the first 100 BioProjects")
  return small
}

export type EntryItem = { identifier: string; biosample: string; title: string | null }

export type EntryList = { pagination: { page: number; perPage: number; total: number }; items: EntryItem[] }

/** One page of the entry list of a condition. The condition always narrows the list. */
export const entries = (request: APIRequestContext, type: "biosample" | "sra-experiment", q: string, perPage = 25): Promise<EntryList> =>
  get(request, `/api/entries/${type}`, { q, perPage })

export type Entry = {
  identifier: string
  title: string | null
  organism: { name: string } | null
  annotations: { field: string; termId: string | null; label: string | null; evidence: unknown[] }[]
}

export const entry = (request: APIRequestContext, accession: string): Promise<Entry> => get(request, `/api/entries/biosample/${accession}`)

export type ProjectList = {
  pagination: { total: number }
  items: { identifier: string; title: string | null; biosampleCount: number; experimentCount: number; clauses: Clause[] }[]
}

export const projects = (request: APIRequestContext, q: string | null, sort: string, perPage = 25): Promise<ProjectList> =>
  get(request, "/api/projects", { q, facetSelfExclude: true, sort, perPage, compositionFields: "disease,cell_line,tissue" })
