import type { APIRequestContext } from "@playwright/test"

export type Unit = "biosample" | "sra-experiment" | "bioproject"

export type Clause = { field: string; value?: string; from?: string; to?: string }

type Element = { value: string; label: string; clauses: Clause[]; count: number }

type TermElement = Element & { countExact: number; countSelected: number; hasChildren: boolean; parents: string[] }

export type Distribution = { q: string | null; populationQ: string | null; total: number; elements: TermElement[]; withoutTerm: number | null }

export type Crosstab = {
  q: string | null
  populationQ: string | null
  total: number
  rows: TermElement[]
  cols: TermElement[]
  cells: { row: string; col: string; count: number; ratio: number | null; residual: number | null; classification: string | null }[]
}

type TrendPoint = { year: number; count: number; clauses: Clause[] }

export type Trend = {
  populationQ: string | null
  years: number[]
  firstYear: number | null
  lastYear: number | null
  allEntries: TrendPoint[]
  total: TrendPoint[]
  series: { value: string; label: string; points: TrendPoint[] }[]
}

export type Term = { field: string; termId: string; label: string | null; count: number }

export type Project = { identifier: string; biosampleCount: number; clauses: Clause[] }

export type Dataset = {
  targetAssays: string[]
  fields: { name: string }[]
  totals: { biosample: number }
  organisms: { identifier: string; name: string; biosampleCount: number }[]
}

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

/** A distribution as the UI requests it: ten elements, with self-exclusion. `selfExclude: false` counts the condition itself. */
export const distribution = (
  request: APIRequestContext,
  field: string,
  options: { q?: string | null; unit?: Unit; selfExclude?: boolean; limit?: number } = {},
): Promise<Distribution> =>
  get(request, "/api/distribution", {
    field,
    q: options.q,
    unit: options.unit ?? "biosample",
    facetSelfExclude: options.selfExclude ?? true,
    limit: options.limit ?? 10,
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
  options: { field?: string; q?: string | null; unit?: Unit; selfExclude?: boolean; elements?: string[]; yearFrom?: number; yearTo?: number } = {},
): Promise<Trend> =>
  get(request, "/api/trend", {
    field: options.field,
    q: options.q,
    unit: options.unit ?? "biosample",
    facetSelfExclude: options.selfExclude ?? true,
    limit: 5,
    elements: options.elements?.join(","),
    yearFrom: options.yearFrom,
    yearTo: options.yearTo,
  })

export const terms = async (request: APIRequestContext, field: string, text: string): Promise<Term[]> =>
  (await get<{ terms: Term[] }>(request, "/api/terms", { field, query: text, facetSelfExclude: true, limit: 30 })).terms

/** The share of the dataset's BioSamples that an organism needs to be listed in the condition panel (`ORGANISM_MIN_SHARE` of the panel). */
const ORGANISM_MIN_SHARE = 0.01

/** The organisms that the condition panel lists, in descending order of their BioSamples. */
export const listedOrganisms = (data: Dataset): Dataset["organisms"] =>
  data.organisms.filter((organism) => organism.biosampleCount >= data.totals.biosample * ORGANISM_MIN_SHARE).sort((a, b) => b.biosampleCount - a.biosampleCount)

/** The counts of named elements of a field, with or without self-exclusion, in BioSamples. */
export const countsOfElements = async (request: APIRequestContext, field: string, elements: string[], q: string, selfExclude: boolean): Promise<Map<string, number>> => {
  const result = await get<Distribution>(request, "/api/distribution", { field, q, unit: "biosample", facetSelfExclude: selfExclude, elements: elements.join(",") })
  return new Map(elements.map((element) => [element, result.elements.find((e) => e.value === element)?.count ?? 0]))
}

/** The term search of every field, in BioSamples. The term picker requests it with self-exclusion. */
export const termSearch = async (request: APIRequestContext, text: string, q: string | null, selfExclude = true): Promise<Term[]> =>
  (await get<{ terms: Term[] }>(request, "/api/terms", { query: text, q, facetSelfExclude: selfExclude, limit: 30 })).terms

/** The canonical form of a condition, and the status of the parse. */
export const parse = async (request: APIRequestContext, q: string): Promise<{ status: number; q: string | null }> => {
  const response = await request.get(`/api/dsl/parse?${query({ q })}`)
  return { status: response.status(), q: response.ok() ? ((await response.json()) as { q: string | null }).q : null }
}

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

/**
 * BioProjects with 2 to 20 BioSamples, for tests that need a small population, or none in a small dataset. Many
 * BioProjects have a single BioSample, so a binary search finds the first page of the ascending BioSample order that
 * reaches 2 BioSamples.
 */
export const smallProjects = async (request: APIRequestContext): Promise<Project[]> => {
  const perPage = 100
  const pageOf = async (page: number): Promise<Project[]> =>
    (await get<{ items: Project[] }>(request, "/api/projects", { sort: "biosampleCount:asc", perPage, page })).items
  const { pagination } = await get<{ pagination: { total: number } }>(request, "/api/projects", { perPage: 1 })
  let low = 1
  let high = Math.max(1, Math.ceil(pagination.total / perPage))
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (((await pageOf(middle)).at(-1)?.biosampleCount ?? 0) >= 2) high = middle
    else low = middle + 1
  }
  return (await pageOf(low)).filter((project) => project.biosampleCount >= 2 && project.biosampleCount <= 20)
}

type EntryItem = { identifier: string; title: string | null; bioprojects: string[] }

type EntryList = { pagination: { page: number; perPage: number; total: number }; items: EntryItem[] }

/** One page of the BioSample entries of a condition. The condition always narrows the list. */
export const entries = (request: APIRequestContext, q: string, perPage = 20): Promise<EntryList> =>
  get(request, "/api/entries/biosample", { q, perPage })

type Entry = {
  identifier: string
  title: string | null
  organism: { name: string } | null
  annotations: { field: string; termId: string | null; label: string | null; evidence: unknown[] }[]
}

export const entry = (request: APIRequestContext, accession: string): Promise<Entry> => get(request, `/api/entries/biosample/${accession}`)

type ProjectList = {
  pagination: { total: number }
  items: { identifier: string; title: string | null; biosampleCount: number; experimentCount: number; clauses: Clause[] }[]
}

/** The projects as the Projects tab requests them: counted from the condition without its BioProject clauses. */
export const projects = (request: APIRequestContext, q: string | null, sort: string, perPage = 20, page = 1): Promise<ProjectList> =>
  get(request, "/api/projects", { q, facetSelfExclude: true, sort, perPage, page })
