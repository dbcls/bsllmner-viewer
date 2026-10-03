/** Display names for api identifiers. The api is the source of the identifiers themselves. */

import type { AnnotationValue, Unit } from "./api/types"

/** The names that differ from the field's identifier with underscores as spaces and a capital first letter. */
const FIELD_LABELS: Record<string, string> = {
  chip_antigen: "ChIP antigen",
  library_strategy: "Assay",
  organism_id: "Organism",
  date_published: "Year",
  bioproject: "BioProject",
}

const STATUS_FIELD_SUFFIX = "_status"

/** The field that holds the annotation status of a field. */
export const statusFieldOf = (field: string): string => `${field}${STATUS_FIELD_SUFFIX}`

/** The field whose annotation status a field holds, or null if the field is not a status field. */
export const fieldOfStatusField = (field: string): string | null =>
  field.endsWith(STATUS_FIELD_SUFFIX) ? field.slice(0, -STATUS_FIELD_SUFFIX.length) : null

export const fieldLabel = (field: string): string => {
  if (field in FIELD_LABELS) return FIELD_LABELS[field] ?? field
  const annotated = fieldOfStatusField(field)
  if (annotated !== null) return `${fieldLabel(annotated)} status`
  return field.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
}

/** The name of an ontology by its prefix, from the ontologies that the dataset describes, or the prefix itself. */
export const ontologyName = (prefix: string, ontologies: readonly { prefix: string; name: string }[]): string =>
  ontologies.find((ontology) => ontology.prefix === prefix)?.name ?? prefix

export type StatusCode = AnnotationValue["status"]

export type StatusGroup = "mapped" | "unmapped" | "no_value"

/** How a status is drawn: the shape of its mark and the color family. */
export type StatusMark = "filled" | "half" | "empty" | "struck" | "dash" | "alert"
export type StatusTone = "brand" | "brand-mid" | "warn" | "muted" | "critical"

export type StatusInfo = {
  label: string
  group: StatusGroup
  /** What the status says about the annotation, in one sentence for the help of the screens that show it. */
  meaning: string
  mark: StatusMark
  tone: StatusTone
}

export const STATUS_INFO: Record<StatusCode, StatusInfo> = {
  mapped_exact: {
    label: "Exact match",
    group: "mapped",
    meaning: "The value matched an ontology label or synonym exactly.",
    mark: "filled",
    tone: "brand",
  },
  mapped_selected: {
    label: "LLM selected",
    group: "mapped",
    meaning: "The LLM selected the term from the candidate terms.",
    mark: "half",
    tone: "brand-mid",
  },
  unmapped_no_candidate: {
    label: "No candidate",
    group: "unmapped",
    meaning: "No ontology term resembled the value.",
    mark: "empty",
    tone: "warn",
  },
  unmapped_rejected: {
    label: "Rejected",
    group: "unmapped",
    meaning: "Similar terms existed, but the LLM adopted none.",
    mark: "struck",
    tone: "warn",
  },
  not_stated: { label: "Not stated", group: "no_value", meaning: "No value was extracted for the field.", mark: "dash", tone: "muted" },
  extraction_failed: {
    label: "Extraction failed",
    group: "no_value",
    meaning: "The output of the LLM could not be read, so no field has a value.",
    mark: "alert",
    tone: "critical",
  },
}

export const STATUS_ORDER: StatusCode[] = [
  "mapped_exact",
  "mapped_selected",
  "unmapped_no_candidate",
  "unmapped_rejected",
  "not_stated",
  "extraction_failed",
]

export const GROUP_LABELS: Record<StatusGroup, string> = {
  mapped: "Mapped",
  unmapped: "Unmapped",
  no_value: "No value",
}

export const statusInfo = (status: string): StatusInfo =>
  STATUS_INFO[status as StatusCode] ?? { label: status, group: "no_value", meaning: "", mark: "dash", tone: "muted" }

/** Whether a status says that the field has a value. */
export const hasStatusValue = (status: string): boolean => statusInfo(status).group !== "no_value"

/** The statuses that say that the field has a value, in display order. */
export const VALUE_STATUSES: StatusCode[] = STATUS_ORDER.filter(hasStatusValue)

export const statusLabel = (value: string): string =>
  value in GROUP_LABELS ? GROUP_LABELS[value as StatusGroup] : statusInfo(value).label

const UNIT_LABELS: Record<Unit, string> = {
  biosample: "BioSamples",
  "sra-experiment": "SRA Experiments",
  bioproject: "BioProjects",
}

export const unitLabel = (unit: Unit): string => UNIT_LABELS[unit]

/**
 * An organism by its NCBI Taxonomy scientific name, in full and in roman type. Names that are not binomials, such as
 * "mixed sample" or "Homo sapiens/Mus musculus xenograft", have no abbreviation or italic form.
 */
export const organismLabel = (id: string, name: string | null | undefined): string => name ?? id
