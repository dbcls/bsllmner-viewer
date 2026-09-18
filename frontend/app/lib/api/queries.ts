import { useMutation, useQuery } from "@tanstack/react-query"

import { api, unwrap } from "./client"
import type {
  AstNode,
  Clause,
  ConditionResponse,
  CrosstabResponse,
  DatasetResponse,
  DistributionResponse,
  EntryResponse,
  ParseResponse,
  ProjectSort,
  ProjectsResponse,
  RecordsResponse,
  RecordUnit,
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

export const useParsedCondition = (condition: string | null) =>
  useQuery({
    queryKey: ["parse", condition],
    queryFn: async (): Promise<ParseResponse | null> =>
      condition ? unwrap(await api.GET("/api/dsl/parse", { params: { query: { q: condition } } })) : null,
    staleTime: Infinity,
    retry: false,
  })

export const useSelectElement = () =>
  useMutation({
    mutationFn: async (input: { q: string | null; clauses: Clause[] }): Promise<ConditionResponse> =>
      unwrap(await api.POST("/api/dsl/select", { body: { q: input.q, clauses: input.clauses } })),
  })

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
              self_exclusion: params.selfExclusion,
              elements: params.elements,
              limit: params.limit,
              expanded_status: params.expandedStatus,
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
              self_exclusion: params.selfExclusion,
              row_elements: params.rowElements,
              col_elements: params.colElements,
              limit: params.limit,
            }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

export type TrendParams = {
  field: string
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
              self_exclusion: params.selfExclusion,
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
              self_exclusion: params.selfExclusion,
              sort: params.sort,
              page: params.page,
              per_page: params.perPage,
              composition_fields: params.compositionFields,
            }),
          },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

export type RecordsParams = {
  q: string | null
  unit: RecordUnit
  page: number
  perPage: number
}

export const useRecords = (params: RecordsParams, enabled = true) =>
  useQuery({
    queryKey: ["records", params],
    queryFn: async (): Promise<RecordsResponse> =>
      unwrap(
        await api.GET("/api/records", {
          params: { query: defined({ q: q(params.q), unit: params.unit, page: params.page, per_page: params.perPage }) },
        }),
      ),
    enabled,
    placeholderData: (previous) => previous,
  })

export const useEntry = (accession: string) =>
  useQuery({
    queryKey: ["entry", accession],
    queryFn: async (): Promise<EntryResponse> =>
      unwrap(await api.GET("/api/entries/{accession}", { params: { path: { accession } } })),
    retry: false,
  })

export type TermsParams = {
  field: string
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
              self_exclusion: params.selfExclusion,
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
              term_id: params.termId,
              q: q(params.q),
              unit: params.unit,
              self_exclusion: params.selfExclusion,
            }),
          },
        }),
      ),
    enabled,
  })
