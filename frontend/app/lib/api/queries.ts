import { type QueryClient, queryOptions, useMutation, useQuery } from "@tanstack/react-query"

import { api, unwrap } from "./client"
import type {
  AstNode,
  Clause,
  ConditionResponse,
  CrosstabResponse,
  DatasetResponse,
  DistributionResponse,
  EntriesResponse,
  EntryResponse,
  ParseResponse,
  ProjectSort,
  ProjectsResponse,
  TermResponse,
  TermsResponse,
  TrendResponse,
  Unit,
} from "./types"

const q = (value: string | null): string | undefined => (value ? value : undefined)

/** Query parameters without the undefined members, typed as if every remaining member were present. */
const defined = <T extends Record<string, unknown>>(params: T): { [K in keyof T]-?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]-?: Exclude<T[K], undefined>
  }

/** Where the last description of the dataset is kept between visits. */
export const DATASET_STORAGE_KEY = "bsllmner-viewer:dataset"

/**
 * Whether a stored description has the shape that the screens read. A description kept by an older version of the api,
 * without the counts of the whole dataset or the names of the ontologies, is not used.
 */
const isDataset = (value: unknown): value is DatasetResponse => {
  if (typeof value !== "object" || value === null) return false
  const { fields, targetAssays, assays, organisms, ontologies } = value as Partial<DatasetResponse>
  return (
    Array.isArray(fields) &&
    fields.every((field) => typeof field.mappedBiosampleCount === "number") &&
    Array.isArray(targetAssays) &&
    Array.isArray(assays) &&
    Array.isArray(organisms) &&
    Array.isArray(ontologies)
  )
}

/** The description of the dataset from the last visit, or undefined when there is none or it cannot be read. */
export const storedDataset = (): DatasetResponse | undefined => {
  try {
    const raw = globalThis.localStorage?.getItem(DATASET_STORAGE_KEY)
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    return isDataset(value) ? value : undefined
  } catch {
    return undefined
  }
}

const storeDataset = (dataset: DatasetResponse): void => {
  try {
    globalThis.localStorage?.setItem(DATASET_STORAGE_KEY, JSON.stringify(dataset))
  } catch {
    // A browser that refuses storage draws the fields once the description arrives.
  }
}

/**
 * The description of the dataset: its fields, target assays, and organisms. The description from the last visit is
 * shown while the current one loads, so that the views draw their cards and rows from the first paint; the current one
 * replaces it and is kept for the next visit.
 */
export const useDataset = () =>
  useQuery({
    queryKey: ["dataset"],
    queryFn: async (): Promise<DatasetResponse> => {
      const dataset = unwrap(await api.GET("/api/dataset"))
      storeDataset(dataset)
      return dataset
    },
    staleTime: Infinity,
    placeholderData: storedDataset,
  })

/** The parse of a condition. An operation that changes a condition fetches it with these options, so that it reads the AST of the condition it changes. */
export const parsedConditionOptions = (condition: string | null) =>
  queryOptions({
    queryKey: ["parse", condition],
    queryFn: async (): Promise<ParseResponse | null> =>
      condition ? unwrap(await api.GET("/api/dsl/parse", { params: { query: { q: condition } } })) : null,
    staleTime: Infinity,
    retry: false,
  })

/**
 * Put the AST and the labels of a changed condition into the cache of its parse. The views then read the new condition as
 * soon as it is in the URL, and no render shows the condition without its AST.
 */
export const cacheParsedCondition = (queryClient: QueryClient, result: ConditionResponse): void => {
  if (result.dsl === null || result.ast === null) return
  const parsed: ParseResponse = { datasetVersion: result.datasetVersion, q: result.dsl, ast: result.ast, labels: result.labels }
  queryClient.setQueryData(parsedConditionOptions(result.dsl).queryKey, parsed)
}

export const useParsedCondition = (condition: string | null) => useQuery(parsedConditionOptions(condition))

export type SelectMode = "toggle" | "narrow"

/** Apply the clauses of an element to a condition: toggle them, or narrow the condition to the element. */
export const selectElement = async (input: { q: string | null; clauses: Clause[]; mode?: SelectMode }): Promise<ConditionResponse> =>
  unwrap(await api.POST("/api/dsl/select", { body: { q: input.q, clauses: input.clauses, mode: input.mode ?? "toggle" } }))

export const useSelectElement = () => useMutation({ mutationFn: selectElement })

/**
 * The condition of the clauses alone, as selecting them from no condition gives it, so that an element can link to the
 * workspace before it is pressed. The answer never changes, so it is kept; a request for an element that leaves the
 * screen before the answer arrives is cancelled.
 */
export const useClausesCondition = (clauses: Clause[], enabled = true) =>
  useQuery({
    queryKey: ["select", clauses],
    queryFn: async ({ signal }): Promise<ConditionResponse> =>
      unwrap(await api.POST("/api/dsl/select", { body: { q: null, clauses, mode: "toggle" }, signal })),
    staleTime: Infinity,
    enabled,
  })

/** Replace the keywords of a condition with the keywords of text typed into a keyword box; empty text removes them. */
export const setKeyword = async (input: { q: string | null; keyword: string }): Promise<ConditionResponse> =>
  unwrap(await api.POST("/api/dsl/keyword", { body: { q: input.q, keyword: input.keyword } }))

export const useSetKeyword = () => useMutation({ mutationFn: setKeyword })

export const useSerialize = () =>
  useMutation({
    mutationFn: async (ast: AstNode): Promise<ConditionResponse> =>
      unwrap(await api.POST("/api/dsl/serialize", { body: { ast: ast as unknown as Record<string, never> } })),
  })

export type DistributionParams = {
  field: string
  q: string | null
  unit: Unit
  selfExclusion: boolean
  elements?: string
  limit?: number
}

export const useDistribution = (params: DistributionParams, enabled = true) =>
  useQuery({
    queryKey: ["distribution", params],
    queryFn: async (): Promise<DistributionResponse> =>
      unwrap(
        await api.GET("/api/distribution", {
          params: {
            query: defined({
              field: params.field,
              q: q(params.q),
              unit: params.unit,
              facetSelfExclude: params.selfExclusion,
              elements: params.elements,
              limit: params.limit,
            }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

export type CrosstabParams = {
  row: string
  col: string
  q: string | null
  unit: Unit
  selfExclusion: boolean
  rowElements?: string
  colElements?: string
  limit?: number
}

export const useCrosstab = (params: CrosstabParams, enabled = true) =>
  useQuery({
    queryKey: ["crosstab", params],
    queryFn: async (): Promise<CrosstabResponse> =>
      unwrap(
        await api.GET("/api/crosstab", {
          params: {
            query: defined({
              row: params.row,
              col: params.col,
              q: q(params.q),
              unit: params.unit,
              facetSelfExclude: params.selfExclusion,
              rowElements: params.rowElements,
              colElements: params.colElements,
              limit: params.limit,
            }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

export type TrendParams = {
  field?: string
  q: string | null
  unit: Unit
  selfExclusion: boolean
  elements?: string
  limit?: number
  yearFrom?: number
  yearTo?: number
}

export const useTrend = (params: TrendParams, enabled = true) =>
  useQuery({
    queryKey: ["trend", params],
    queryFn: async (): Promise<TrendResponse> =>
      unwrap(
        await api.GET("/api/trend", {
          params: {
            query: defined({
              field: params.field,
              q: q(params.q),
              unit: params.unit,
              facetSelfExclude: params.selfExclusion,
              elements: params.elements,
              limit: params.limit,
              yearFrom: params.yearFrom,
              yearTo: params.yearTo,
            }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

export type ProjectsParams = {
  q: string | null
  selfExclusion: boolean
  sort: ProjectSort
  page: number
  perPage: number
}

export const useProjects = (params: ProjectsParams, enabled = true) =>
  useQuery({
    queryKey: ["projects", params],
    queryFn: async (): Promise<ProjectsResponse> =>
      unwrap(
        await api.GET("/api/projects", {
          params: {
            query: defined({
              q: q(params.q),
              facetSelfExclude: params.selfExclusion,
              sort: params.sort,
              page: params.page,
              perPage: params.perPage,
            }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

export type EntriesParams = {
  q: string | null
  page: number
  perPage: number
}

export const useEntries = (params: EntriesParams, enabled = true) =>
  useQuery({
    queryKey: ["entries", params],
    queryFn: async (): Promise<EntriesResponse> =>
      unwrap(
        await api.GET("/api/entries/{type}", {
          params: {
            path: { type: "biosample" },
            query: defined({ q: q(params.q), page: params.page, perPage: params.perPage }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

/** The details of a term: its ontology, synonyms, parents, and page on the site of its ontology. They never change within a store. */
export const useTerm = (termId: string) =>
  useQuery({
    queryKey: ["term", termId],
    queryFn: async (): Promise<TermResponse> => unwrap(await api.GET("/api/terms/{termId}", { params: { path: { termId } } })),
    staleTime: Infinity,
    retry: false,
  })

export const useEntry = (accession: string) =>
  useQuery({
    queryKey: ["entry", accession],
    queryFn: async (): Promise<EntryResponse> =>
      unwrap(await api.GET("/api/entries/biosample/{accession}", { params: { path: { accession } } })),
    retry: false,
  })

export type TermsParams = {
  field?: string
  query: string
  q: string | null
  unit: Unit
  selfExclusion: boolean
  limit?: number
}

export const useTerms = (params: TermsParams, enabled = true) =>
  useQuery({
    queryKey: ["terms", params],
    queryFn: async (): Promise<TermsResponse> =>
      unwrap(
        await api.GET("/api/terms", {
          params: {
            query: defined({
              field: params.field,
              query: params.query,
              q: q(params.q),
              unit: params.unit,
              facetSelfExclude: params.selfExclusion,
              limit: params.limit,
            }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

