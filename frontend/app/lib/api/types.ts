import type { components, operations } from "./openapi-types"

type Schemas = components["schemas"]

export type Clause = Schemas["ClauseJson"]
export type DatasetResponse = Schemas["DatasetResponse"]
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
export type AnnotationValue = Schemas["AnnotationValue"]
export type EntryResponse = Schemas["EntryResponse"]
export type TermsResponse = Schemas["TermsResponse"]
export type TermHit = Schemas["TermHit"]
export type TermResponse = Schemas["TermResponse"]

export type Unit = Schemas["Unit"]
export type EntryType = Schemas["EntryType"]
export type AccessionType = operations["exportAccessions"]["parameters"]["path"]["type"]
export type ProjectSort = Schemas["ProjectSort"]

/** AST node as returned by the api: bool ops carry `rules`, leaves carry `field`. */
export type AstNode = Schemas["ParseResponse"]["ast"]
