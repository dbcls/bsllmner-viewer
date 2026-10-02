import type { components } from "./openapi-types"

type Schemas = components["schemas"]

export type Clause = Schemas["ClauseJson"]
export type DatasetResponse = Schemas["DatasetResponse"]
export type DatasetVersionRef = Schemas["DatasetVersionRef"]
export type FieldDescription = Schemas["FieldDescription"]
export type ParseResponse = Schemas["ParseResponse"]
export type ConditionResponse = Schemas["ConditionResponse"]
export type Element = Schemas["Element"]
export type TermElement = Schemas["TermElement"]
export type DistributionResponse = Schemas["DistributionResponse"]
export type CrosstabResponse = Schemas["CrosstabResponse"]
export type Cell = Schemas["Cell"]
export type TrendResponse = Schemas["TrendResponse"]
export type TrendSeries = Schemas["TrendSeries"]
export type ProjectsResponse = Schemas["ProjectsResponse"]
export type Project = Schemas["Project"]
export type EntriesResponse = Schemas["EntriesResponse"]
export type EntryItem = Schemas["EntryItem"]
export type Organism = Schemas["Organism"]
export type Pagination = Schemas["Pagination"]
export type AnnotationValue = Schemas["AnnotationValue"]
export type EntryResponse = Schemas["EntryResponse"]
export type EntryAnnotation = Schemas["EntryAnnotation"]
export type Evidence = Schemas["Evidence"]
export type TermsResponse = Schemas["TermsResponse"]
export type TermHit = Schemas["TermHit"]
export type TermChildrenResponse = Schemas["TermChildrenResponse"]

export type Unit = Schemas["Unit"]
export type EntryType = Schemas["EntryType"]
export type AccessionType = "biosample" | "sra-experiment" | "sra-run" | "bioproject"
export type ProjectSort = Schemas["ProjectSort"]

/** AST node as returned by the api: bool ops carry `rules`, leaves carry `field`. */
export type AstNode =
  | { op: "AND" | "OR" | "NOT"; rules: AstNode[] }
  | { op: "free_text"; value: string; is_phrase?: boolean }
  | { field: string; op: "eq"; value: string }
  | { field: string; op: "between"; from: string; to: string }
