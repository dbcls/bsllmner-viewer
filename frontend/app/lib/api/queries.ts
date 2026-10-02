import { queryOptions, useMutation, useQuery } from "@tanstack/react-query"

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
  EntryType,
  ParseResponse,
  ProjectSort,
  ProjectsResponse,
  TermChildrenResponse,
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

export const useDataset = () =>
  useQuery({
    queryKey: ["dataset"],
    queryFn: async (): Promise<DatasetResponse> => unwrap(await api.GET("/api/dataset")),
    staleTime: Infinity,
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

export const useParsedCondition = (condition: string | null) => useQuery(parsedConditionOptions(condition))

export type SelectMode = "toggle" | "narrow"

/** Apply the clauses of an element to a condition: toggle them, or narrow the condition to the element. */
export const selectElement = async (input: { q: string | null; clauses: Clause[]; mode?: SelectMode }): Promise<ConditionResponse> =>
  unwrap(await api.POST("/api/dsl/select", { body: { q: input.q, clauses: input.clauses, mode: input.mode ?? "toggle" } }))

export const useSelectElement = () => useMutation({ mutationFn: selectElement })

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
  expandedStatus?: boolean
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
              expandedStatus: params.expandedStatus,
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
  compositionFields: string
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
              compositionFields: params.compositionFields,
            }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

export type EntriesParams = {
  q: string | null
  type: EntryType
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
            path: { type: params.type },
            query: defined({ q: q(params.q), page: params.page, perPage: params.perPage }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
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

export type TermChildrenParams = {
  field: string
  termId: string
  q: string | null
  unit: Unit
  selfExclusion: boolean
}

export const useTermChildren = (params: TermChildrenParams, enabled = true) =>
  useQuery({
    queryKey: ["term-children", params],
    queryFn: async (): Promise<TermChildrenResponse> =>
      unwrap(
        await api.GET("/api/terms/children", {
          params: {
            query: defined({
              field: params.field,
              termId: params.termId,
              q: q(params.q),
              unit: params.unit,
              facetSelfExclude: params.selfExclusion,
            }),
          },
        }),
      ),
    enabled,
  })
